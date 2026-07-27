/**
 * Redis caching layer for the Severinno Marketplace.
 *
 * Gracefully handles missing Redis — all operations fail silent so the app
 * keeps working without Redis (degraded, no caching).
 */

import { Redis } from "ioredis"

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"

let client: Redis | null = null

export function getClient(): Redis {
  if (!client) {
    client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null
        return Math.min(times * 200, 2000)
      },
      lazyConnect: true,
      enableOfflineQueue: false,
    })
    client.on("error", (err: Error) => {
      console.error("[redis] error:", err.message)
    })
  }
  return client
}

/**
 * Get a cached value by key. Returns null on miss or error.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getClient().get(key)
    if (raw === null) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/**
 * Set a cached value. ttl is in seconds (optional).
 */
export async function cacheSet(
  key: string,
  value: unknown,
  ttl?: number,
): Promise<void> {
  try {
    const serialized = JSON.stringify(value)
    if (ttl !== undefined && ttl > 0) {
      await getClient().setex(key, ttl, serialized)
    } else {
      await getClient().set(key, serialized)
    }
  } catch {
    // fail silently — cache is a perf optimisation, not a correctness requirement
  }
}

/**
 * Invalidate all keys matching a glob pattern (e.g. "cat:desc:*").
 */
export async function cacheInvalidate(pattern: string): Promise<void> {
  try {
    const keys = await getClient().keys(pattern)
    if (keys.length > 0) {
      await getClient().del(...keys)
    }
  } catch {
    // fail silently
  }
}

/**
 * Cache hit/miss counters for observability.
 * These are in-memory counters (not persisted to Redis) so they survive
 * Redis restarts but reset on app restart. Good enough for monitoring.
 */
let cacheHits = 0
let cacheMisses = 0

/**
 * Reset cache counters (useful for tests).
 */
export function resetCacheCounters(): void {
  cacheHits = 0
  cacheMisses = 0
}

/**
 * Expose current cache hit/miss stats.
 */
export function getCacheStats(): {
  hits: number
  misses: number
  total: number
  hitRatio: number | null
} {
  const total = cacheHits + cacheMisses
  return {
    hits: cacheHits,
    misses: cacheMisses,
    total,
    hitRatio: total > 0 ? +(cacheHits / total).toFixed(4) : null,
  }
}

/**
 * Cache-aside helper: returns cached value if present, otherwise calls `fn`,
 * stores the result, and returns it.
 *
 * Tracks hit/miss counters for observability.
 */
export async function withCache<T>(
  key: string,
  fn: () => Promise<T>,
  ttl?: number,
): Promise<T> {
  const cached = await cacheGet<T>(key)
  if (cached !== null) {
    cacheHits++
    return cached
  }

  cacheMisses++
  const result = await fn()
  await cacheSet(key, result, ttl)
  return result
}
