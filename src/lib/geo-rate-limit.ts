/**
 * geo-rate-limit.ts
 *
 * Sliding-window rate limiter for geo API endpoints (/api/geo/search and
 * /api/geo/cep).
 *
 * Uses the shared Redis client from redis.ts (supports both standalone and
 * Cluster mode) with an in-memory fallback when Redis is unavailable.
 *
 * Architecture:
 *
 *   ┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
 *   │  Request IP  │ ──→ │  Sorted Set Key   │ ──→ │  Allowed?    │
 *   │  + endpoint │     │  (sliding window) │     │  Remaining   │
 *   └─────────────┘     └──────────────────┘     └──────────────┘
 *
 * Sliding window via sorted sets:
 *   Key:   ratelimit:geo:{endpoint}:{ip}
 *   Score: Unix timestamp (ms) of each request
 *   Value: Unique member (timestamp-rand) to avoid duplicates
 *
 * Every check atomically:
 *   1. Removes entries older than windowMs (ZREMRANGEBYSCORE)
 *   2. Counts remaining entries (ZCARD)
 *   3. Adds the current request (ZADD)
 *   4. Sets TTL ≈ windowMs × 2 for auto-cleanup (EXPIRE)
 *
 * Per-endpoint limits:
 *   - search:  30 req/min (respects Nominatim usage policy)
 *   - cep:     60 req/min (ViaCEP is more permissive)
 *   - reverse: 30 req/min (same as search, uses Nominatim)
 *
 * Fallback: in-memory Map when Redis is unavailable. Degraded but functional.
 */

import { getClient, isRedisAvailable } from "@/lib/redis"
import { type Redis, type Cluster } from "ioredis"
import { HttpError } from "@/lib/api-server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GeoEndpoint = "search" | "cep" | "reverse"

export type GeoRateLimitConfig = {
  /** Maximum requests allowed in the sliding window. */
  max: number
  /** Window duration in milliseconds (e.g. 60_000 = 1 min). */
  windowMs: number
}

export type GeoRateLimitResult = {
  /** Whether the request is allowed (under the limit). */
  allowed: boolean
  /** How many requests remain in the current window. */
  remaining: number
  /** Unix timestamp (ms) when the window resets (sliding: oldest + windowMs). */
  reset: number
  /** Maximum requests per window. */
  limit: number
}

// ---------------------------------------------------------------------------
// Per-endpoint configuration
// ---------------------------------------------------------------------------

export const GEO_LIMITS: Record<GeoEndpoint, GeoRateLimitConfig> = {
  /** Nominatim Search: 1 req/s ≈ 30 req/min respects OSM policy. */
  search: { max: 30, windowMs: 60_000 },
  /** ViaCEP: more permissive, up to 60 req/min. */
  cep: { max: 60, windowMs: 60_000 },
  /** Nominatim Reverse: same policy as search. */
  reverse: { max: 30, windowMs: 60_000 },
}

// ---------------------------------------------------------------------------
// In-memory fallback store (degraded mode)
// ---------------------------------------------------------------------------

interface SlidingEntry {
  /** Sorted timestamps (ms) of recent requests. */
  timestamps: number[]
  /** When the last cleanup happened. */
  lastCleanup: number
}

const memoryStore = new Map<string, SlidingEntry>()

// Periodic cleanup of stale entries (every 60s)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of memoryStore) {
      // Remove entries older than 2× the maximum window (120s)
      entry.timestamps = entry.timestamps.filter((t) => now - t < 120_000)
      if (entry.timestamps.length === 0) {
        memoryStore.delete(key)
      }
    }
  }, 60_000).unref?.()
}

// ---------------------------------------------------------------------------
// Client IP extraction (proxy-aware)
// ---------------------------------------------------------------------------

/**
 * Extract client IP from request headers, supporting common proxy setups.
 *
 * Priority:
 *   1. x-forwarded-for (first IP — most common behind reverse proxies)
 *   2. x-real-ip (nginx)
 *   3. cf-connecting-ip (Cloudflare)
 *   4. Fallback: "unknown"
 */
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
  return "unknown"
}

// ---------------------------------------------------------------------------
// Hit/miss counters (observability)
// ---------------------------------------------------------------------------

let rateLimitAllowed = 0
let rateLimitBlocked = 0

