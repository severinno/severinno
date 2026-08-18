/**
 * middleware.ts
 *
 * Global rate limiting middleware for all /api/* routes.
 *
 * Uses an Edge-compatible sliding window rate limiter (in-memory) to protect
 * API routes from abuse and spikes. This is the FIRST line of defense;
 * route-level rate limiting (rate-limit.ts + geo-rate-limit.ts) provides
 * a second, more precise layer with Redis support.
 *
 * What it does:
 *   1. Intercepts every request to /api/*
 *   2. Checks the IP + route against a sliding window
 *   3. Returns 429 if exceeded, with Retry-After header
 *   4. Attaches X-Global-RateLimit-* headers to allowed responses
 *
 * Configuration via env vars:
 *   GLOBAL_RATE_LIMIT_MAX         — Max requests per window (default 100)
 *   GLOBAL_RATE_LIMIT_WINDOW_MS   — Window in ms (default 60_000)
 *   GLOBAL_RATE_LIMIT_BYPASS_IPS  — Comma-separated IPs to bypass
 *   GLOBAL_RATE_LIMIT_WHITELIST   — Comma-separated route prefixes to skip
 *
 * Routes ALWAYS bypassed:
 *   - /api/health (health check)
 *   - /api/webhooks/* (payment/webhook providers have fixed IPs)
 *   - /api/stats/public (public stats, read-only)
 *   - /api/newsletter (single-purpose endpoint)
 *
 * @see src/lib/global-rate-limit.ts for implementation details
 */

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { checkGlobalRateLimit, globalRateLimitHeaders } from "@/lib/global-rate-limit"

// ---------------------------------------------------------------------------
// Route matcher — only run on /api/*
// ---------------------------------------------------------------------------

export const config = {
  matcher: "/api/:path*",
}

// ---------------------------------------------------------------------------
// Routes that bypass global rate limiting
// ---------------------------------------------------------------------------

const BYPASS_ROUTES = new Set(["/api/health", "/api/stats/public", "/api/newsletter"])

const BYPASS_PREFIXES = ["/api/webhooks/"]

/** Check if a pathname should bypass global rate limiting. */
function shouldBypass(pathname: string): boolean {
  if (BYPASS_ROUTES.has(pathname)) return true
  for (const prefix of BYPASS_PREFIXES) {
    if (pathname.startsWith(prefix)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Whitelist check (env var)
// ---------------------------------------------------------------------------

function isWhitelisted(pathname: string, prefixes: string[]): boolean {
  for (const p of prefixes) {
    if (pathname.startsWith(p)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// CORS headers (for API routes)
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
    // Same-origin / direct API request fallback
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
// Middleware handler
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const { pathname: rawPathname } = request.nextUrl
  // Normalise trailing slash — /api/health/ → /api/health
  const pathname = rawPathname.replace(/\/+$/, "")

  // ── OPTIONS preflight ─────────────────────────────────────────────
  if (request.method === "OPTIONS") {
    // 204 must have a NULL body per the fetch spec — NextResponse.json({})
    // would throw "Invalid response status code 204" in strict runtimes.
    const preflight = new NextResponse(null, { status: 204 })
    addCorsHeaders(preflight, request)
    return preflight
  }

  // ── Bypass for health, webhooks, etc. ─────────────────────────────
  if (shouldBypass(pathname)) {
    return NextResponse.next()
  }

  // ── Whitelist check (env var) ─────────────────────────────────────
  const whitelistRaw = process.env.GLOBAL_RATE_LIMIT_WHITELIST ?? ""
  const whitelist = whitelistRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (whitelist.length > 0 && isWhitelisted(pathname, whitelist)) {
    return NextResponse.next()
  }

  // ── Rate limit check ──────────────────────────────────────────────
  // checkGlobalRateLimit is async (Upstash Redis with in-memory fallback)
  // — MUST be awaited before accessing .allowed/.reset or passing the
  // result to globalRateLimitHeaders().
  const result = await checkGlobalRateLimit(request)

  if (!result.allowed) {
    const body = JSON.stringify({
      error: "Muitas requisições. Tente novamente em alguns segundos.",
      retryAfter: Math.ceil((result.reset - Date.now()) / 1000),
    })

    const response = new NextResponse(body, {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        ...globalRateLimitHeaders(result),
      },
    })

    addCorsHeaders(response, request)
    return response
  }

  // ── Allowed — attach rate limit headers ───────────────────────────
  const response = NextResponse.next()
  const headers = globalRateLimitHeaders(result)
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value)
  }

  addCorsHeaders(response, request)
  return response
}
