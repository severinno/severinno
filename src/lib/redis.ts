/**
 * Redis caching layer for the Severinno Marketplace.
 *
 * Gracefully handles missing Redis — all operations automatically fall back
 * to an in-memory Map with TTL management when Redis is unavailable.
 *
 * Architecture:
 *   1. Tries Redis first (fast, distributed, persistent)
 *   2. Falls back to in-memory Map (degraded but functional, process-local)
 *   3. Periodically checks if Redis is back online (every 30s)
 *
 * The in-memory store is also written on every cacheSet so it stays warm
 * even when Redis is available — if Redis goes down, the cache is already
 * populated in memory.
 *
 * Expired entries are cleaned up every 60s.
 */

import { Redis } from "ioredis"

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"

// ── Redis client (singleton) ──────────────────────────────────────────────

let client: Redis | null = null
let redisAvailable: boolean | null = null // null = untested, true = up, false = down

export function getClient(): Redis | null {
  if (redisAvailable === false) return null

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
      redisAvailable = false
    })
    client.on("ready", () => {
      redisAvailable = true
    })
  }
  return client
}

// ── Periodic Redis health check (every 30s) ───────────────────────────────
// When Redis goes down, we poll periodically to detect recovery.
// Once it's back, subsequent cache operations go back to Redis.

const REDIS_RECHECK_MS = 30_000
let recheckTimer: ReturnType<typeof setInterval> | null = null

async function checkRedis(): Promise<void> {
  try {
    // Create a temporary connection for the health check
    const c = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      lazyConnect: true,
      connectTimeout: 5_000,
    })
    await c.ping()
    c.disconnect()

    // Reset the singleton so getClient() creates a fresh connection
    client = null
    redisAvailable = true
  } catch {
    redisAvailable = false
  }
}

function startRecheckTimer(): void {
  if (recheckTimer) return
  recheckTimer = setInterval(async () => {
    if (redisAvailable === false) {
      await checkRedis()
    }
  }, REDIS_RECHECK_MS)
  if (typeof recheckTimer?.unref === "function") {
    recheckTimer.unref()
  }
}

// ── In-memory fallback store ──────────────────────────────────────────────

interface MemoryItem {
  value: string
  expiresAt: number | null // null = never expires
}

const memoryStore = new Map<string, MemoryItem>()

// Periodic cleanup of expired entries (every 60s)
const MEMORY_CLEANUP_MS = 60_000
let cleanupTimer: ReturnType<typeof setInterval> | null = null

function startCleanupTimer(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, item] of memoryStore) {
      if (item.expiresAt !== null && item.expiresAt < now) {
        memoryStore.delete(key)
      }
    }
  }, MEMORY_CLEANUP_MS)
  if (typeof cleanupTimer?.unref === "function") {
    cleanupTimer.unref()
  }
}

// Start background timers (safe in Node.js, gracefully skipped in Edge)
if (typeof setInterval !== "undefined") {
  startCleanupTimer()
  startRecheckTimer()
}

// ── Core cache operations ─────────────────────────────────────────────────

/**
 * Get a cached value by key.
 *
 * Strategy:
 *   1. If Redis is (or might be) available, try Redis GET
 *   2. On success → return parsed value
 *   3. If Redis fails → mark as unavailable, fall through to memory
 *   4. Check in-memory store for a non-expired entry
 *
 * Returns null on miss, expired entry, or any error.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  // ── Attempt Redis ─────────────────────────────────────────────────────
  if (redisAvailable !== false) {
    try {
      const c = getClient()
      if (c) {
        const raw = await c.get(key)
        if (raw !== null) {
          return JSON.parse(raw) as T
        }
        // Redis returned null → not cached
        return null
      }
    } catch {
      // Connection refused, timeout, etc.
      redisAvailable = false
      // Fall through to in-memory
    }
  }

  // ── In-memory fallback ─────────────────────────────────────────────────
  const item = memoryStore.get(key)
  if (!item) return null

  // Check TTL expiry
  if (item.expiresAt !== null && item.expiresAt < Date.now()) {
    memoryStore.delete(key)
    return null
  }

  try {
    return JSON.parse(item.value) as T
  } catch {
    memoryStore.delete(key)
    return null
  }
}

/**
 * Set a cached value.
 *
 * Always writes to the in-memory store (keeps it warm).
 * Also writes to Redis when available.
 *
 * @param key   - Cache key
 * @param value - Any JSON-serializable value
 * @param ttl   - Time-to-live in seconds (optional). 0 or negative = no expiry.
 */
