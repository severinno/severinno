/**
 * Core cache operations — tier-aware get/set/invalidate.
 */

import { Redis, Cluster } from "ioredis"
import { traceSpan } from "@/lib/tracing"
import { type Tier } from "./config"
import { activeTier, ensureConnected } from "./client"
import { degradeTier } from "./health"
import { memoryStore } from "./memory"
import { degradationCount } from "./degradation"

// ── Helper: scan keys (cluster-aware) ────────────────────────────────────

async function scanKeys(c: Redis | Cluster, pattern: string): Promise<string[]> {
  if (c instanceof Cluster) {
    const masters = c.nodes("master")
    const results = await Promise.all(
      masters.map(async (node) => {
        const keys: string[] = []
        let cursor = 0
        do {
          const [nextCursor, batch] = await node.scan(cursor, "MATCH", pattern)
          cursor = Number(nextCursor)
          for (const k of batch) {
            if (!keys.includes(k)) keys.push(k)
          }
        } while (cursor !== 0)
        return keys
      }),
    )
    const seen = new Set<string>()
    return results.flat().filter((k) => {
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }

  return c.keys(pattern)
}

// ── Hit/miss counters ───────────────────────────────────────────────────

let cacheHits = 0
let cacheMisses = 0

export function resetCacheCounters(): void {
  cacheHits = 0
  cacheMisses = 0
}

export function getCacheStats(): {
  hits: number
  misses: number
  total: number
  hitRatio: number | null
  redisAvailable: boolean | null
  memoryStoreSize: number
  activeTier: Tier
  degradationCount: number
} {
  const total = cacheHits + cacheMisses
  return {
    hits: cacheHits,
    misses: cacheMisses,
    total,
    hitRatio: total > 0 ? +(cacheHits / total).toFixed(4) : null,
    redisAvailable: activeTier !== "memory",
    memoryStoreSize: memoryStore.size,
    activeTier,
    degradationCount,
  }
}

export function getMemoryCacheDiagnostics(): {
  available: boolean
  size: number
  maxAgeMs: number | null
} {
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
    available: true,
    size: memoryStore.size,
    maxAgeMs,
  }
}

// ── Core cache operations ────────────────────────────────────────────────

export async function cacheGet<T>(key: string): Promise<T | null> {
  let triedTier: Tier | null = null

  if (activeTier !== "memory") {
    triedTier = activeTier
    try {
      const c = await ensureConnected()
      if (c) {
        const raw = await c.get(key)
        if (raw !== null) {
          try {
            return JSON.parse(raw) as T
          } catch {
            try {
              await c.del(key)
            } catch {
              /* best-effort */
            }
            return null
          }
        }
        return null
      }
    } catch {
      degradeTier(activeTier)
    }
  }

  if (triedTier !== null && activeTier !== "memory" && activeTier !== triedTier) {
    try {
      const c = await ensureConnected()
      if (c) {
        const raw = await c.get(key)
        if (raw !== null) {
          try {
            return JSON.parse(raw) as T
          } catch {
            try {
              await c.del(key)
            } catch {
              /* best-effort */
            }
            return null
          }
        }
        return null
      }
    } catch {
      degradeTier(activeTier)
    }
  }

  const item = memoryStore.get(key)
  if (!item) return null

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

export async function cacheSet(key: string, value: unknown, ttl?: number): Promise<void> {
  const serialized = JSON.stringify(value)
  const expiresAt = ttl !== undefined && ttl > 0 ? Date.now() + ttl * 1000 : null

  memoryStore.set(key, { value: serialized, expiresAt })

  if (activeTier !== "memory") {
    try {
      const c = await ensureConnected()
      if (c) {
        if (ttl !== undefined && ttl > 0) {
          await c.setex(key, ttl, serialized)
        } else {
          await c.set(key, serialized)
        }
        return
      }
    } catch {
      degradeTier(activeTier)
    }
  }
}

export async function cacheInvalidate(pattern: string): Promise<void> {
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

  if (activeTier !== "memory") {
    try {
      const c = await ensureConnected()
      if (c) {
        const keys = await scanKeys(c, pattern)
        if (keys.length > 0) {
          await c.del(...keys)
        }
      }
    } catch {
      degradeTier(activeTier)
    }
  }
}

export async function withCache<T>(
  key: string,
  fn: () => Promise<T>,
  ttl?: number,
  opts?: { staleGraceSeconds?: number },
): Promise<T> {
  return traceSpan(`cache.withCache`, async (span) => {
    span.setAttribute("cache.key", key.slice(0, 80))
    span.setAttribute("cache.tier", activeTier)

    const cached = await cacheGet<T>(key)
    if (cached !== null) {
      cacheHits++
      span.setAttribute("cache.hit", true)
      return cached
    }

    // SWR: check if there's a stale copy we can serve while revalidating
    const staleGrace = opts?.staleGraceSeconds
    if (staleGrace && staleGrace > 0) {
      const staleKey = `${key}:stale`
      const stale = await cacheGet<T>(staleKey)
      if (stale !== null) {
        span.setAttribute("cache.swr", true)
        // Revalidate in background (fire-and-forget)
        fn()
          .then((result) => {
            cacheSet(key, result, ttl)
            cacheSet(staleKey, result, (ttl ?? 0) + staleGrace)
          })
          .catch(() => {}) // stale is better than nothing
        return stale
      }
    }

    cacheMisses++
    span.setAttribute("cache.hit", false)
    const result = await fn()
    await cacheSet(key, result, ttl)

    // Store stale copy with extended TTL for future SWR
    if (staleGrace && staleGrace > 0) {
      await cacheSet(`${key}:stale`, result, (ttl ?? 0) + staleGrace)
    }

    return result
  })
}

export function isRedisAvailable(): boolean {
  return activeTier !== "memory"
}
