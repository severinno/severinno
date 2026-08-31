import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { checkGlobalRateLimit, globalRateLimitHeaders } from "@/lib/global-rate-limit"
import { checkRouteRateLimit, routeRateLimitHeaders } from "@/lib/route-rate-limit"
import { handleApiVersioning } from "@/lib/api-versioning"

// ── Request ID generation (Edge-compatible) ──────────────────────────────
// Uses crypto.randomUUID() which is available in Edge Runtime.
// The request ID is added to headers so route handlers can read it.

function generateRequestId(): string {
  return crypto.randomUUID()
}

// ---------------------------------------------------------------------------
// Rate limiting — global sliding-window limiter for /api/* (Edge-compatible).
//
// Usa checkGlobalRateLimit (src/lib/global-rate-limit.ts): Upstash Redis via
// REST quando UPSTASH_REDIS_REST_URL/TOKEN estão configurados, com fallback
// in-memory por processo. Config via env:
//   GLOBAL_RATE_LIMIT_MAX / WINDOW_MS / BYPASS_IPS / WHITELIST
// Rotas sempre bypassadas: health, stats/public, newsletter, webhooks/*, cron/*
// (mesmos bypasses do antigo middleware.ts raiz + cron do src/middleware).
// ---------------------------------------------------------------------------

// Rotas fixas que nunca sofrem rate limit global
const RATE_LIMIT_BYPASS_ROUTES = new Set(["/api/health", "/api/stats/public", "/api/newsletter"])

// Prefixos que nunca sofrem rate limit global
const RATE_LIMIT_BYPASS_PREFIXES = ["/api/webhooks/", "/api/cron/"]

function shouldBypassGlobalRateLimit(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "")
  if (RATE_LIMIT_BYPASS_ROUTES.has(normalized)) return true
  for (const prefix of RATE_LIMIT_BYPASS_PREFIXES) {
    if (pathname.startsWith(prefix)) return true
  }
  return false
}

/** Whitelist dinâmica via env (GLOBAL_RATE_LIMIT_WHITELIST, prefixos). */
function isWhitelisted(pathname: string, prefixes: string[]): boolean {
  for (const prefix of prefixes) {
    if (pathname.startsWith(prefix)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Cookie-based session verification for Edge Runtime.
// Mirrors the HMAC logic in src/lib/auth.ts but uses Web Crypto API.
// ---------------------------------------------------------------------------

const COOKIE_NAME = "severinno_session"

async function verifySession(
  cookieValue: string,
  secret: string,
): Promise<{ userId: string; role: string } | null> {
  const parts = cookieValue.split(".")

  // New format: userId.role.expiresAt.sessionVersion.signature (5 parts)
  // Old format: userId.role.expiresAt.signature (4 parts) — backward compat
  let userId: string
  let role: string
  let expiresAtStr: string
  let signature: string

  if (parts.length === 5) {
    ;[userId, role, expiresAtStr, , signature] = parts
  } else if (parts.length === 4) {
    ;[userId, role, expiresAtStr, signature] = parts
  } else {
    return null
  }

  if (!userId || !role || !expiresAtStr || !signature) return null

  const expiresAt = Number(expiresAtStr)
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return null

  // Build the same payload that was signed (includes sessionVersion for new cookies)
  const payload = parts.length === 5
    ? `${userId}.${role}.${expiresAtStr}.${parts[3]}`
    : `${userId}.${role}.${expiresAtStr}`
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload))
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  // Constant-time comparison preventing timing attacks
  const expectedBytes = encoder.encode(expected)
  const signatureBytes = encoder.encode(signature)

  if (expectedBytes.byteLength !== signatureBytes.byteLength) {
    return null
  }

  let diff = 0
  for (let i = 0; i < expectedBytes.byteLength; i++) {
    diff |= expectedBytes[i] ^ signatureBytes[i]
  }

  if (diff !== 0) return null

  return { userId, role }
}

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------
// A sessão usa SameSite=Lax, que já protege contra CSRF básico.
// Para plataforma com valores monetários, isso é suficiente para
// prevenir ataques CSRF via formulários cruzados.
//
// O cookie SameSite=Lax impede que navegadores enviem o cookie
// em requisições POST originadas de sites terceiros, exceto
// navegação top-level por links GET.

// Origem permitida para CORS — deve ser configurada via env var
const ALLOWED_ORIGINS = process.env.NEXT_PUBLIC_APP_URL ? [process.env.NEXT_PUBLIC_APP_URL] : [] // Sem fallback — CORS só funciona com NEXT_PUBLIC_APP_URL configurada

function addCorsHeaders(response: NextResponse, origin: string | null): void {
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin)
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
    response.headers.set("Access-Control-Allow-Credentials", "true")
    response.headers.set("Access-Control-Max-Age", "86400")
  }
}

