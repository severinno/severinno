/**
 * Redis caching layer for the Severinno Marketplace.
 *
 * Supports both standalone Redis and Redis Cluster mode with automatic
 * three-tier fallback:
 *
 *   Tier 1 — Redis Cluster   (when REDIS_CLUSTER_MODE=true)
 *   Tier 2 — Standalone Redis (fallback when cluster fails)
 *   Tier 3 — In-memory Map    (always available, process-local)
 *
 * When the active tier fails, the system automatically degrades to the next
 * lower tier.  A periodic health check (every 30s) tries to recover to a
 * higher tier, restoring full performance transparently.
 *
 * Cluster mode is activated by setting REDIS_CLUSTER_MODE=true and
 * providing node addresses via REDIS_CLUSTER_NODES (comma-separated
 * host:port pairs).  In cluster mode, ioredis handles slot discovery,
 * MOVED/ASK redirections, and node failure transparently.
 *
 * Architecture:
 *   1. Tries the active tier (cluster or standalone Redis)
 *   2. On failure, degrades one tier and retries immediately
 *   3. Always writes to in-memory store, keeping the fallback warm
 *   4. Periodic health checks attempt recovery to higher tiers
 *
 * Expired in-memory entries are cleaned up every 60s.
 */

import { Redis, Cluster } from "ioredis"
import { captureMessage } from "@/lib/sentry"
import logger from "@/lib/logger"

// ── Configuration ─────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"
const REDIS_CLUSTER_MODE = process.env.REDIS_CLUSTER_MODE === "true"
const REDIS_CLUSTER_NODES = process.env.REDIS_CLUSTER_NODES || "localhost:6379"

/** Which Redis topology the application was configured to use. */
const configMode: "cluster" | "standalone" = REDIS_CLUSTER_MODE ? "cluster" : "standalone"

// ── Tiered client state ───────────────────────────────────────────────────
//
// We maintain up to two Redis clients (cluster + standalone) and an
// in-memory store.  The `activeTier` indicates which one should be used
// for operations.  When the active tier fails, we degrade automatically.
// A background timer attempts to recover to a higher tier every 30 s.
//
// Tiers (in priority order):
//   cluster    → Redis Cluster (fastest for distributed workloads)
//   standalone → Single-instance Redis (fast, no cluster overhead)
//   memory     → In-memory Map (always available, process-local)

let clusterClient: Cluster | null = null
let standaloneClient: Redis | null = null
type Tier = "cluster" | "standalone" | "memory"
let activeTier: Tier = configMode // start at the configured tier

/** Whether we have ever successfully connected to at least one tier. */
let everConnected = false

// ── Client factory ─────────────────────────────────────────────────────────

/**
 * Create a Redis client of the requested type.
 *
 * Cluster clients use ioredis Cluster (distributed, slot-aware).
 * Standalone clients use a plain ioredis Redis connection.
 *
 * No event handlers are attached here — they are wired up in
 * `ensureClient()` so we can react to tier changes.
 */
function createClient(mode: "cluster" | "standalone"): Cluster | Redis {
  if (mode === "cluster") {
    const nodes = REDIS_CLUSTER_NODES.split(",").map((s) => {
      const [host, portStr] = s.trim().split(":")
      return { host: host || "localhost", port: Number(portStr) || 6379 }
    })

    return new Cluster(nodes, {
      clusterRetryStrategy(times) {
        // Exponential backoff: 200ms, 400ms, 800ms, 1600ms, then stop
        if (times > 5) return null
        return Math.min(times * 200, 2000)
      },
      enableOfflineQueue: true,
      scaleReads: "master",
      redisOptions: {
        maxRetriesPerRequest: 2,
        lazyConnect: true,
        connectTimeout: 10_000,
      },
    })
  }

  // ── Standalone ──────────────────────────────────────────────────────
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) return null
      return Math.min(times * 200, 2000)
    },
    lazyConnect: true,
    enableOfflineQueue: false,
  })
}

// ── Ensure a client exists for the given tier ─────────────────────────────

