/**
 * Redis cache helpers for the Severinno Marketplace.
 *
 * Uses ioredis with a singleton connection. Falls back to an in-memory Map
 * when Redis is unavailable (dev / misconfigured environments).
 *
 * Exports:
 *   cacheGet<T>(key)        — get a JSON value by key
 *   cacheSet<T>(key, val, ttlSec) — set a JSON value with TTL
 *   cacheInvalidate(pattern) — delete keys matching a glob pattern
 *   withCache(key, fetcher, ttlSec) — memoize: get or set+return
 */

import Redis from "ioredis"

// ---------------------------------------------------------------------------
// Singleton Redis client
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL || ""

function createClient(): Redis | null {
  if (!REDIS_URL) return null
  try {
    const client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null // give up after 3 retries
        return Math.min(times * 200, 2000)
      },
      lazyConnect: true, // don't block startup
    })
    client.on("error", () => {
      // silent — fallback to in-memory
    })
    return client
  } catch {
    return null
  }
}

const globalForRedis = globalThis as unknown as {
  redisClient: Redis | null
  redisFallback: Map<string, { value: string; expiresAt: number }>
}

if (!globalForRedis.redisClient) {
  globalForRedis.redisClient = createClient()
  globalForRedis.redisFallback = new Map()
}

const redis = globalForRedis.redisClient
const fallback = globalForRedis.redisFallback

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a cached JSON value by key.
 * Returns null on miss or error.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (redis) {
    try {
      const raw = await redis.get(key)
      if (raw === null) return null
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  // In-memory fallback
  const entry = fallback.get(key)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    fallback.delete(key)
    return null
  }
  try {
    return JSON.parse(entry.value) as T
  } catch {
    return null
  }
}

/**
 * Set a cached JSON value with TTL in seconds.
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  const raw = JSON.stringify(value)

  if (redis) {
    try {
      await redis.setex(key, ttlSeconds, raw)
      return
    } catch {
      // fall through to in-memory
    }
  }

  fallback.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 })
}

/**
 * Delete all keys matching a glob pattern (e.g. `cat:desc:*`).
 * Falls back to deleting the literal key when Redis is unavailable.
 */
export async function cacheInvalidate(pattern: string): Promise<void> {
  if (redis) {
    try {
      // SCAN-based deletion to avoid blocking
      let cursor = "0"
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100,
        )
        cursor = nextCursor
        if (keys.length > 0) {
          await redis.del(...keys)
        }
      } while (cursor !== "0")
      return
    } catch {
      // fall through
    }
  }

  // In-memory fallback — delete literal key or iterate
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1)
    for (const key of fallback.keys()) {
      if (key.startsWith(prefix)) {
        fallback.delete(key)
      }
    }
  } else {
    fallback.delete(pattern)
  }
}

/**
 * Memoize a fetcher function with Redis cache.
 *
 * Usage:
 *   const data = await withCache("my:key", () => fetchExpensive(), 300)
 */
export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number,
): Promise<T> {
  const cached = await cacheGet<T>(key)
  if (cached !== null) return cached

  const value = await fetcher()
  // Don't await the set — fire-and-forget for performance
  cacheSet(key, value, ttlSeconds).catch(() => {})
  return value
}
