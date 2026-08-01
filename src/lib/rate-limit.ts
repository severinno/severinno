/**
 * Rate limiter for Severinno Marketplace API routes.
 *
 * Uses Redis (sorted sets) for distributed rate limiting with in-memory
 * fallback when Redis is unavailable.
 *
 * Usage:
 *   import { rateLimit, checkRateLimit } from "@/lib/rate-limit"
 *
 *   // Inside a route handler:
 *   const result = await checkRateLimit(request, {
 *     prefix: "login",
 *     max: 10,
 *     windowMs: 60_000, // 1 minute
 *   })
 *   if (!result.allowed) {
 *     return NextResponse.json(
 *       { error: "Muitas requisições. Tente novamente em alguns segundos." },
 *       { status: 429, headers: rateLimitHeaders(result) },
 *     )
 *   }
 */

import { HttpError } from "@/lib/api-server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RateLimitResult = {
  /** Whether the request is allowed (under the limit). */
  allowed: boolean
  /** How many requests remain in the current window. */
  remaining: number
  /** Unix timestamp (ms) when the window resets. */
  reset: number
  /** Maximum requests per window. */
  limit: number
}

export type RateLimitOptions = {
  /** Key prefix (e.g. "login", "register", "providers"). */
  prefix: string
  /** Maximum requests in the window. */
  max: number
  /** Window duration in milliseconds (e.g. 60_000 = 1 min). */
  windowMs: number
  /** Optional custom identifier (defaults to client IP). */
  identifier?: string
}

// ---------------------------------------------------------------------------
// In-memory fallback store
// ---------------------------------------------------------------------------

type WindowEntry = {
  count: number
  resetAt: number
}

const memoryStore = new Map<string, WindowEntry>()

// Periodically clean expired entries (every 60s)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of memoryStore) {
      if (entry.resetAt < now) memoryStore.delete(key)
    }
  }, 60_000).unref?.()
}

// ---------------------------------------------------------------------------
// Extract client IP from request
// ---------------------------------------------------------------------------

function getClientIp(request: Request): string {
  // Try standard proxy headers in order
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const ip = forwarded.split(",")[0]?.trim()
    if (ip) return ip
  }
  const realIp = request.headers.get("x-real-ip")
  if (realIp) return realIp
  const cfIp = request.headers.get("cf-connecting-ip")
  if (cfIp) return cfIp

  // Fallback: use a hash of the request (not ideal but works)
  return "unknown"
}

// ---------------------------------------------------------------------------
// Rate limit headers helper
// ---------------------------------------------------------------------------

/**
 * Generate standard RateLimit headers for a 429 response.
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
    "Retry-After": String(Math.ceil((result.reset - Date.now()) / 1000)),
  }
}

// ---------------------------------------------------------------------------
// Rate limit check (Redis-based with in-memory fallback)
// ---------------------------------------------------------------------------

/**
 * Check if a request is within the rate limit.
 *
 * Uses Redis sorted sets with TTL for atomic increment + expiry.
 * Falls back to an in-memory Map when Redis is unavailable.
 *
 * @returns RateLimitResult — check `result.allowed` before proceeding.
 */
export async function checkRateLimit(
  request: Request,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const { prefix, max, windowMs, identifier: customId } = options
  const identifier = customId ?? getClientIp(request)
  const now = Date.now()
  const windowKey = Math.floor(now / windowMs) * windowMs // start of current window
  const redisKey = `ratelimit:${prefix}:${identifier}:${windowKey}`
  const reset = windowKey + windowMs

  // ---- Try Redis first (atomic INCR + EXPIRE) ----------------------------
  try {
    const redis = await getRedisClient()
    if (redis) {
      const count = await redis.incr(redisKey)
      if (count === 1) {
        // First request in this window — set TTL
        await redis.pexpire(redisKey, windowMs)
      }
      return {
        allowed: count <= max,
        remaining: Math.max(0, max - count),
        reset,
        limit: max,
      }
    }
  } catch {
    // Redis unavailable — fall through to in-memory
  }

  // ---- In-memory fallback -------------------------------------------------
  const existing = memoryStore.get(redisKey)
  if (existing && existing.resetAt > now) {
    existing.count++
    return {
      allowed: existing.count <= max,
      remaining: Math.max(0, max - existing.count),
      reset: existing.resetAt,
      limit: max,
    }
  }

  // New window entry
  memoryStore.set(redisKey, { count: 1, resetAt: reset })
  return {
    allowed: true,
    remaining: max - 1,
    reset,
    limit: max,
  }
}