/**
 * Ensure the client for `tier` exists and has event handlers wired.
 *
 * Creates the client on first call.  Event handlers respond to errors
 * by calling `degradeTier()`, which moves the active tier down and
 * potentially creates the next client.
 */
function ensureClient(tier: Tier): Cluster | Redis | null {
  if (tier === "memory") return null

  if (tier === "cluster") {
    if (!clusterClient) {
      clusterClient = createClient("cluster") as Cluster

      clusterClient.on("error", (err: Error) => {
        console.error(`[redis] cluster error: ${err.message}`)
        degradeTier("cluster")
      })
      clusterClient.on("ready", () => {
        activeTier = "cluster"
        everConnected = true
      })

      // Node-level events (partial cluster failure)
      clusterClient.on("node error", (err: Error, node: unknown) => {
        console.warn(`[redis] cluster node error (${JSON.stringify(node)}): ${err.message}`)
        // Don't degrade the whole cluster — one node may be down
        // while the rest continues to serve.
      })
      clusterClient.on("+node", (node: unknown) => {
        logger.info({ node: JSON.stringify(node) }, "[redis] cluster node added")
      })
      clusterClient.on("-node", (node: unknown) => {
        console.warn(`[redis] cluster node removed: ${JSON.stringify(node)}`)
      })
    }
    return clusterClient
  }

  // ── Standalone ──────────────────────────────────────────────────────
  if (!standaloneClient) {
    standaloneClient = createClient("standalone") as Redis

    standaloneClient.on("error", (err: Error) => {
      console.error(`[redis] standalone error: ${err.message}`)
      degradeTier("standalone")
    })
    standaloneClient.on("ready", () => {
      activeTier = "standalone"
      everConnected = true
    })
  }
  return standaloneClient
}

// ── Degrade to a lower tier ──────────────────────────────────────────────

/**
 * Degrade from the given failed tier to the next lower one.
 *
 * Called automatically when a client fires an "error" event or when
 * a cache operation catches an exception from the active client.
 *
 * The chain is:
 *   cluster → standalone → memory
 *
 * If the failed tier is already below the active tier (e.g. a stale
 * error from an old client), the call is ignored.
 */
let degradationCount = 0
/** Last Sentry alert timestamp (debounce: max 1 alert per 15 min). */
let lastDegradationAlertAt: number | null = null

/** Last proactive recovery timestamp (debounce: max 1 attempt per 60 min). */
let lastProactiveRecoveryAt: number | null = null

/** Debounce interval for degradation alerts (15 minutes). */
const DEGRADATION_ALERT_DEBOUNCE_MS = 15 * 60 * 1000

/** Debounce interval for proactive recovery (60 minutes). */
const PROACTIVE_RECOVERY_DEBOUNCE_MS = 60 * 60 * 1000

function degradeTier(failedTier: Tier): void {
  // Build the chain from the priority-ordered list
  const TIER_ORDER: Tier[] = ["cluster", "standalone", "memory"]

  // Determine which tier to fall back to
  const failedIdx = TIER_ORDER.indexOf(failedTier)
  if (failedIdx === -1) return

  // Only degrade if the failed tier is at or above the active tier
  const activeIdx = TIER_ORDER.indexOf(activeTier)
  if (failedIdx > activeIdx) return // stale error from a lower tier — ignore

  const nextTier = TIER_ORDER[activeIdx + 1]
  if (!nextTier) return // already at the lowest tier (memory)

  degradationCount++
  console.warn(
    `[redis] degrading from ${activeTier} to ${nextTier} ` +
      `(degradation #${degradationCount}, failed tier: ${failedTier})`,
  )

  // Alert Sentry when degradation count reaches 3+, indicating the cluster
  // has failed repeatedly and needs operational attention.
  // Debounced to max 1 alert per 15 min to prevent alert fatigue during
  // sustained outages where the 30s recovery cycle keeps failing.
  if (degradationCount >= 3) {
    const now = Date.now()
    if (
      lastDegradationAlertAt !== null &&
      now - lastDegradationAlertAt < DEGRADATION_ALERT_DEBOUNCE_MS
    ) {
      // Skip — still within debounce window
    } else {
      lastDegradationAlertAt = now
      captureMessage(
        `[Redis] Múltiplas degradações — ${degradationCount} desde o início`,
        "error",
        {
          degradationCount,
          currentTier: activeTier,
          nextTier,
          failedTier,
          configMode: REDIS_CLUSTER_MODE ? "cluster" : "standalone",
          degradationChain: `${activeTier} → ${nextTier}`,
        },
      )
    }
  }

  // ── Proactive auto-recovery ──────────────────────────────────────────
  //
  // When degradationCount reaches 5+, trigger GiST REINDEX (in case the
  // root cause is spatial index bloat) AND restart Redis clients with a
  // clean configuration.  Debounced to 1 attempt per 60 min.
  //
  // Fire-and-forget — non-blocking, best-effort recovery.
  if (degradationCount === 5 || (degradationCount > 5 && degradationCount % 10 === 0)) {
    const now = Date.now()
    if (
      lastProactiveRecoveryAt === null ||
      now - lastProactiveRecoveryAt >= PROACTIVE_RECOVERY_DEBOUNCE_MS
    ) {
      lastProactiveRecoveryAt = now
      proactiveRecovery().catch(() => {
        /* fire-and-forget — errors are logged inside proactiveRecovery */
      })
    }
  }

  activeTier = nextTier

  // Ensure the next tier's client exists so it's ready on first use
  if (nextTier !== "memory") {
    ensureClient(nextTier as "cluster" | "standalone")
  }
}