/**
 * Reset rate limit counters (useful for tests).
 */
export function resetRateLimitCounters(): void {
  rateLimitAllowed = 0
  rateLimitBlocked = 0
}

/**
 * Full reset: clears counters, memory store, and per-IP entries.
 *
 * This is a hard reset — all in-memory tracking state is discarded.
 * Redis-backed entries are NOT cleared (they expire naturally via TTL).
 * Use this when you need to zero out the diagnostic dashboard counters
 * without restarting the server.
 *
 * Available via POST /api/admin/geo-rate-limit-status/reset
 */
export function resetRateLimiter(): void {
  resetRateLimitCounters()
  memoryStore.clear()
}

/**
 * Get accumulated allow/block counts since startup or last reset.
 */
export function getRateLimitCounters(): {
  allowed: number
  blocked: number
  total: number
  blockRatio: number | null
} {
  const total = rateLimitAllowed + rateLimitBlocked
  return {
    allowed: rateLimitAllowed,
    blocked: rateLimitBlocked,
    total,
    blockRatio: total > 0 ? +(rateLimitBlocked / total).toFixed(4) : null,
  }
}

// ---------------------------------------------------------------------------
// Rate limit headers
// ---------------------------------------------------------------------------

/**
 * Generate standard RateLimit headers for a response.
 * Follows the convention from rate-limit.ts for consistency.
 */
export function geoRateLimitHeaders(result: GeoRateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
    "Retry-After": String(Math.ceil((result.reset - Date.now()) / 1000)),
  }
}

// ---------------------------------------------------------------------------
// Sliding window check (Redis sorted sets)
// ---------------------------------------------------------------------------

/**
 * Check if a geo API request is within its rate limit using a sliding window.
 *
 * Uses Redis sorted sets for atomic sliding window across distributed instances.
 * Falls back to an in-memory Map when Redis is unavailable.
 *
 * @example
 * ```ts
 * const result = await checkGeoRateLimit(request, "search")
 * if (!result.allowed) {
 *   return NextResponse.json(
 *     { error: "Muitas requisições. Tente novamente em alguns segundos." },
 *     { status: 429, headers: geoRateLimitHeaders(result) },
 *   )
 * }
 * ```
 */
export async function checkGeoRateLimit(
  request: Request,
  endpoint: GeoEndpoint,
): Promise<GeoRateLimitResult> {
  const config = GEO_LIMITS[endpoint]
  const identifier = getClientIp(request)
  const now = Date.now()
  const redisKey = `ratelimit:geo:${endpoint}:${identifier}`
  const windowStart = now - config.windowMs

  // ── Attempt Redis (shared client, cluster-aware) ─────────────────────
  // isRedisAvailable() returns true when Redis (any tier) is active.
  // We try Redis unless all Redis tiers are unavailable.
  if (isRedisAvailable()) {
    try {
      const c = getClient()
      // Inside this block, isRedisAvailable was narrowed to true|null —
      // getClient() returns null when isRedisAvailable is explicitly false,
      // but the outer guard already handles that case.
      if (c) {
        return await redisSlidingWindow(c, redisKey, config, now, windowStart)
      }
    } catch {
      // Redis failed — fall through to in-memory
    }
  }

  // ── In-memory fallback ───────────────────────────────────────────────
  return memorySlidingWindow(redisKey, config, now, windowStart)
}

// ---------------------------------------------------------------------------
// Redis sliding window implementation
// ---------------------------------------------------------------------------

