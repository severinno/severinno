/**
 * global-rate-limit.ts
 *
 * Sliding-window rate limiter for Next.js Edge Middleware.
 *
 * This is the FIRST line of defense — runs on EVERY request to /api/*
 * before it reaches the route handler.  Lightweight, in-memory only,
 * designed for the Edge Runtime (no Node.js dependencies).
 *
 * Architecture:
 *
 *   ┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
 *   │  Incoming     │───→│  Sliding Window   │───→│  Allowed?    │
 *   │  /api/* req  │    │  (per IP+route)   │    │  → 429/200  │
 *   └──────────────┘    └──────────────────┘    └──────────────┘
 *
 * Route-level rate limiting (rate-limit.ts + geo-rate-limit.ts) provides
 * a second, more precise layer with Redis support.  The middleware handles
 * spikes and DDoS-like traffic before it reaches the application logic.
 *
 * Configuration via env vars (see .env.example):
 *   GLOBAL_RATE_LIMIT_MAX         — Max requests per window (default 100)
 *   GLOBAL_RATE_LIMIT_WINDOW_MS   — Window in ms (default 60_000 = 1 min)
 *   GLOBAL_RATE_LIMIT_BYPASS_IPS  — Comma-separated IPs to bypass (optional)
 *   GLOBAL_RATE_LIMIT_WHITELIST   — Comma-separated route prefixes to skip
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GlobalRateLimitResult = {
  allowed: boolean
  remaining: number
  reset: number
  limit: number
}

// ---------------------------------------------------------------------------
// In-memory sliding window store (Edge-compatible — no Node.js deps)
// ---------------------------------------------------------------------------

interface SlidingEntry {
  timestamps: number[]
}

const store = new Map<string, SlidingEntry>()

// Periodic cleanup of stale entries (every 60s — only in Edge/Node runtimes)
if (typeof setInterval !== "undefined" && typeof process !== "undefined") {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      // Keep entries that are within 2× the maximum window (default 120s)
      entry.timestamps = entry.timestamps.filter((t) => now - t < 120_000)
      if (entry.timestamps.length === 0) {
        store.delete(key)
      }
    }
  }, 60_000).unref?.()
}

// ---------------------------------------------------------------------------
// Configuration (env vars with defaults)
// ---------------------------------------------------------------------------

const DEFAULT_MAX = 100
const DEFAULT_WINDOW_MS = 60_000

function getConfig() {
  let max = DEFAULT_MAX
  let windowMs = DEFAULT_WINDOW_MS
  let bypassIps: string[] = []
  let whitelistPrefixes: string[] = []

  try {
    const envMax = process.env.GLOBAL_RATE_LIMIT_MAX
    if (envMax) {
      const parsed = Number.parseInt(envMax, 10)
      if (!Number.isNaN(parsed) && parsed > 0) max = parsed
    }
    const envWindow = process.env.GLOBAL_RATE_LIMIT_WINDOW_MS
    if (envWindow) {
      const parsed = Number.parseInt(envWindow, 10)
      if (!Number.isNaN(parsed) && parsed >= 1_000) windowMs = parsed
    }
    const envBypass = process.env.GLOBAL_RATE_LIMIT_BYPASS_IPS
    if (envBypass) {
      bypassIps = envBypass
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    }
    const envWhitelist = process.env.GLOBAL_RATE_LIMIT_WHITELIST
    if (envWhitelist) {
      whitelistPrefixes = envWhitelist
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    }
  } catch {
    // Silently fall back to defaults
  }

  return { max, windowMs, bypassIps, whitelistPrefixes }
}

// ---------------------------------------------------------------------------
// Client IP extraction (proxy-aware, Edge-compatible)
// ---------------------------------------------------------------------------

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const ip = forwarded.split(",")[0]?.trim()
    if (ip) return ip
  }
  const realIp = request.headers.get("x-real-ip")
  if (realIp) return realIp
  const cfIp = request.headers.get("cf-connecting-ip")
  if (cfIp) return cfIp
  // Fallback: use a hash of a subset of headers (not ideal but edge-safe)
  const ua = request.headers.get("user-agent") ?? ""
  const accept = request.headers.get("accept") ?? ""
  return `anon-${simpleHash(`${ua}:${accept}`)}`
}

/** Minimal deterministic hash for Edge Runtime (no crypto.subtle needed). */
function simpleHash(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36)
}

// ---------------------------------------------------------------------------
// Sliding window check
// ---------------------------------------------------------------------------

export function checkGlobalRateLimit(
  request: Request,
  routePrefix?: string,
): GlobalRateLimitResult {
  const config = getConfig()
  const ip = getClientIp(request)

  // Bypass check
  if (config.bypassIps.includes(ip)) {
    return {
      allowed: true,
      remaining: config.max,
      reset: Date.now() + config.windowMs,
      limit: config.max,
    }
  }

  // Route-based key normalization — use a short sanitised prefix
  const route = routePrefix ?? extractRoutePrefix(request.url)
  const key = `ratelimit:global:${route}:${ip}`
  const now = Date.now()
  const windowStart = now - config.windowMs

  let entry = store.get(key)
  if (!entry) {
    entry = { timestamps: [] }
    store.set(key, entry)
  }

  // Remove entries outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart)
  const count = entry.timestamps.length
  const allowed = count < config.max

  // Only record the request if under the limit — blocked requests don't
  // consume window capacity.
  if (allowed) {
    entry.timestamps.push(now)
  }

  const firstTs = entry.timestamps.length > 0 ? entry.timestamps[0] : null
  const reset = firstTs !== null ? firstTs + config.windowMs : now + config.windowMs

  return {
    allowed,
    remaining: Math.max(0, config.max - count - (allowed ? 1 : 0)),
    reset,
    limit: config.max,
  }
}

// ---------------------------------------------------------------------------
// Route prefix extraction (Edge-compatible)
// ---------------------------------------------------------------------------

function extractRoutePrefix(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname
    // Normalise: /api/providers/123 → /api/providers
    //             /api/admin/users → /api/admin
    //             /api/geo/search → /api/geo
    const parts = path.split("/").filter(Boolean)
    // Group by depth-2 if it's an API path
    if (parts[0] === "api" && parts.length >= 3) {
      return `/api/${parts[1]}`
    }
    if (parts[0] === "api" && parts.length === 2) {
      return path
    }
    return `/api`
  } catch {
    return "/api"
  }
}

// ---------------------------------------------------------------------------
// Rate limit headers generator
// ---------------------------------------------------------------------------

export function globalRateLimitHeaders(result: GlobalRateLimitResult): Record<string, string> {
  return {
    "X-Global-RateLimit-Limit": String(result.limit),
    "X-Global-RateLimit-Remaining": String(result.remaining),
    "X-Global-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
    "Retry-After": String(Math.ceil((result.reset - Date.now()) / 1000)),
  }
}

// ---------------------------------------------------------------------------
// Diagnostics (in-memory only — for admin dashboard)
// ---------------------------------------------------------------------------

export type GlobalRateLimitDiagnostics = {
  storeSize: number
  config: ReturnType<typeof getConfig>
  timestamp: number
}

export function getGlobalRateLimitDiagnostics(): GlobalRateLimitDiagnostics {
  return {
    storeSize: store.size,
    config: getConfig(),
    timestamp: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Reset (useful for tests and admin)
// ---------------------------------------------------------------------------

export function resetGlobalRateLimiter(): void {
  store.clear()
}
