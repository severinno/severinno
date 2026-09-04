/**
 * middleware.ts
 *
 * Global Edge middleware — the single source of truth for request processing.
 *
 * Responsibilities (in order):
 *   1. OPTIONS preflight handling (CORS)
 *   2. API versioning (rewrites /api/v1/* → /api/*)
 *   3. Request ID generation
 *   4. Security headers (HSTS, CSP, X-Frame-Options, etc.)
 *   5. Body size limits for API routes
 *   6. Global rate limiting (Upstash Redis + in-memory fallback)
 *   7. Route-specific rate limiting (sensitive endpoints)
 *   8. Session verification (Edge-compatible HMAC, 5-part cookie)
 *   9. Role-based API protection (admin, provider)
 *  10. Cron route auth (Bearer token)
 *
 * Configuration via env vars:
 *   SESSION_SECRET              — HMAC key for session cookies (required)
 *   NEXT_PUBLIC_APP_URL         — App URL for CORS
 *   CORS_ALLOWED_ORIGINS        — Extra CORS origins (comma-separated)
 *   GLOBAL_RATE_LIMIT_MAX       — Max requests per window (default 100)
 *   GLOBAL_RATE_LIMIT_WINDOW_MS — Window in ms (default 60_000)
 *   GLOBAL_RATE_LIMIT_BYPASS_IPS  — Comma-separated IPs to bypass
 *   GLOBAL_RATE_LIMIT_WHITELIST   — Comma-separated route prefixes to skip
 *
 * @see src/lib/global-rate-limit.ts — global sliding-window implementation
 * @see src/lib/route-rate-limit.ts — per-route stricter limits
 * @see src/lib/api-versioning.ts   — version prefix rewriting
 */

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { checkGlobalRateLimit, globalRateLimitHeaders } from "@/lib/global-rate-limit"
import { checkRouteRateLimit, routeRateLimitHeaders } from "@/lib/route-rate-limit"
import { handleApiVersioning } from "@/lib/api-versioning"
import { Redis } from "@upstash/redis/cloudflare"
import { generateCsrfToken, verifyCsrfToken, CSRF_COOKIE, CSRF_HEADER, MAX_AGE } from "@/lib/csrf"

// ── Request ID generation (Edge-compatible) ──────────────────────────────

function generateRequestId(): string {
  return crypto.randomUUID()
}

// ---------------------------------------------------------------------------
// Upstash Redis client (lazy, Edge-compatible via REST)
// Used for sessionVersion verification — validates that a session cookie
// hasn't been invalidated by a password change.
// ---------------------------------------------------------------------------

let upstashClient: Redis | null = null
let upstashAttempted = false

function getUpstashClient(): Redis | null {
  if (upstashAttempted) return upstashClient
  upstashAttempted = true
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (url && token) {
    upstashClient = new Redis({ url, token })
  }
  return upstashClient
}

/**
 * Verify that the sessionVersion in the cookie matches the server-stored version.
 * Returns true if valid (or if Redis is unavailable — fail-open for availability).
 * Returns false only when Redis confirms the version is stale.
 */
async function verifySessionVersion(userId: string, cookieVersion: number): Promise<boolean> {
  const client = getUpstashClient()
  if (!client) return true // Redis unavailable — fail-open

  try {
    const key = `session:version:${userId}`
    const stored = await client.get<number>(key)
    if (stored === null) return true // No cached version — assume valid (first login)
    return stored === cookieVersion
  } catch {
    return true // Redis error — fail-open for availability
  }
}

// ---------------------------------------------------------------------------
// Cookie-based session verification for Edge Runtime.
// Mirrors the HMAC logic in src/lib/auth.ts but uses Web Crypto API.
// ---------------------------------------------------------------------------

const COOKIE_NAME = "severinno_session"

