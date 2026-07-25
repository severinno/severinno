/**
 * Edge-compatible rate limiter for the Severinno Marketplace middleware.
 *
 * Uses @upstash/redis (HTTP/REST-based) for distributed rate limiting
 * across Edge Runtime instances. Falls back to an in-memory sliding window
 * when Upstash Redis is not configured (dev environment).
 *
 * Usage in middleware.ts:
 *
 *   import { checkEdgeRateLimit } from "@/lib/edge-rate-limit"
 *
 *   const result = await checkEdgeRateLimit(request, {
 *     prefix: "general",
 *     max: 60,
 *     windowMs: 60_000,
 *   })
 *   if (!result.allowed) {
 *     return new NextResponse(..., { status: 429 })
 *   }
 */

import type { NextRequest } from "next/server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EdgeRateLimitResult = {
  /** Whether the request is allowed (under the limit). */
  allowed: boolean
  /** How many requests remain in the current window. */
  remaining: number
  /** Unix timestamp (ms) when the window resets. */
  reset: number
  /** Maximum requests per window. */
  limit: number
}

export type EdgeRateLimitOptions = {
  /** Key prefix (e.g. "general", "login", "providers"). */
  prefix: string
  /** Maximum requests in the window. */
  max: number
  /** Window duration in milliseconds (e.g. 60_000 = 1 min). */
  windowMs: number
  /** Optional custom identifier (defaults to client IP). */
  identifier?: string
}

// ---------------------------------------------------------------------------
// Extract client IP from NextRequest
// ---------------------------------------------------------------------------

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const ip = forwarded.split(",")[0]?.trim()
    if (ip && ip !== "::1" && ip !== "127.0.0.1") return ip
  }
  return request.headers.get("x-real-ip")
    ?? request.headers.get("cf-connecting-ip")
    ?? "127.0.0.1"
}

// ---------------------------------------------------------------------------
// In-memory fallback store
// ---------------------------------------------------------------------------

type WindowEntry = {
  count: number
  resetAt: number
}

const memoryStore = new Map<string, WindowEntry>()

// Periodic cleanup of expired entries (every 60s)
const CLEANUP_INTERVAL = 60_000
let cleanupTimer: ReturnType<typeof setInterval> | null = null

function ensureCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of memoryStore) {
      if (entry.resetAt < now) memoryStore.delete(key)
    }
  }, CLEANUP_INTERVAL)
  // Allow the process to exit even if the timer is still running
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref()
  }
}

// ---------------------------------------------------------------------------
// Upstash Redis client (lazy init, edge-compatible)
// ---------------------------------------------------------------------------

/**
 * Get the Upstash Redis client from environment variables.
 * Returns null if not configured, so the app degrades gracefully in dev.
 */
function getUpstash() {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  // Also check the standard REDIS_URL as fallback — some self-hosted setups
  // expose a REST-compatible Redis endpoint (e.g. via upstash/upstash-redis)
  const fallbackUrl = process.env.REDIS_URL

  if (!url && !token && !fallbackUrl) return null
  if (url && token) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis")
    return new Redis({ url, token })
  }

  // If only UPSTASH_REDIS_REST_URL is set but no token, try without auth
  if (url) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis")
    return new Redis({ url, token: "" })
  }

  return null
}

// ---------------------------------------------------------------------------
// Rate limit check
// ---------------------------------------------------------------------------

/**
 * Check if a request is within the rate limit.
 *
 * Priority:
 * 1. Upstash Redis (edge-compatible, distributed) — when configured
 * 2. In-memory Map (single-instance only) — fallback for dev
 */
export async function checkEdgeRateLimit(
  request: NextRequest,
  options: EdgeRateLimitOptions,
): Promise<EdgeRateLimitResult> {
  const { prefix, max, windowMs } = options
  const identifier = options.identifier ?? getClientIp(request)
  const now = Date.now()

  // Calculate sliding window
  const windowStart = Math.floor(now / windowMs) * windowMs
  const reset = windowStart + windowMs
  const key = `rl:${prefix}:${identifier}`

  // -- Try Upstash Redis first --------------------------------------------------
  try {
    const upstash = getUpstash()
    if (upstash) {
      const count = await upstash.incr(key)
      // Set TTL on first request in this window
      if (count === 1) {
        await upstash.expire(key, Math.ceil(windowMs / 1000))
      }

      return {
        allowed: count <= max,
        remaining: Math.max(0, max - count),
        reset,
        limit: max,
      }
    }
  } catch {
    // Upstash unavailable — fall through to in-memory
  }

  // -- In-memory fallback -------------------------------------------------------
  ensureCleanup()

  const existing = memoryStore.get(key)
  if (existing && existing.resetAt > now) {
    existing.count++
    return {
      allowed: existing.count <= max,
      remaining: Math.max(0, max - existing.count),
      reset: existing.resetAt,
      limit: max,
    }
  }

  // New window
  memoryStore.set(key, { count: 1, resetAt: reset })
  return {
    allowed: true,
    remaining: max - 1,
    reset,
    limit: max,
  }
}