export async function cacheSet(
  key: string,
  value: unknown,
  ttl?: number,
): Promise<void> {
  const serialized = JSON.stringify(value)
  const expiresAt = ttl !== undefined && ttl > 0
    ? Date.now() + ttl * 1000
    : null

  // Always persist in memory (keeps fallback warm)
  memoryStore.set(key, { value: serialized, expiresAt })

  // Best-effort Redis write
  if (redisAvailable !== false) {
    try {
      const c = getClient()
      if (c) {
        if (ttl !== undefined && ttl > 0) {
          await c.setex(key, ttl, serialized)
        } else {
          await c.set(key, serialized)
        }
        return
      }
    } catch {
      redisAvailable = false
    }
  }
}

/**
 * Invalidate all keys matching a glob pattern (e.g. "proximity:*").
 *
 * Always clears matching keys from the in-memory store.
 * Also tries Redis keys/del when available.
 *
 * Supported patterns:
 *   - "prefix:*"   → matches keys starting with "prefix:"
 *   - "exact:key"  → matches the exact key "exact:key"
 */
export async function cacheInvalidate(pattern: string): Promise<void> {
  // ── Clear in-memory store ─────────────────────────────────────────────
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1)
    for (const key of memoryStore.keys()) {
      if (key.startsWith(prefix)) {
        memoryStore.delete(key)
      }
    }
  } else if (memoryStore.has(pattern)) {
    memoryStore.delete(pattern)
  }

  // ── Clear Redis (best-effort) ─────────────────────────────────────────
  if (redisAvailable !== false) {
    try {
      const c = getClient()
      if (c) {
        const keys = await c.keys(pattern)
        if (keys.length > 0) {
          await c.del(...keys)
        }
      }
    } catch {
      redisAvailable = false
    }
  }
}

// ── Hit/miss counters (observability) ─────────────────────────────────────

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
 * Get combined cache stats (Redis + in-memory).
 */
export function getCacheStats(): {
  hits: number
  misses: number
  total: number
  hitRatio: number | null
  redisAvailable: boolean | null
  memoryStoreSize: number
} {
  const total = cacheHits + cacheMisses
  return {
    hits: cacheHits,
    misses: cacheMisses,
    total,
    hitRatio: total > 0 ? +(cacheHits / total).toFixed(4) : null,
    redisAvailable,
    memoryStoreSize: memoryStore.size,
  }
}

/**
 * Get detailed in-memory cache diagnostics (admin dashboard).
 */
export function getMemoryCacheDiagnostics(): {
  available: boolean
  size: number
  maxAgeMs: number | null
} {
  // Compute the oldest entry's remaining TTL (best-effort)
  let maxAgeMs: number | null = null
  const now = Date.now()
  for (const [, item] of memoryStore) {
    if (item.expiresAt !== null) {
      const remaining = item.expiresAt - now
      if (maxAgeMs === null || remaining > maxAgeMs) {
        maxAgeMs = remaining
      }
    }
  }

  return {
    available: true, // memory store is always available
    size: memoryStore.size,
    maxAgeMs,
  }
}

// ── Cache-aside helper (main entry point for consumers) ───────────────────

/**
 * Cache-aside helper: returns cached value if present, otherwise calls `fn`,
 * stores the result, and returns it.
 *
 * Works transparently with both Redis (fast) and in-memory fallback (slow but
 * always available). Hit/miss counters are updated automatically.
 *
 * @param key - Cache key
 * @param fn  - Factory function to produce the value on cache miss
 * @param ttl - Time-to-live in seconds (optional)
 *
 * @example
 * ```ts
 * const data = await withCache("my:key", () => fetchExpensiveData(), 60)
 * ```
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

/**
 * Check if Redis is currently available (exported for health endpoints).
 * Null = not yet tested, true = available, false = unavailable.
 */
export { redisAvailable as isRedisAvailable }