// ── Proactive recovery (GiST REINDEX + Redis restart) ────────────────────
//
// When the system has degraded 5+ times, it proactively:
//   1. REINDEXes PostGIS spatial indexes (if GiST bloat is the root cause)
//   2. Restarts Redis clients with a clean slate
//
// Both steps are fire-and-forget (best-effort).  The GiST REINDEX uses
// REINDEX CONCURRENTLY so it does not block the application.

/**
 * Spatial indexes to REINDEX during proactive recovery.
 * These are the PostGIS GiST indexes used by proximity queries.
 */
const SPATIAL_INDEXES = [
  "idx_user_location_gist",
  "idx_booking_location_gist",
  "idx_quoterequest_location_gist",
] as const

/**
 * Fire-and-forget GiST REINDEX.
 *
 * Best-effort: if Prisma is unavailable or the index doesn't exist,
 * the error is logged and the recovery continues.
 */
async function tryReindexGiST(): Promise<void> {
  try {
    const { db } = await import("@/lib/db")
    for (const name of SPATIAL_INDEXES) {
      try {
        const start = performance.now()
        await db.$executeRawUnsafe(`REINDEX INDEX CONCURRENTLY IF EXISTS "${name}"`)
        logger.info(
          { indexName: name, durationMs: Math.round(performance.now() - start) },
          "[proactive] GiST REINDEX completed",
        )
      } catch (err) {
        logger.warn({ indexName: name, err }, "[proactive] GiST REINDEX failed (non-blocking)")
      }
    }
    captureMessage("[Redis] Proactive recovery — GiST REINDEX concluído", "info", {
      degradationCount,
    })
  } catch (err) {
    logger.warn({ err }, "[proactive] GiST REINDEX unavailable (Prisma not loaded)")
  }
}

/**
 * Fire-and-forget Redis client restart.
 *
 * Disposes all existing clients and creates fresh ones for the configured
 * tier.  The 30s health check timer will promote back up if higher tiers
 * become available.
 */
async function restartRedisClients(): Promise<void> {
  // Dispose old clients
  if (clusterClient) {
    try {
      clusterClient.disconnect()
    } catch {
      /* ignore */
    }
    clusterClient = null
  }
  if (standaloneClient) {
    try {
      standaloneClient.disconnect()
    } catch {
      /* ignore */
    }
    standaloneClient = null
  }

  // Reset to configured tier and create a fresh client
  // configMode is always "cluster" or "standalone" — never "memory"
  activeTier = configMode
  ensureClient(configMode)

  logger.info(
    { newTier: configMode, degradationCount },
    "[proactive] Redis clients restarted with clean configuration",
  )

  captureMessage("[Redis] Proactive recovery — clients reiniciados", "info", {
    degradationCount,
    newTier: configMode,
  })
}