// ---------------------------------------------------------------------------
// Convenience: rate limit headers for 429 responses
// ---------------------------------------------------------------------------

/**
 * Generate standard RateLimit headers for a 429 response.
 */
export function edgeRateLimitHeaders(result: EdgeRateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
    "Retry-After": String(Math.ceil((result.reset - Date.now()) / 1000)),
  }
}

// ---------------------------------------------------------------------------
// Preset rate limits for the Severinno Edge Middleware
// (stricter than the Node-side presets since Edge is the first line of defence)
// ---------------------------------------------------------------------------

export const EDGE_RATE_LIMITS = {
  /** Global API default: 60 req/min */
  general: { prefix: "general", max: 60, windowMs: 60_000 },
  /** Login: 10 attempts per minute */
  login: { prefix: "login", max: 10, windowMs: 60_000 },
  /** Register: 5 per minute */
  register: { prefix: "register", max: 5, windowMs: 60_000 },
  /** Password recovery: 3 per 10 min */
  forgotPassword: { prefix: "forgot-pw", max: 3, windowMs: 600_000 },
  /** Booking endpoints: 30 per minute */
  bookings: { prefix: "bookings", max: 30, windowMs: 60_000 },
  /** Quote endpoints: 20 per minute */
  quotes: { prefix: "quotes", max: 20, windowMs: 60_000 },
  /** Message endpoints: 30 per minute */
  messages: { prefix: "messages", max: 30, windowMs: 60_000 },
  /** Review endpoints: 10 per minute */
  reviews: { prefix: "reviews", max: 10, windowMs: 60_000 },
  /** Provider search: 60 per minute */
  providers: { prefix: "providers", max: 60, windowMs: 60_000 },
  /** Category listing: 30 per minute */
  categories: { prefix: "categories", max: 30, windowMs: 60_000 },
  /** Geo endpoints: 30 per minute */
  geo: { prefix: "geo", max: 30, windowMs: 60_000 },
  /** Search endpoints: 30 per minute */
  search: { prefix: "search", max: 30, windowMs: 60_000 },
  /** Upload endpoints: 10 per minute (files are expensive) */
  upload: { prefix: "upload", max: 10, windowMs: 60_000 },
} as const

/**
 * Pick the right rate limit preset based on the request path.
 * Returns the general preset as fallback.
 */
export function pickRateLimitForPath(pathname: string): EdgeRateLimitOptions {
  if (pathname.startsWith("/api/auth/login")) return EDGE_RATE_LIMITS.login
  if (pathname.startsWith("/api/auth/register")) return EDGE_RATE_LIMITS.register
  if (pathname.startsWith("/api/auth/forgot-password")) return EDGE_RATE_LIMITS.forgotPassword
  if (pathname.startsWith("/api/bookings")) return EDGE_RATE_LIMITS.bookings
  if (pathname.startsWith("/api/quotes")) return EDGE_RATE_LIMITS.quotes
  if (pathname.startsWith("/api/messages")) return EDGE_RATE_LIMITS.messages
  if (pathname.startsWith("/api/reviews")) return EDGE_RATE_LIMITS.reviews
  if (pathname.startsWith("/api/providers")) return EDGE_RATE_LIMITS.providers
  if (pathname.startsWith("/api/categories")) return EDGE_RATE_LIMITS.categories
  if (pathname.startsWith("/api/geo")) return EDGE_RATE_LIMITS.geo
  if (pathname.startsWith("/api/search")) return EDGE_RATE_LIMITS.search
  if (pathname.startsWith("/api/upload")) return EDGE_RATE_LIMITS.upload
  return EDGE_RATE_LIMITS.general
}