async function redisSlidingWindow(
  c: Redis | Cluster,
  key: string,
  config: GeoRateLimitConfig,
  now: number,
  windowStart: number,
): Promise<GeoRateLimitResult> {
  const member = `${now}-${Math.random().toString(36).slice(2, 8)}`

  // Pipeline: remove old entries → count → add current → set TTL
  const pipeline = (c as Redis).pipeline?.() ?? null

  if (pipeline) {
    pipeline.zremrangebyscore(key, 0, windowStart)
    pipeline.zcard(key)
    pipeline.zadd(key, now, member)
    pipeline.pexpire(key, config.windowMs * 2)
    const results = await pipeline.exec()
    if (results) {
      // zcard is index 1 — returns [null, count]
      const count = (results[1]?.[1] as number) ?? 0
      const allowed = count < config.max
      // Reset = when this window started + window duration
      const reset = windowStart + config.windowMs
      // Note: ZADD always runs (pipeline doesn't support conditional ops)
      // but since we record ALL requests including blocked ones, the count
      // already includes the current request. For the "remaining" calculation
      // we use count (before ADD) + 1 (the just-added member).

      // Track allowed/blocked for observability
      if (allowed) {
        rateLimitAllowed++
      } else {
        rateLimitBlocked++
      }

      return {
        allowed,
        remaining: Math.max(0, config.max - (count + 1)),
        reset,
        limit: config.max,
      }
    }
  }

  // Fallback: non-pipeline (e.g. Cluster mode where pipeline routes by slot)
  await c.zremrangebyscore(key, 0, windowStart)
  const count = await c.zcard(key)
  const allowed = count < config.max
  if (allowed) {
    // Only record the request if under the limit
    await c.zadd(key, now, member)
    await c.pexpire(key, config.windowMs * 2)
  }

  // Track allowed/blocked for observability
  if (allowed) {
    rateLimitAllowed++
  } else {
    rateLimitBlocked++
  }

  return {
    allowed,
    remaining: Math.max(0, config.max - (count + 1)),
    reset: windowStart + config.windowMs,
    limit: config.max,
  }
}

// ---------------------------------------------------------------------------
// In-memory sliding window implementation
// ---------------------------------------------------------------------------