// ---------------------------------------------------------------------------
// Lazy Redis client access (import from cache module)
// ---------------------------------------------------------------------------

async function getRedisClient(): Promise<import("ioredis").Redis | null> {
  try {
    const { default: Redis } = await import("ioredis")
    const url = process.env.REDIS_URL
    if (!url) return null
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // don't retry — return null immediately
      lazyConnect: true,
    })
    // Test connection
    await client.ping()
    return client
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Convenience: throw a Response if rate limited
// ---------------------------------------------------------------------------

/**
 * Quick rate limit check that throws an HttpError(429) if exceeded.
 * Compatible with the existing `handleError` in api-server.ts which
 * already maps HttpError → JSON response with correct status code.
 * Rate-limit headers are attached to the HttpError via `.headers`.
 *
 * Use this at the top of route handlers:
 *
 *   await assertRateLimit(request, { prefix: "login", max: 10, windowMs: 60_000 })
 */
export async function assertRateLimit(request: Request, options: RateLimitOptions): Promise<void> {
  const result = await checkRateLimit(request, options)
  if (!result.allowed) {
    const err = new HttpError(429, "Muitas requisições. Tente novamente em alguns segundos.")
    err.headers = rateLimitHeaders(result)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Preset rate limits for Severinno routes
// ---------------------------------------------------------------------------

export const RATE_LIMITS = {
  /** Login: 10 attempts per minute per IP */
  login: { prefix: "login", max: 10, windowMs: 60_000 },
  /** Register: 5 attempts per minute per IP */
  register: { prefix: "register", max: 5, windowMs: 60_000 },
  /** Password recovery: 3 attempts per 10 min per IP */
  forgotPassword: { prefix: "forgot-pw", max: 3, windowMs: 600_000 },
  /** Provider search: 100 requests per minute */
  providers: { prefix: "providers", max: 100, windowMs: 60_000 },
  /** Bookings (create + list): 30 requests per minute */
  bookings: { prefix: "bookings", max: 30, windowMs: 60_000 },
  /** Quotes (create + list): 20 requests per minute */
  quotes: { prefix: "quotes", max: 20, windowMs: 60_000 },
  /** Messages: 30 per minute */
  messages: { prefix: "messages", max: 30, windowMs: 60_000 },
  /** Reviews: 10 per minute */
  reviews: { prefix: "reviews", max: 10, windowMs: 60_000 },
  /** Geo endpoints (CEP + reverse): 30 per minute */
  geo: { prefix: "geo", max: 30, windowMs: 60_000 },
  /** Auth check (/api/auth/me): 30 per minute */
  authMe: { prefix: "auth-me", max: 30, windowMs: 60_000 },
  /** General API: 60 per minute */
  general: { prefix: "general", max: 60, windowMs: 60_000 },
  /** Payments (create + list): 10 per minute */
  payments: { prefix: "payments", max: 10, windowMs: 60_000 },
  /** Wallet transactions: 10 per minute */
  wallet: { prefix: "wallet", max: 10, windowMs: 60_000 },
  /** Wallet withdrawal: 3 per 10 minutes (high value) */
  walletWithdraw: { prefix: "wallet-withdraw", max: 3, windowMs: 600_000 },
  /** Settlements: 10 per minute */
  settlements: { prefix: "settlements", max: 10, windowMs: 60_000 },
  /** Push notifications send: 20 per minute */
  pushSend: { prefix: "push-send", max: 20, windowMs: 60_000 },
  /** Admin operations: 30 per minute */
  admin: { prefix: "admin", max: 30, windowMs: 60_000 },
  /** Webhook Lytex (pagamentos): 20 per minute — vem de IP fixo do Lytex */
  webhookLytex: { prefix: "webhook-lytex", max: 20, windowMs: 60_000 },
  /** Webhook Sentry/GlitchTip: 10 per minute */
  webhookSentry: { prefix: "webhook-sentry", max: 10, windowMs: 60_000 },
} as const