async function verifySession(
  cookieValue: string,
  secret: string,
): Promise<{ userId: string; role: string; sessionVersion: number } | null> {
  const parts = cookieValue.split(".")

  // New format: userId.role.expiresAt.sessionVersion.signature (5 parts)
  // Old format: userId.role.expiresAt.signature (4 parts) — backward compat
  let userId: string
  let role: string
  let expiresAtStr: string
  let signature: string
  let sessionVersion = 0

  if (parts.length === 5) {
    ;[userId, role, expiresAtStr, , signature] = parts
    sessionVersion = Number(parts[3]) || 0
  } else if (parts.length === 4) {
    ;[userId, role, expiresAtStr, signature] = parts
  } else {
    return null
  }

  if (!userId || !role || !expiresAtStr || !signature) return null

  const expiresAt = Number(expiresAtStr)
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return null

  // Build the same payload that was signed (includes sessionVersion for new cookies)
  const payload =
    parts.length === 5
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

  return { userId, role, sessionVersion }
}

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

function getAllowedOrigins(): Set<string> {
  const allowed = new Set<string>()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try {
      allowed.add(new URL(appUrl).origin)
    } catch {
      allowed.add(appUrl.trim())
    }
  }

  // Development defaults
  if (process.env.NODE_ENV !== "production") {
    allowed.add("http://localhost:3000")
    allowed.add("http://127.0.0.1:3000")
    allowed.add("http://localhost:3003")
  }

  const extraOrigins = process.env.CORS_ALLOWED_ORIGINS ?? ""
  for (const o of extraOrigins
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    allowed.add(o)
  }

  return allowed
}

function addCorsHeaders(response: NextResponse, request?: NextRequest): void {
  const origin = request?.headers.get("origin")
  const allowedOrigins = getAllowedOrigins()

  if (origin && (allowedOrigins.has(origin) || allowedOrigins.has("*"))) {
    response.headers.set("Access-Control-Allow-Origin", origin)
    response.headers.set("Access-Control-Allow-Credentials", "true")
  } else if (!origin && process.env.NEXT_PUBLIC_APP_URL) {
    response.headers.set("Access-Control-Allow-Origin", process.env.NEXT_PUBLIC_APP_URL)
  }

  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Sentry-Trace, Baggage",
  )
  response.headers.set("Vary", "Origin")
}

// ---------------------------------------------------------------------------
// Rate limiting bypass checks
// ---------------------------------------------------------------------------

const RATE_LIMIT_BYPASS_ROUTES = new Set(["/api/health", "/api/stats/public", "/api/newsletter"])

const RATE_LIMIT_BYPASS_PREFIXES = ["/api/webhooks/", "/api/cron/"]

function shouldBypassGlobalRateLimit(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "")
  if (RATE_LIMIT_BYPASS_ROUTES.has(normalized)) return true
  for (const prefix of RATE_LIMIT_BYPASS_PREFIXES) {
    if (pathname.startsWith(prefix)) return true
  }
  return false
}