// ---------------------------------------------------------------------------
// Route protection rules
// ---------------------------------------------------------------------------

// API routes that require specific roles
const ADMIN_API = /^\/api\/admin(\/|$)/
const PROVIDER_API = /^\/api\/provider(\/|$)/

// Dashboard pages that require authentication
const DASHBOARD_PAGES = /^\/dashboard(\/|$)/
const SETTINGS_PAGES = /^\/settings(\/|$)/

// Public API routes — no auth required
const PUBLIC_API = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/me",
  "/api/auth/logout",
  "/api/categories",
  "/api/providers",
  "/api/search",
  "/api/search/providers",
  "/api/search/services",
  "/api/geo/cep",
  "/api/geo/reverse",
  "/api/geo/search",
  "/api/health",
  "/api/health/detailed",
  "/api/stats/public",
  "/api/reviews/recent",
  "/api/services",
  "/api/metrics",
  "/api/metrics/prometheus",
  "/api/newsletter",
  "/api/sentry",
  "/api/sentry/test",
  "/api/webhooks/lytex",
  "/api/webhooks/sentry-alert",
  "/api/webhooks/evolution",
])

function isPublicApi(pathname: string): boolean {
  if (PUBLIC_API.has(pathname)) return true
  // Dynamic provider detail routes are public
  if (/^\/api\/providers\/[^/]+$/.test(pathname)) return true
  // Dynamic category routes are public
  if (/^\/api\/categories\/[^/]+$/.test(pathname)) return true
  // Push payload fetch (SW calls it without session cookie when browser is closed)
  if (/^\/api\/push\/payload\/[a-z0-9]{16}$/.test(pathname)) return true
  // Push click tracking (SW calls it without session cookie)
  if (/^\/api\/push\/click$/.test(pathname)) return true
  return false
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // --- API versioning (rewrites /api/v1/* → /api/*) ---
  const versionedResponse = handleApiVersioning(request)
  if (versionedResponse) return versionedResponse

  const response = NextResponse.next()

  // --- Request ID (propagated via headers to route handlers) ---
  // Check if client sent a request ID (for distributed tracing), otherwise generate one
  const requestId = request.headers.get("x-request-id") || generateRequestId()
  response.headers.set("x-request-id", requestId)

  // --- Security headers (applied to ALL responses) ---
  response.headers.set("X-DNS-Prefetch-Control", "on")
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("X-Frame-Options", "DENY")
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)")
  response.headers.set("Vary", "Accept-Encoding")

  // Content-Security-Policy (production-grade)
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' https://va.vercel-scripts.com https://vercel-insights.com https://*.vercel.app",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.vercel.app https://*.s3.amazonaws.com https://maps.googleapis.com https://*.tile.openstreetmap.org",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://*.vercel.app wss://*.vercel.app https://*.upstash.io https://sentry.io https://*.ingest.sentry.io",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ")
  response.headers.set("Content-Security-Policy", cspDirectives)

  // --- CORS headers (API routes) ---
  if (pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin")
    addCorsHeaders(response, origin)

    // Handle preflight (OPTIONS) requests
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: response.headers })
    }

    // --- Request body size limits ---
    const contentLength = request.headers.get("content-length")
    if (contentLength && ["POST", "PUT", "PATCH"].includes(request.method)) {
      const sizeBytes = Number(contentLength)
      const isUpload = pathname.includes("/upload") || pathname.includes("/avatar")
      const isWebhook = pathname.startsWith("/api/webhooks/")
      const isAuth = pathname.startsWith("/api/auth/")

      let maxSize = 1_048_576 // 1MB default
      if (isUpload) maxSize = 10_485_760 // 10MB for uploads
      else if (isWebhook) maxSize = 2_097_152 // 2MB for webhooks
      else if (isAuth) maxSize = 16_384 // 16KB for auth

      if (sizeBytes > maxSize) {
        return NextResponse.json(
          { error: `Payload excede o limite de ${Math.round(maxSize / 1024)}KB` },
          { status: 413 },
        )
      }
    }
  }

  // --- Rate limiting global (API routes only, com bypasses) ---
  // Primeira linha de defesa: Upstash Redis (distribuído) com fallback
  // in-memory. Bypasses: health/stats/newsletter (fixas), webhooks/* e cron/*
  // (prefixos), além de GLOBAL_RATE_LIMIT_WHITELIST via env.
  if (pathname.startsWith("/api/") && !shouldBypassGlobalRateLimit(pathname)) {
    const whitelistRaw = process.env.GLOBAL_RATE_LIMIT_WHITELIST ?? ""
    const whitelist = whitelistRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    const bypassedByWhitelist = whitelist.length > 0 && isWhitelisted(pathname, whitelist)

    if (!bypassedByWhitelist) {
      const result = await checkGlobalRateLimit(request)
      const rateHeaders = globalRateLimitHeaders(result)

      // Headers de compat (X-RateLimit-*) + contrato global (X-Global-*)
      response.headers.set("X-RateLimit-Limit", String(result.limit))
      response.headers.set("X-RateLimit-Remaining", String(result.remaining))
      response.headers.set("X-RateLimit-Reset", rateHeaders["X-Global-RateLimit-Reset"])
      for (const [key, value] of Object.entries(rateHeaders)) {
        response.headers.set(key, value)
      }

      if (!result.allowed) {
        const body = JSON.stringify({
          error: "Muitas requisições. Tente novamente em alguns segundos.",
          retryAfter: Math.ceil((result.reset - Date.now()) / 1000),
        })
        const response429 = new NextResponse(body, {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            // Compat + contrato global no 429 também (clientes que leem
            // X-RateLimit-* continuam vendo os mesmos headers do 200)
            "X-RateLimit-Limit": String(result.limit),
            "X-RateLimit-Remaining": String(result.remaining),
            ...rateHeaders,
          },
        })
        addCorsHeaders(response429, request.headers.get("origin"))
        return response429
      }
    }
  }

  // --- Route-specific rate limiting (sensitive endpoints) ---
  // Segunda camada: limites mais restritivos para rotas sensíveis
  // (login, register, forgot-password, push/subscribe, etc.).
  // Aplica-se DEPOIS do global rate limit (que é uma proteção mais ampla).
  // Se o global já barrou, não executamos este para evitar trabalho extra.
  if (pathname.startsWith("/api/")) {
    const routeResult = await checkRouteRateLimit(request)
    if (routeResult && !routeResult.allowed) {
      const body = JSON.stringify({
        error: "Muitas tentativas para esta operação. Aguarde um minuto.",
        retryAfter: Math.ceil((routeResult.reset - Date.now()) / 1000),
      })
      const response429 = new NextResponse(body, {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          ...routeRateLimitHeaders(routeResult),
        },
      })
      addCorsHeaders(response429, request.headers.get("origin"))
      return response429
    }
  }

  // --- Skip non-API, non-protected pages ---
  const isApi = pathname.startsWith("/api/")
  const isProtectedPage = DASHBOARD_PAGES.test(pathname) || SETTINGS_PAGES.test(pathname)

  if (!isApi && !isProtectedPage) return response

  // --- Public API routes pass through ---
  if (isApi && isPublicApi(pathname)) {
    // Add Cache-Control for public read-only routes (reduces DB load)
    if (request.method === "GET" && !pathname.startsWith("/api/auth")) {
      response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300")
    }
    return response
  }

  // --- Cron routes use a shared secret instead of session ---
  if (pathname.startsWith("/api/cron/")) {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = request.headers.get("authorization")
    if (cronSecret && authHeader === `Bearer ${cronSecret}`) return response
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  // --- Verify session cookie ---
  const sessionSecret = process.env.SESSION_SECRET
  if (!sessionSecret) {
    // Fail closed in production (no auth = no access)
    // Fail open only in development for DX convenience
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Servidor mal configurado" }, { status: 500 })
    }
    return response
  }

  const cookie = request.cookies.get(COOKIE_NAME)?.value
  if (!cookie) {
    if (isProtectedPage) {
      return NextResponse.redirect(new URL("/", request.url))
    }
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const session = await verifySession(cookie, sessionSecret)
  if (!session) {
    if (isProtectedPage) {
      return NextResponse.redirect(new URL("/", request.url))
    }
    return NextResponse.json({ error: "Sessão inválida" }, { status: 401 })
  }

  // --- Role-based API protection ---
  if (ADMIN_API.test(pathname) && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso proibido" }, { status: 403 })
  }
  if (PROVIDER_API.test(pathname) && session.role !== "PROVIDER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso proibido" }, { status: 403 })
  }

  // --- Forward user info to API routes (avoid redundant DB lookups) ---
  response.headers.set("x-user-id", session.userId)
  response.headers.set("x-user-role", session.role)

  return response
}

// ---------------------------------------------------------------------------
// Match config — only run on API routes and protected pages
// ---------------------------------------------------------------------------
export const config = {
  matcher: ["/api/:path*", "/dashboard/:path*", "/settings/:path*"],
}
