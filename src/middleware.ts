import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

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
  "/api/health",
  "/api/stats/public",
  "/api/reviews/recent",
  "/api/newsletter",
  "/api/sentry",
  "/api/webhooks/lytex",
])

function isPublicApi(pathname: string): boolean {
  if (PUBLIC_API.has(pathname)) return true
  // Dynamic provider detail routes are public
  if (/^\/api\/providers\/[^/]+$/.test(pathname)) return true
  // Dynamic category routes are public
  if (/^\/api\/categories\/[^/]+$/.test(pathname)) return true
  return false
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const response = NextResponse.next()

  // --- Security headers (applied to ALL responses) ---
  response.headers.set("X-DNS-Prefetch-Control", "on")
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)")

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
  matcher: [
    "/api/:path*",
    "/dashboard/:path*",
    "/settings/:path*",
  ],
}