/**
 * Fire-and-forget proactive recovery orchestrator.
 *
 * Steps:
 *   1. GiST REINDEX (spatial indexes, non-blocking)
 *   2. Redis client restart (fresh connections)
 *
 * Errors are logged inside each step — the orchestrator never throws.
 */
async function proactiveRecovery(): Promise<void> {
  logger.warn({ degradationCount }, "[proactive] Starting proactive recovery")

  await tryReindexGiST()
  await restartRedisClients()
}

// ── Get the current active client ─────────────────────────────────────────

/**
 * Return the Redis client for the currently active tier.
 *
 * Returns `null` when the active tier is "memory" (no Redis available).
 */
export function getClient(): Redis | Cluster | null {
  if (activeTier === "memory") return null
  return ensureClient(activeTier as "cluster" | "standalone")
}

// ── Tier info (exported for observability) ────────────────────────────────

/**
 * Current active cache tier — useful for monitoring and the admin dashboard.
 */
export { activeTier as currentTier }

/**
 * Whether we have ever successfully connected to any Redis tier.
 */
export { everConnected as hasEverConnected }

// ── Periodic health check + recovery (every 30s) ──────────────────────────
//
// When the active tier is not the highest possible, we periodically try to
// recover to a higher tier:
//
//   memory → try standalone → standalone → try cluster (if configured)

const REDIS_RECHECK_MS = 30_000
let recheckTimer: ReturnType<typeof setInterval> | null = null
let isRecovering = false

/**
 * Attempt to recover to a higher tier.
 *
 * For each tier above the current one, try to create a fresh client and
 * ping it.  The first tier that succeeds becomes the new active tier.
 *
 * Exported for testing — do NOT call directly in production code.
 * The recovery timer (checkRedis) manages this automatically every 30s.
 */
async function tryRecoverTier(): Promise<void> {
  const TIER_ORDER: Tier[] = ["cluster", "standalone", "memory"]
  const activeIdx = TIER_ORDER.indexOf(activeTier)

  // No higher tier to recover to (already at cluster)
  if (activeIdx <= 0) return

  // Try tiers above the current one, from highest to lowest
  for (let i = activeIdx - 1; i >= 0; i--) {
    const targetTier = TIER_ORDER[i]

    // Skip cluster if we are configured for standalone
    if (targetTier === "cluster" && configMode !== "cluster") continue

    // Skip standalone if we are already at standalone and want cluster
    if (targetTier === "standalone" && activeTier === "standalone" && activeIdx === 1) continue

    let tempClient: Redis | Cluster | null = null
    try {
      // Create a temporary client and ping
      tempClient = createClient(targetTier as "cluster" | "standalone")
      tempClient.on("error", () => {}) // suppress errors
      await tempClient.ping()

      // Success!  Dispose any stale clients and promote to this tier
      if (targetTier === "cluster" && clusterClient && clusterClient !== tempClient) {
        try {
          clusterClient.disconnect()
        } catch {
          /* ignore */
        }
        clusterClient = tempClient as Cluster
        // Re-attach event handlers
        clusterClient.on("error", (err: Error) => {
          console.error(`[redis] cluster error: ${err.message}`)
          degradeTier("cluster")
        })
        clusterClient.on("ready", () => {
          activeTier = "cluster"
          everConnected = true
        })
        clusterClient.on("node error", (err: Error, node: unknown) => {
          console.warn(`[redis] cluster node error (${JSON.stringify(node)}): ${err.message}`)
        })
        clusterClient.on("+node", (node: unknown) => {
          logger.info({ node: JSON.stringify(node) }, "[redis] cluster node added")
        })
        clusterClient.on("-node", (node: unknown) => {
          console.warn(`[redis] cluster node removed: ${JSON.stringify(node)}`)
        })
      } else if (
        targetTier === "standalone" &&
        standaloneClient &&
        standaloneClient !== tempClient
      ) {
        try {
          standaloneClient.disconnect()
        } catch {
          /* ignore */
        }
        standaloneClient = tempClient as Redis
        standaloneClient.on("error", (err: Error) => {
          console.error(`[redis] standalone error: ${err.message}`)
          degradeTier("standalone")
        })
        standaloneClient.on("ready", () => {
          activeTier = "standalone"
          everConnected = true
        })
      } else {
        // First-time client — ensureClient will wire events
        if (targetTier === "cluster") clusterClient = tempClient as Cluster
        else standaloneClient = tempClient as Redis
      }

      activeTier = targetTier
      everConnected = true
      logger.info({ targetTier }, "[redis] recovered tier")

      // If we recovered to standalone and cluster was the original config,
      // we'll wait for the next tick to try cluster recovery
      if (targetTier === "standalone" && configMode === "cluster") {
        // Try cluster on the next poll cycle
        return
      }

      return // success — stop trying higher tiers
    } catch {
      // Failed to reach this tier — try the next one
      if (tempClient) {
        try {
          tempClient.disconnect()
        } catch {
          /* ignore */
        }
      }
      continue
    }
  }
}