function memorySlidingWindow(
  key: string,
  config: GeoRateLimitConfig,
  now: number,
  windowStart: number,
): GeoRateLimitResult {
  let entry = memoryStore.get(key)

  if (!entry || entry.lastCleanup < windowStart) {
    entry = { timestamps: [], lastCleanup: now }
    memoryStore.set(key, entry)
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
  entry.lastCleanup = now

  // Reset = oldest timestamp in window + window duration
  const firstTs = entry.timestamps.length > 0 ? entry.timestamps[0] : null
  const reset = firstTs !== null ? firstTs + config.windowMs : now + config.windowMs

  // Track allowed/blocked for observability
  if (allowed) {
    rateLimitAllowed++
  } else {
    rateLimitBlocked++
  }

  return {
    allowed,
    remaining: Math.max(0, config.max - count - (allowed ? 1 : 0)),
    reset,
    limit: config.max,
  }
}

// ---------------------------------------------------------------------------
// Convenience: throw if rate limited (compatible with apiRoute pattern)
// ---------------------------------------------------------------------------

/**
 * Quick rate limit check for geo endpoints that throws an HttpError(429)
 * if exceeded. Compatible with the existing `apiRoute` wrapper which catches
 * errors and maps them via `handleError`.
 *
 * Prefer this at the top of geo route handlers instead of manually calling
 * checkGeoRateLimit + returning a 429 response.
 *
 * @example
 * ```ts
 * export async function GET(request: Request) {
 *   return apiRoute(async () => {
 *     await assertGeoRateLimit(request, "search")
 *     // ... business logic
 *   })
 * }
 * ```
 */
export async function assertGeoRateLimit(request: Request, endpoint: GeoEndpoint): Promise<void> {
  const result = await checkGeoRateLimit(request, endpoint)
  if (!result.allowed) {
    // Use HttpError so handleError() in api-server.ts matches it correctly
    // and returns a proper 429 response with RateLimit headers.
    const err = new HttpError(429, "Muitas requisições. Tente novamente em alguns segundos.")
    err.headers = geoRateLimitHeaders(result)
    throw err
  }
}

/**
 * Type-guard helper: check if an error is a rate-limit 429 thrown by
 * assertGeoRateLimit, so route handlers can handle it specifically.
 * Since assertGeoRateLimit now throws HttpError, this is a convenience
 * wrapper over `instanceof HttpError && err.status === 429`.
 */
export function isGeoRateLimitError(
  e: unknown,
): e is HttpError & { headers: Record<string, string> } {
  return e instanceof HttpError && e.status === 429
}

// ── Testing exports (__testing__ prefix) ───────────────────────────────
//
// These are exported ONLY for unit tests.  Do NOT use them in production
// code.  The rate limiter state is managed automatically by
// checkGeoRateLimit / assertGeoRateLimit and the admin dashboard.
//
// See geo-rate-limit.test.ts for usage.

export {
  resetRateLimiter as __testing__resetRateLimiter,
  getRateLimitCounters as __testing__getRateLimitCounters,
}

// ---------------------------------------------------------------------------
// Diagnostics (admin dashboard)
// ---------------------------------------------------------------------------

/** Shape of the diagnostics for a single endpoint. */
export type RateLimitEndpointDiagnostics = {
  config: GeoRateLimitConfig
  /** Number of unique IPs tracked for this endpoint. */
  trackedIPs: number
  /** Top IPs by request count (up to 5 per endpoint). */
  topIPs: Array<{ ip: string; requests: number; remaining: number }>
}

export type RateLimitDiagnostics = {
  /** Per-endpoint configuration. */
  config: Record<GeoEndpoint, GeoRateLimitConfig>
  /** Whether Redis is currently available for rate limiting. */
  redisAvailable: boolean
  /** Total tracked IPs across all endpoints (in-memory store). */
  totalTrackedIPs: number
  /** Per-endpoint summary. */
  endpoints: Record<GeoEndpoint, RateLimitEndpointDiagnostics>
  /** Memory store size (total entries). */
  memoryStoreSize: number
  /** Accumulated allow/block counters since startup. */
  counters: { allowed: number; blocked: number; total: number; blockRatio: number | null }
  /** Timestamp of the snapshot. */
  timestamp: number
}

/**
 * Collect diagnostics snapshot of the geo rate limiter state.
 *
 * Reads the in-memory store to report:
 *   - How many unique IPs are tracked per endpoint
 *   - Top IPs by request count (up to 5 per endpoint)
 *   - Remaining capacity for each tracked IP
 *   - Redis vs in-memory usage
 *
 * This is a synchronous O(N) scan of the memoryStore — safe for diagnostic
 * use (typically < 1000 entries). Returns data from memory only; does NOT
 * query Redis (avoiding latency on the admin dashboard).
 */
export function getRateLimitDiagnostics(): RateLimitDiagnostics {
  const now = Date.now()
  const endpoints: GeoEndpoint[] = ["search", "cep", "reverse"]
  const redisAvailable = isRedisAvailable()

  // Build per-endpoint stats by parsing the in-memory store keys
  // Key format: ratelimit:geo:{endpoint}:{ip}
  const endpointData: Record<
    GeoEndpoint,
    {
      entries: Map<string, SlidingEntry>
      topIPs: Array<{ ip: string; requests: number; remaining: number }>
    }
  > = {
    search: { entries: new Map(), topIPs: [] },
    cep: { entries: new Map(), topIPs: [] },
    reverse: { entries: new Map(), topIPs: [] },
  }

  for (const [key, entry] of memoryStore) {
    // Only look at geo rate limit keys
    const match = key.match(/^ratelimit:geo:(search|cep|reverse):(.+)$/)
    if (!match) continue

    const ep = match[1] as GeoEndpoint
    const ip = match[2]
    const config = GEO_LIMITS[ep]
    const windowStart = now - config.windowMs

    // Filter out expired timestamps
    const activeTimestamps = entry.timestamps.filter((t) => t > windowStart)
    const remaining = Math.max(0, config.max - activeTimestamps.length - 1)

    endpointData[ep].entries.set(ip, entry)
    endpointData[ep].topIPs.push({ ip, requests: activeTimestamps.length, remaining })
  }

  // Sort each endpoint's top IPs descending by request count, take top 5
  const formattedEndpoints = {} as Record<
    GeoEndpoint,
    {
      config: GeoRateLimitConfig
      trackedIPs: number
      topIPs: Array<{ ip: string; requests: number; remaining: number }>
    }
  >

  let totalTrackedIPs = 0
  for (const ep of endpoints) {
    const data = endpointData[ep]
    data.topIPs.sort((a, b) => b.requests - a.requests)

    formattedEndpoints[ep] = {
      config: GEO_LIMITS[ep],
      trackedIPs: data.entries.size,
      topIPs: data.topIPs.slice(0, 5),
    }
    totalTrackedIPs += data.entries.size
  }

  return {
    config: GEO_LIMITS,
    redisAvailable,
    totalTrackedIPs,
    endpoints: formattedEndpoints,
    memoryStoreSize: memoryStore.size,
    counters: getRateLimitCounters(),
    timestamp: now,
  }
}
