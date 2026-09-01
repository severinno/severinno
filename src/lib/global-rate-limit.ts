/**
 * global-rate-limit.ts
 *
 * Sliding-window rate limiter for Next.js Edge Middleware.
 *
 * This is the FIRST line of defense — runs on EVERY request to /api/*
 * before it reaches the route handler.  Designed for the Edge Runtime.
 *
 * Architecture:
 *
 *   ┌──────────────┐    ┌────────────────────────┐    ┌──────────────┐
 *   │  Incoming     │───→│  @upstash/redis REST   │───→│  Allowed?    │
 *   │  /api/* req  │    │  (distributed, ~5ms)   │    │  → 429/200  │
 *   └──────────────┘    └──────────┬─────────────┘    └──────────────┘
 *                                  │ (failover)
 *                                  ▼
 *                        ┌──────────────────┐
 *                        │  In-memory Map    │
 *                        │  (process-local)  │
 *                        └──────────────────┘
 *
 * When UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment
 * variables are set, the limiter uses Upstash Redis via REST (Edge-compatible,
 * ~5ms latency) for distributed rate limiting across instances.  Falls back
 * to the in-memory store when Upstash is unavailable or not configured.
 *
 * The sliding window is implemented with Redis INCR + EXPIRE (simpler and
 * more REST-friendly than sorted sets for the global middleware layer).
 *
 * Route-level rate limiting (rate-limit.ts + geo-rate-limit.ts) provides
 * a second, more precise layer with ioredis support for route handlers.
 *
 * Configuration via env vars (see .env.example):
 *   GLOBAL_RATE_LIMIT_MAX             — Max requests per window (default 100)
 *   GLOBAL_RATE_LIMIT_WINDOW_MS       — Window in ms (default 60_000 = 1 min)
 *   GLOBAL_RATE_LIMIT_BYPASS_IPS      — Comma-separated IPs to bypass
 *   GLOBAL_RATE_LIMIT_WHITELIST       — Comma-separated route prefixes to skip
 *   UPSTASH_REDIS_REST_URL            — Upstash Redis REST URL (optional)
 *   UPSTASH_REDIS_REST_TOKEN          — Upstash Redis REST token (optional)
 */

import { Redis } from "@upstash/redis/cloudflare"
import type { Redis as UpstashRedis } from "@upstash/redis"

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
// Uses getConfig().windowMs * 2 so the retention respects custom config values.
if (typeof setInterval !== "undefined" && typeof process !== "undefined") {
  setInterval(() => {
    const now = Date.now()
    const { windowMs } = getConfig()
    const retainWindow = windowMs * 2
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < retainWindow)
      if (entry.timestamps.length === 0) {
        store.delete(key)
      }
    }
  }, 60_000).unref?.()
}

// ---------------------------------------------------------------------------
// Upstash Redis client (lazy, REST-based, Edge-compatible)
// ---------------------------------------------------------------------------

let upstashClient: UpstashRedis | null = null
let upstashConfigured = false

/**
 * Get or create the Upstash Redis client.
 *
 * Returns null when env vars are not set (graceful fallback to in-memory).
 * The client is created once on first access — subsequent calls reuse it.
 */
function getUpstashClient(): UpstashRedis | null {
  if (upstashClient !== null) return upstashClient
  if (upstashConfigured) return null // already attempted and failed

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    upstashConfigured = true // mark as attempted, don't retry
    return null
  }

  try {
    upstashClient = new Redis({ url, token })
    return upstashClient
  } catch {
    upstashConfigured = true
    return null
  }
}

// ---------------------------------------------------------------------------
// Configuration (env vars with defaults)
// ---------------------------------------------------------------------------

const DEFAULT_MAX = 500
const DEFAULT_WINDOW_MS = 60_000

function getConfig() {
  let max = DEFAULT_MAX
  let windowMs = DEFAULT_WINDOW_MS
  let bypassIps: string[] = []
  let whitelistPrefixes: string[] = []
  let upstashAvailable = false

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

    // Check if Upstash is configured (no need to ping — just check env vars)
    upstashAvailable = !!(
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    )
  } catch {
    // Silently fall back to defaults
  }

  return { max, windowMs, bypassIps, whitelistPrefixes, upstashAvailable }
}