async function checkRedis(): Promise<void> {
  // Prevent concurrent recovery attempts
  if (isRecovering) return
  isRecovering = true

  try {
    // Only run recovery when we are below the top tier
    if (activeTier === "cluster") return

    await tryRecoverTier()

    // If we recovered to standalone but the original config was cluster,
    // immediately try to recover to cluster
    if (activeTier === "standalone" && configMode === "cluster") {
      await tryRecoverTier()
    }
  } finally {
    isRecovering = false
  }
}

function startRecheckTimer(): void {
  if (recheckTimer) return
  recheckTimer = setInterval(async () => {
    await checkRedis()
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

// ── Helper: scan keys (cluster-aware) ────────────────────────────────────

/**
 * Collect all keys matching a glob pattern, cluster-safe.
 *
 * In standalone mode: uses Redis KEYS (small datasets, admin use only).
 * In cluster mode: iterates over all master nodes via SCAN to avoid
 * CROSSSLOT errors that KEYS would trigger.
 *
 * @returns Deduplicated list of matching keys across the cluster.
 */
async function scanKeys(c: Redis | Cluster, pattern: string): Promise<string[]> {
  if (c instanceof Cluster) {
    // Cluster mode: SCAN each master and collect
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
    // Deduplicate (same key may appear on multiple nodes during slot migration)
    const seen = new Set<string>()
    return results.flat().filter((k) => {
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }

  // Standalone mode: KEYS is fine for admin usage
  return c.keys(pattern)
}

// ── Core cache operations (tier-aware) ────────────────────────────────────
//
// Each operation tries the current active tier, and on failure, calls
// degradeTier() then falls through to the next tier inline (so the
// calling function does not need to retry — the fallback is immediate).

/**
 * Get a cached value by key.
 *
 * Strategy:
 *   1. Try the active Redis tier (cluster or standalone)
 *   2. On failure, degrade one tier and retry (once)
 *   3. On final failure, fall back to in-memory store
 *
 * Returns null on miss, expired entry, or all tiers exhausted.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  // ── Attempt active Redis tier ─────────────────────────────────────────
  let triedTier: Tier | null = null

  if (activeTier !== "memory") {
    triedTier = activeTier
    try {
      const c = getClient()
      if (c) {
        const raw = await c.get(key)
        if (raw !== null) {
          return JSON.parse(raw) as T
        }
        // Redis returned null → not cached in Redis (don't fall through to memory)
        return null
      }
    } catch {
      // Connection refused, timeout, etc. — degrade to next tier
      degradeTier(activeTier)
      // Fall through to retry or in-memory
    }
  }

  // ── Retry with the new active tier (if we just degraded) ─────────────
  if (triedTier !== null && activeTier !== "memory" && activeTier !== triedTier) {
    try {
      const c = getClient()
      if (c) {
        const raw = await c.get(key)
        if (raw !== null) {
          return JSON.parse(raw) as T
        }
        return null
      }
    } catch {
      // Second failure — fall through to in-memory
      degradeTier(activeTier)
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
 * Always writes to the in-memory store (keeps it warm for instant fallback).
 * Also writes to the active Redis tier when available.
 *
 * @param key   - Cache key
 * @param value - Any JSON-serializable value
 * @param ttl   - Time-to-live in seconds (optional). 0 or negative = no expiry.
 */
export async function cacheSet(key: string, value: unknown, ttl?: number): Promise<void> {
  const serialized = JSON.stringify(value)
  const expiresAt = ttl !== undefined && ttl > 0 ? Date.now() + ttl * 1000 : null

  // Always persist in memory (keeps fallback warm)
  memoryStore.set(key, { value: serialized, expiresAt })

  // Best-effort write to active Redis tier
  if (activeTier !== "memory") {
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
      degradeTier(activeTier)
    }
  }
}

/**
 * Invalidate all keys matching a glob pattern (e.g. "proximity:*").
 *
 * Always clears matching keys from the in-memory store.
 * Also tries the active Redis tier when available.
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

  // ── Clear active Redis tier ───────────────────────────────────────────
  if (activeTier !== "memory") {
    try {
      const c = getClient()
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
 * Get combined cache stats (all tiers).
 */
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
 * Works transparently across all three tiers (cluster, standalone, memory).
 * Hit/miss counters are updated automatically.
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
export async function withCache<T>(key: string, fn: () => Promise<T>, ttl?: number): Promise<T> {
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
 * Check if Redis (any tier) is currently available.
 * Returns true when cluster or standalone is the active tier.
 */
export function isRedisAvailable(): boolean {
  return activeTier !== "memory"
}

// ── Cluster / standalone diagnostics (admin dashboard) ────────────────────

export type ClusterNodeInfo = {
  host: string
  port: number
  /** Key count on this node (approximate, from DBSIZE). */
  dbSize: number
  /** Whether the node responded to ping. */
  reachable: boolean
  /** Sample of up to 20 keys on this node. */
  sampleKeys: string[]
}

export type SlotRange = {
  start: number
  end: number
  node: { host: string; port: number }
}

export type RedisDiagnostics = {
  /** Overall Redis availability (any tier). */
  available: boolean | null
  /** Whether we are configured for cluster mode. */
  clusterMode: boolean
  /** The currently active cache tier. */
  activeTier: Tier
  /** Number of degradations since server start. */
  degradationCount: number
  /** Cluster nodes (empty array in standalone/memory mode). */
  clusterNodes: ClusterNodeInfo[]
  /** Slot distribution across cluster nodes (empty array when not in cluster). */
  slotDistribution: SlotRange[]
  /** Standalone diagnostics (null in cluster mode). */
  standalone: {
    dbSize: number
    /** Up to 100 sample keys (via KEYS). */
    sampleKeys: string[]
  } | null
  /** Hit/miss counters from module-level tracking. */
  hitRatio: number | null
  hits: number
  misses: number
  /** In-memory fallback store size. */
  memoryStoreSize: number
  /** Timestamp of the diagnostics snapshot. */
  timestamp: number
}

/**
 * Collect comprehensive Redis diagnostics.
 *
 * In cluster mode, queries each master node for key count, sample keys, and
 * reads the cluster SLOTS to show slot distribution.
 *
 * In standalone mode, returns DBSIZE and a key sample via KEYS.
 *
 * Gracefully handles unavailability — returns partial results with
 * available=false rather than throwing.
 */
// ── Testing exports (__testing__ prefix) ───────────────────────────────
//
// These are exported ONLY for unit tests.  Do NOT use them in production
// code.  The degradation/recovery chain is managed automatically by the
// event handlers on Redis clients (degradeTier) and the periodic health
// check timer (tryRecoverTier).
//
// See redis-degradation-chain.test.ts for usage.
export { degradeTier as __testing__degradeTier, tryRecoverTier as __testing__tryRecoverTier }

/**
 * Reset the degradation state to the configured starting tier.
 *
 * Exported ONLY for property-based tests — avoids re-importing the module
 * between fast-check runs (expensive due to vi.resetModules + async import).
 *
 * Resets:
 *   - activeTier → configMode (cluster or standalone, depending on env)
 *   - degradationCount → 0
 *   - lastDegradationAlertAt → null
 *   - everConnected → false
 */
export function __testing__resetDegradationState(): void {
  activeTier = configMode
  degradationCount = 0
  lastDegradationAlertAt = null
  lastProactiveRecoveryAt = null
  everConnected = false
}

/**
 * Collect comprehensive Redis diagnostics.
 *
 * In cluster mode, queries each master node for key count, sample keys, and
 * reads the cluster SLOTS to show slot distribution.
 *
 * In standalone mode, returns DBSIZE and a key sample via KEYS.
 *
 * Gracefully handles unavailability — returns partial results with
 * available=false rather than throwing.
 */
export async function getRedisDiagnostics(): Promise<RedisDiagnostics> {
  const timestamp = Date.now()
  const stats = getCacheStats()

  const base: Omit<RedisDiagnostics, "clusterNodes" | "slotDistribution" | "standalone"> = {
    available: activeTier !== "memory",
    clusterMode: REDIS_CLUSTER_MODE,
    activeTier,
    degradationCount,
    hitRatio: stats.hitRatio,
    hits: stats.hits,
    misses: stats.misses,
    memoryStoreSize: memoryStore.size,
    timestamp,
  }

  if (activeTier === "memory") {
    return {
      ...base,
      available: false,
      clusterNodes: [],
      slotDistribution: [],
      standalone: null,
    }
  }

  const c = getClient()
  if (!c) {
    return {
      ...base,
      available: false,
      clusterNodes: [],
      slotDistribution: [],
      standalone: null,
    }
  }

  if (activeTier === "cluster" && c instanceof Cluster) {
    // ── Cluster mode ───────────────────────────────────────────────────
    let clusterNodes: ClusterNodeInfo[] = []
    let slotDistribution: SlotRange[] = []

    // Read slot distribution via CLUSTER SLOTS
    try {
      const rawSlots = (await c.cluster("SLOTS")) as unknown as Array<
        [number, number, [string, number, string], ...[string, number, string][]]
      >
      slotDistribution = rawSlots.map(([start, end, master]) => ({
        start,
        end,
        node: {
          host: master[0],
          port: master[1],
        },
      }))
    } catch {
      // Slot info may not be available if cluster is degraded
    }

    // Query each master node
    try {
      const masters = c.nodes("master")
      const nodeInfos = await Promise.all(
        masters.map(async (node) => {
          const addr = node.options
          const host = (addr as { host?: string; port?: number }).host ?? "unknown"
          const port = (addr as { host?: string; port?: number }).port ?? 6379

          let dbSize = 0
          let sampleKeys: string[] = []
          let reachable = false

          try {
            await node.ping()
            reachable = true

            try {
              dbSize = Number(await node.dbsize()) || 0
            } catch {
              /* ignore */
            }

            try {
              const keys: string[] = []
              let cursor = 0
              do {
                const [nextCursor, batch] = await node.scan(cursor, "COUNT", "50")
                cursor = Number(nextCursor)
                for (const k of batch) {
                  if (!keys.includes(k)) keys.push(k)
                  if (keys.length >= 20) break
                }
              } while (cursor !== 0 && keys.length < 20)
              sampleKeys = keys
            } catch {
              /* SCAN may fail */
            }
          } catch {
            /* Node unreachable */
          }

          return { host, port, dbSize, reachable, sampleKeys }
        }),
      )
      clusterNodes = nodeInfos
    } catch {
      /* Nodes info may not be available */
    }

    return {
      ...base,
      available: true,
      clusterNodes,
      slotDistribution,
      standalone: null,
    }
  }

  // ── Standalone mode (including when degraded from cluster) ───────────
  try {
    const dbSize = Number(await (c as Redis).dbsize()) || 0
    let sampleKeys: string[] = []
    try {
      const keys = await (c as Redis).keys("*")
      sampleKeys = keys.slice(0, 100)
    } catch {
      /* KEYS may fail on large datasets */
    }

    return {
      ...base,
      standalone: { dbSize, sampleKeys },
      clusterNodes: [],
      slotDistribution: [],
    }
  } catch {
    return {
      ...base,
      available: false,
      standalone: { dbSize: 0, sampleKeys: [] },
      clusterNodes: [],
      slotDistribution: [],
    }
  }
}
