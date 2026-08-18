import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { checkGlobalRateLimit, globalRateLimitHeaders } from "@/lib/global-rate-limit"
import { handleApiVersioning } from "@/lib/api-versioning"

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
  if (parts.length !== 4) return null
  const [userId, role, expiresAtStr, signature] = parts
  if (!userId || !role || !expiresAtStr || !signature) return null

  const expiresAt = Number(expiresAtStr)
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return null

  const payload = `${userId}.${role}.${expiresAtStr}`
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

  if (expected.length !== signature.length) return null
  // Constant-time-ish compare (Edge doesn't have timingSafeEqual)
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  if (mismatch !== 0) return null

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

  // --- Security headers (applied to ALL responses) ---
  response.headers.set("X-DNS-Prefetch-Control", "on")
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("X-Frame-Options", "DENY")
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)")

  // --- CORS headers (API routes) ---
  if (pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin")
    addCorsHeaders(response, origin)

    // Handle preflight (OPTIONS) requests
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: response.headers })
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

  // --- Skip non-API, non-protected pages ---
  const isApi = pathname.startsWith("/api/")
  const isProtectedPage = DASHBOARD_PAGES.test(pathname) || SETTINGS_PAGES.test(pathname)

  if (!isApi && !isProtectedPage) return response

  // --- Public API routes pass through ---
  if (isApi && isPublicApi(pathname)) return response

  // --- Cron routes use a shared secret instead of session ---
  if (pathname.startsWith("/api/cron/")) {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = request.headers.get("authorization")
    if (cronSecret && authHeader === `Bearer ${cronSecret}`) return response
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  // --- Verify session cookie ---
  const sessionSecret = process.env.SESSION_SECRET
  if (!sessionSecret) return response // fail open in dev if misconfigured

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