// ---------------------------------------------------------------------------
// Client IP extraction — delegated to shared module
// ---------------------------------------------------------------------------

import { getClientIp, simpleHash, getCompositeFingerprint } from "@/lib/rate-limit-shared"

// ---------------------------------------------------------------------------
// Upstash sliding window (INCR + EXPIRE — REST-friendly)
// ---------------------------------------------------------------------------

/**
 * Generate a composite fingerprint for rate limiting.
 *
 * Combines IP + User-Agent hash to make rate limit evasion harder.
 * Attackers rotating VPNs often keep the same UA pattern; this catches
 * VPN-rotation attacks that keep the same browser fingerprint.
 *
 * Key format: `ratelimit:global:{window_start_ms}:{route}:{fingerprint}`
 * The window_start_ms in the key ensures a new window starts fresh.
 *
 * Returns true when the request is allowed, false when blocked.
 * Returns null when Upstash is unavailable (caller should fall back).
 */

async function upstashSlidingWindow(
  key: string,
  max: number,
  windowMs: number,
  now: number,
): Promise<GlobalRateLimitResult | null> {
  const client = getUpstashClient()
  if (!client) return null

  try {
    // Use a window-rounded key so the counter aligns with wall-clock windows.
    // This is a fixed-window approach (not sliding), which is acceptable
    // for the global middleware layer — the tradeoff is smoother spikes at
    // the cost of minor boundary bursts.
    const windowKey = Math.floor(now / windowMs) * windowMs
    const redisKey = `ratelimit:global:${windowKey}:${key}`

    // INCR + EXPIRE in a pipeline would be ideal, but Upstash REST doesn't
    // support pipelining.  We use INCR and set EXPIRE on the first increment.
    const count = await client.incr(redisKey)

    // Always set EXPIRE to prevent stale keys.
    // TTL = 2× window to handle clock skew across instances.
    await client.expire(redisKey, Math.ceil((windowMs * 2) / 1000))

    if (count <= max) {
      return {
        allowed: true,
        remaining: max - count,
        reset: windowKey + windowMs,
        limit: max,
      }
    }

    return {
      allowed: false,
      remaining: 0,
      reset: windowKey + windowMs,
      limit: max,
    }
  } catch {
    // Upstash unavailable — return null so caller falls back to in-memory
    return null
  }
}

// ---------------------------------------------------------------------------
// Sliding window check (Upstash → in-memory fallback)
// ---------------------------------------------------------------------------

export async function checkGlobalRateLimit(
  request: Request,
  routePrefix?: string,
): Promise<GlobalRateLimitResult> {
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

  // Route-based key normalization
  const route = routePrefix ?? extractRoutePrefix(request.url)
  const fingerprint = getCompositeFingerprint(request)
  const key = `ratelimit:global:${route}:${fingerprint}`
  const now = Date.now()

  // ── Try Upstash Redis (distributed) ──────────────────────────────────
  if (config.upstashAvailable) {
    const upstashResult = await upstashSlidingWindow(key, config.max, config.windowMs, now)
    if (upstashResult !== null) {
      return upstashResult
    }
    // Upstash failed (or not configured) — fall through to in-memory
  }

  // ── In-memory fallback (process-local) ───────────────────────────────
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

  // Only record the request if under the limit
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
// Diagnostics (in-memory + Upstash — for admin dashboard)
// ---------------------------------------------------------------------------

export type GlobalRateLimitDiagnostics = {
  storeSize: number
  upstashAvailable: boolean
  upstashConnected: boolean
  config: ReturnType<typeof getConfig>
  timestamp: number
}

export function getGlobalRateLimitDiagnostics(): GlobalRateLimitDiagnostics {
  return {
    storeSize: store.size,
    upstashAvailable: !!(
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ),
    upstashConnected: upstashClient !== null,
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