function isWhitelisted(pathname: string, prefixes: string[]): boolean {
  for (const prefix of prefixes) {
    if (pathname.startsWith(prefix)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Rate limit whitelist — lazily parsed from env var. Cached after first
// parse so repeated requests don't re-split the string.
// ---------------------------------------------------------------------------

let _whitelistCache: string[] | null = null
let _whitelistEnvSnapshot: string | undefined

function getRateLimitWhitelist(): string[] {
  const raw = process.env.GLOBAL_RATE_LIMIT_WHITELIST ?? ""
  if (raw !== _whitelistEnvSnapshot) {
    _whitelistEnvSnapshot = raw
    _whitelistCache = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return _whitelistCache!
}

// ---------------------------------------------------------------------------
// CSRF protection — sensitive mutation routes
// ---------------------------------------------------------------------------

const CSRF_SENSITIVE_PREFIXES = [
  "/api/auth/change-password",
  "/api/auth/2fa/",
  "/api/provider/wallet/withdraw",
  "/api/bookings",
  "/api/reviews",
  "/api/messages",
]

function isCsrfSensitive(pathname: string, method: string): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false
  return CSRF_SENSITIVE_PREFIXES.some((p) => pathname.startsWith(p))
}

function isCsrfProtected(pathname: string): boolean {
  return CSRF_SENSITIVE_PREFIXES.some((p) => pathname.startsWith(p))
}

// ---------------------------------------------------------------------------
// Route protection rules
// ---------------------------------------------------------------------------

const ADMIN_API = /^\/api\/admin(\/|$)/
const PROVIDER_API = /^\/api\/provider(\/|$)/

const DASHBOARD_PAGES = /^\/dashboard(\/|$)/
const SETTINGS_PAGES = /^\/settings(\/|$)/

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
  "/api/web-vitals",
  "/api/webhooks/lytex",
  "/api/webhooks/sentry-alert",
  "/api/webhooks/evolution",
])

function isPublicApi(pathname: string): boolean {
  if (PUBLIC_API.has(pathname)) return true
  if (/^\/api\/providers\/[^/]+$/.test(pathname)) return true
  if (/^\/api\/categories\/[^/]+$/.test(pathname)) return true
  if (/^\/api\/push\/payload\/[a-z0-9]{16}$/.test(pathname)) return true
  if (/^\/api\/push\/click$/.test(pathname)) return true
  // All webhook routes are public (called by external payment/messaging providers)
  if (/^\/api\/webhooks\/[^/]+/.test(pathname)) return true
  return false
}

// ---------------------------------------------------------------------------
// Middleware handler
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const { pathname: rawPathname } = request.nextUrl
  const pathname = rawPathname.replace(/\/+$/, "")

  // --- API versioning (rewrites /api/v1/* → /api/*) ---
  const versionedResponse = handleApiVersioning(request)
  if (versionedResponse) return versionedResponse

  const response = NextResponse.next()

  // --- Request ID ---
  const requestId = request.headers.get("x-request-id") || generateRequestId()
  response.headers.set("x-request-id", requestId)

  // --- Security headers (applied to ALL responses) ---
  // Note: Some headers (CSP, removed Server/X-Powered-By) are set by
  // Caddy reverse proxy in production. These are set here as defense-in-depth
  // so they're present even when bypassing Caddy (dev, direct access).
  response.headers.set("X-DNS-Prefetch-Control", "on")
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
  response.headers.set("X-Frame-Options", "DENY")
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), payment=()")
  response.headers.set("Vary", "Accept-Encoding")

  // Content-Security-Policy (dynamic — uses request origin)
  const requestOrigin = request.headers.get("origin") || "https://severinno.com"
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://va.vercel-scripts.com https://vercel-insights.com",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.s3.amazonaws.com https://maps.googleapis.com https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.gravatar.com https://ui-avatars.com https://i.pravatar.cc https://picsum.photos",
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src 'self' ${requestOrigin} https://severinno.local https://severinno.com http://localhost:* https://*.upstash.io https://sentry.io https://*.ingest.sentry.io https://tile.openstreetmap.org https://*.tile.openstreetmap.org wss://localhost:* ws://localhost:*`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ")
  response.headers.set("Content-Security-Policy", cspDirectives)

  // --- OPTIONS preflight ---
  if (request.method === "OPTIONS") {
    const preflight = new NextResponse(null, { status: 204 })
    addCorsHeaders(preflight, request)
    return preflight
  }

  // --- CORS headers (API routes) ---
  if (pathname.startsWith("/api/")) {
    addCorsHeaders(response, request)

    // --- Request body size limits ---
    const contentLength = request.headers.get("content-length")
    if (contentLength && ["POST", "PUT", "PATCH"].includes(request.method)) {
      const sizeBytes = Number(contentLength)
      const isUpload = pathname.includes("/upload") || pathname.includes("/avatar")
      const isWebhook = pathname.startsWith("/api/webhooks/")
      const isAuth = pathname.startsWith("/api/auth/")

      let maxSize = 1_048_576 // 1MB default
      if (isUpload)
        maxSize = 10_485_760 // 10MB for uploads
      else if (isWebhook)
        maxSize = 2_097_152 // 2MB for webhooks
      else if (isAuth) maxSize = 16_384 // 16KB for auth

      if (sizeBytes > maxSize) {
        return NextResponse.json(
          { error: `Payload excede o limite de ${Math.round(maxSize / 1024)}KB` },
          { status: 413 },
        )
      }
    }
  }

  // --- Global rate limiting (API routes only) ---
  if (pathname.startsWith("/api/") && !shouldBypassGlobalRateLimit(pathname)) {
    const whitelist = getRateLimitWhitelist()
    const bypassedByWhitelist = whitelist.length > 0 && isWhitelisted(pathname, whitelist)

    if (!bypassedByWhitelist) {
      const result = await checkGlobalRateLimit(request)
      const rateHeaders = globalRateLimitHeaders(result)

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
            "X-RateLimit-Limit": String(result.limit),
            "X-RateLimit-Remaining": String(result.remaining),
            ...rateHeaders,
          },
        })
        addCorsHeaders(response429, request)
        return response429
      }
    }
  }

  // --- Route-specific rate limiting (sensitive endpoints) ---
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
      addCorsHeaders(response429, request)
      return response429
    }
  }

  // --- Skip non-API, non-protected pages ---
  const isApi = pathname.startsWith("/api/")
  const isProtectedPage = DASHBOARD_PAGES.test(pathname) || SETTINGS_PAGES.test(pathname)

  // --- Public pages: short cache for SSR (Cloudflare caches these) ---
  if (!isApi && !isProtectedPage) {
    const isPublicPage =
      pathname === "/" ||
      pathname === "/busca" ||
      pathname === "/como-funciona" ||
      pathname === "/contato"
    if (isPublicPage && request.method === "GET") {
      response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300")
    }
    return response
  }

  // --- Public API routes pass through ---
  if (isApi && isPublicApi(pathname)) {
    if (request.method === "GET" && !pathname.startsWith("/api/auth")) {
      // Differentiated caching: hot endpoints get longer cache
      const isHotEndpoint =
        pathname.startsWith("/api/providers") ||
        pathname.startsWith("/api/categories") ||
        pathname === "/api/health" ||
        pathname === "/api/stats/public"

      if (isHotEndpoint) {
        // Providers/categories: cache 5 min, serve stale 30 min
        response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=1800")
      } else {
        // Other public APIs: cache 1 min, serve stale 5 min
        response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300")
      }
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

  // --- Session version check (invalidates sessions after password change) ---
  // Only check for 5-part cookies that carry an explicit sessionVersion.
  // Legacy 4-part cookies have sessionVersion=0 and skip this check.
  if (session.sessionVersion > 0) {
    const versionValid = await verifySessionVersion(session.userId, session.sessionVersion)
    if (!versionValid) {
      if (isProtectedPage) {
        return NextResponse.redirect(new URL("/", request.url))
      }
      return NextResponse.json({ error: "Sessão expirada — faça login novamente" }, { status: 401 })
    }
  }

  // --- Role-based API protection ---
  if (ADMIN_API.test(pathname) && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso proibido" }, { status: 403 })
  }
  if (PROVIDER_API.test(pathname) && session.role !== "PROVIDER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso proibido" }, { status: 403 })
  }

  // --- Forward user info to API routes ---
  response.headers.set("x-user-id", session.userId)
  response.headers.set("x-user-role", session.role)

  // --- CSRF protection for sensitive routes ---
  // Set CSRF cookie whenever there's a valid session (not just API GET).
  // This ensures the cookie exists BEFORE the first POST mutation, which
  // happens on page loads that include a session but no prior API GET.
  if (session && sessionSecret && !request.cookies.get(CSRF_COOKIE)) {
    const token = await generateCsrfToken(sessionSecret)
    response.cookies.set(CSRF_COOKIE, token, {
      httpOnly: false, // Must be readable by client JS for Double-Submit pattern
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: MAX_AGE,
      path: "/",
    })
  }

  if (isApi && sessionSecret) {
    // On mutations: verify X-CSRF-Token header matches cookie
    if (isCsrfSensitive(pathname, request.method)) {
      const cookieToken = request.cookies.get(CSRF_COOKIE)?.value
      const headerToken = request.headers.get(CSRF_HEADER)

      if (!cookieToken || !headerToken) {
        return NextResponse.json({ error: "CSRF token ausente" }, { status: 403 })
      }

      const valid = await verifyCsrfToken(cookieToken, sessionSecret)
      if (!valid || cookieToken !== headerToken) {
        return NextResponse.json({ error: "CSRF token inválido" }, { status: 403 })
      }
    }
  }

  return response
}

// ---------------------------------------------------------------------------
// Match config — API routes + protected pages
// ---------------------------------------------------------------------------
export const config = {
  matcher: [
    "/api/:path*",
    "/dashboard/:path*",
    "/settings/:path*",
    "/",
    "/busca",
    "/como-funciona",
    "/contato",
    "/login",
    "/register",
    "/servicos/:path*",
  ],
}
