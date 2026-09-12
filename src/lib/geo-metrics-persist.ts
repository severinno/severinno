/**
 * geo-metrics-persist.ts
 *
 * Persists geo metrics snapshots to disk so the historical record survives
 * server restarts. Previously, the snapshot history was purely in-memory
 * (ring buffer, max 60 entries) and lost on every restart.
 *
 * What it does:
 *   1. Every time getGeoMetrics() computes a snapshot, this module saves
 *      it to docs/benchmarks/metrics/{timestamp}.json.
 *   2. On module init, loads all snapshots from disk into the in-memory
 *      ring buffer so the dashboard shows history immediately after restart.
 *   3. Auto-rotation: deletes oldest files when the count exceeds 1000.
 *   4. Debounced writes: at most one write per 5s to avoid IO storms.
 *   5. Graceful handling: corrupted files are skipped (logged, not crashed).
 *
 * Each snapshot file is small (~200 bytes of JSON) so 1000 files = ~200KB.
 *
 * Thread-safety: single-threaded Node.js — all operations are synchronous
 * (readFileSync, writeFileSync, readdirSync, unlinkSync).
 */

import "server-only"
import { readFile, writeFile, readdir, unlink, access, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { cacheGet, cacheSet, cacheInvalidate } from "./redis"
import logger from "./logger"
import type { GeoServiceName } from "./geo-metrics"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a persisted snapshot file. Matches the in-memory history entry. */
export type PersistedSnapshot = {
  timestamp: number
  services: Record<
    GeoServiceName,
    {
      p50: number
      p95: number
      p99: number
      count: number
    }
  >
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Directory where snapshot files are stored. */
const SNAPSHOTS_DIR =
  process.env.GEO_METRICS_SNAPSHOTS_DIR ?? join(process.cwd(), "docs", "benchmarks", "metrics")

/** Max number of snapshot files to keep (auto-rotation). */
const MAX_SNAPSHOTS = 1000

/** Debounce interval: persist at most once per 5 seconds. */
const DEBOUNCE_MS = 5_000

/** Snapshot file name prefix. */
const FILE_PREFIX = "snap-"

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let debounceTimer: ReturnType<typeof setTimeout> | null = null

/** Write counter — only run rotation every ROTATE_EVERY_WRITES calls. */
let writeCount = 0
const ROTATE_EVERY_WRITES = 10
let pendingSnapshot: PersistedSnapshot | null = null

// ── Redis cache configuration ──────────────────────────────────────────
// Cache is stored in Redis (shared across instances, survives restarts)
// instead of module-level variables. The in-memory fallback in redis.ts
// ensures the cache works even when Redis is temporarily unavailable.

/** Cache TTL in ms. After this, the next call re-reads from disk. */
const CACHE_TTL_MS = 10_000

/** Cache TTL in seconds (for Redis SETEX). */
const CACHE_TTL_S = Math.ceil(CACHE_TTL_MS / 1000) // 10s

/** Redis cache key for the full snapshots array. */
const SNAPSHOTS_CACHE_KEY = "geo:metrics:snapshots"

/** Redis cache key for the snapshot count. */
const COUNT_CACHE_KEY = "geo:metrics:count"

// ---------------------------------------------------------------------------
// Directory management
// ---------------------------------------------------------------------------

async function ensureDir(): Promise<void> {
  try {
    await access(SNAPSHOTS_DIR)
  } catch (err) {
    logger.debug({ err }, "geo-metrics-persist: dir access check failed, creating")
    await mkdir(SNAPSHOTS_DIR, { recursive: true })
  }
}

/** Parse a snapshot file name to extract timestamp. */
function parseSnapshotFileName(name: string): number | null {
  if (!name.startsWith(FILE_PREFIX) || !name.endsWith(".json")) return null
  const tsStr = name.slice(FILE_PREFIX.length, -".json".length)
  const ts = Number(tsStr)
  return Number.isFinite(ts) ? ts : null
}

// ---------------------------------------------------------------------------
// Disk operations
// ---------------------------------------------------------------------------

/**
 * Invalidate Redis caches for geo metrics.
 * Clears both snapshots and count cache keys so the next call re-reads from disk.
 * Also resets the in-memory status flags.
 */
async function invalidateSnapshotsCache(): Promise<void> {
  lastSnapshotCacheHit = null
  lastCountCacheHit = null
  // Fire-and-forget — cache invalidation is best-effort
  try {
    await cacheInvalidate(SNAPSHOTS_CACHE_KEY)
    await cacheInvalidate(COUNT_CACHE_KEY)
  } catch (err) {
    // Redis down — in-memory fallback handles it
    logger.debug({ err }, "geo-metrics-persist: cache invalidation failed")
  }
}

async function writeSnapshot(snapshot: PersistedSnapshot): Promise<void> {
  try {
    await ensureDir()
    const filePath = join(SNAPSHOTS_DIR, `${FILE_PREFIX}${snapshot.timestamp}.json`)
    await writeFile(filePath, JSON.stringify(snapshot), "utf-8")
    await invalidateSnapshotsCache()
  } catch (err) {
    logger.error({ err }, "geo-metrics-persist: failed to write snapshot")
  }
}

/**
 * Enforce MAX_SNAPSHOTS limit by deleting the oldest files.
 * Called after each write.
 */
async function rotateOldSnapshots(): Promise<void> {
  writeCount++
  if (writeCount % ROTATE_EVERY_WRITES !== 0) return
  try {
    await ensureDir()
    const entries = await readdir(SNAPSHOTS_DIR, { withFileTypes: true })
    const snapFiles = entries
      .filter((e) => e.isFile() && parseSnapshotFileName(e.name) !== null)
      .map((e) => ({
        name: e.name,
        ts: parseSnapshotFileName(e.name) as number,
      }))
      .sort((a, b) => b.ts - a.ts) // newest first

    if (snapFiles.length <= MAX_SNAPSHOTS) return

    const toDelete = snapFiles.slice(MAX_SNAPSHOTS)
    for (const f of toDelete) {
      try {
        await unlink(join(SNAPSHOTS_DIR, f.name))
      } catch (err) {
        logger.debug({ err }, "geo-metrics-persist: snapshot file unlink failed")
      }
    }

    await invalidateSnapshotsCache()

    logger.info(
      { deleted: toDelete.length, remaining: MAX_SNAPSHOTS },
      "geo-metrics-persist: rotated old snapshots",
    )
  } catch (err) {
    logger.error({ err }, "geo-metrics-persist: failed to rotate snapshots")
  }
}

// ── Cache status tracking (for API debug headers) ────────────────────────
// Set by loadPersistedSnapshots and getSnapshotCount on every call.
// Read by the API route to emit X-Snapshots-Cache: HIT | MISS.

let lastSnapshotCacheHit: boolean | null = null
let lastCountCacheHit: boolean | null = null

/**
 * Reset cache status flags before a fresh request.
 */
export function resetCacheFlags(): void {
  lastSnapshotCacheHit = null
  lastCountCacheHit = null
}

/**
 * Get the cache status for the most recent loadPersistedSnapshots() call.
 * Returns: true = HIT, false = MISS, null = not called yet in this request.
 */
export function wasSnapshotCacheHit(): boolean | null {
  return lastSnapshotCacheHit
}

/**
 * Get the cache status for the most recent getSnapshotCount() call.
 */
export function wasCountCacheHit(): boolean | null {
  return lastCountCacheHit
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Queue a snapshot for persistence. Debounced: writes at most once per 5s.
 * If multiple snapshots are queued within the debounce window, only the
 * latest one is persisted (intermediate values are irrelevant for trends).
 *
 * Called from geo-metrics.ts after a new snapshot is computed.
 */
export function persistSnapshot(snapshot: PersistedSnapshot): void {
  pendingSnapshot = snapshot

  if (debounceTimer) return // already scheduled

  debounceTimer = setTimeout(async () => {
    debounceTimer = null
    if (pendingSnapshot) {
      await writeSnapshot(pendingSnapshot)
      await rotateOldSnapshots()
      pendingSnapshot = null
    }
  }, DEBOUNCE_MS)

  if (typeof debounceTimer?.unref === "function") {
    debounceTimer.unref()
  }
}

/**
 * Load all historical snapshots from disk, sorted chronologically (oldest first).
 * Called on server startup to hydrate the in-memory ring buffer.
 *
 * Results are cached in Redis (shared across instances, survives restarts)
 * for CACHE_TTL_MS to avoid reading + parsing up to 1000 files on every
 * API request. The cache is invalidated whenever a snapshot is written
 * or deleted.
 */
export async function loadPersistedSnapshots(): Promise<PersistedSnapshot[]> {
  // Try Redis cache first (shared across instances, survives restarts)
  try {
    const cached = await cacheGet<PersistedSnapshot[]>(SNAPSHOTS_CACHE_KEY)
    if (cached !== null) {
      lastSnapshotCacheHit = true
      return cached
    }
  } catch (err) {
    // Redis unavailable — fall through to disk
    logger.debug({ err }, "geo-metrics-persist: snapshots cache read failed")
  }

  lastSnapshotCacheHit = false

  try {
    await ensureDir()
    const entries = await readdir(SNAPSHOTS_DIR, { withFileTypes: true })
    const snapFiles = entries
      .filter((e) => e.isFile() && parseSnapshotFileName(e.name) !== null)
      .map((e) => ({
        name: e.name,
        ts: parseSnapshotFileName(e.name) as number,
      }))
      .sort((a, b) => a.ts - b.ts) // oldest first

    const snapshots: PersistedSnapshot[] = []

    for (const f of snapFiles) {
      try {
        const content = await readFile(join(SNAPSHOTS_DIR, f.name), "utf-8")
        const parsed = JSON.parse(content) as PersistedSnapshot

        // Basic validation
        if (
          typeof parsed.timestamp !== "number" ||
          !parsed.services ||
          typeof parsed.services !== "object"
        ) {
          logger.warn({ file: f.name }, "geo-metrics-persist: invalid snapshot — skipping")
          continue
        }

        snapshots.push(parsed)
      } catch (err) {
        logger.warn({ file: f.name, err }, "geo-metrics-persist: corrupt snapshot — skipping")
      }
    }

    logger.info(
      { loaded: snapshots.length, cacheTTL: `${CACHE_TTL_MS}ms` },
      "geo-metrics-persist: loaded historical snapshots",
    )

    // Store in Redis cache (best-effort, 10s TTL)
    try {
      await cacheSet(SNAPSHOTS_CACHE_KEY, snapshots, CACHE_TTL_S)
    } catch (err) {
      // Redis down — in-memory fallback in redis.ts handles it
      logger.debug({ err }, "geo-metrics-persist: Redis cache write failed")
    }

    return snapshots
  } catch (err) {
    logger.warn({ err }, "geo-metrics-persist: failed to load snapshots — starting fresh")
    return []
  }
}

// ── Graceful shutdown: flush pending snapshot on SIGINT/SIGTERM ─────────
// Ensures the most recent metrics are persisted before the process exits.
// Follows the same pattern as geo-query-log.ts.

/**
 * Immediately flush any pending snapshot, skipping the debounce timer.
 * Safe to call multiple times — writes at most once.
 */
let flushing = false
export async function flushGeoMetrics(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (pendingSnapshot) {
      await writeSnapshot(pendingSnapshot)
      await rotateOldSnapshots()
      pendingSnapshot = null
    }
    // Always invalidate cache — even when there's no pending snapshot,
    // external writes (e.g. historical snapshots placed directly on disk)
    // must be visible on the next loadPersistedSnapshots() call.
    await invalidateSnapshotsCache()
  } finally {
    flushing = false
  }
}

function setupShutdownHandlers(): void {
  const handler = async () => {
    await flushGeoMetrics()
  }
  process.on("SIGINT", handler)
  process.on("SIGTERM", handler)
}

setupShutdownHandlers()

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export async function getSnapshotCount(): Promise<number> {
  // Try Redis cache first
  try {
    const cached = await cacheGet<number>(COUNT_CACHE_KEY)
    if (cached !== null) {
      lastCountCacheHit = true
      return cached
    }
  } catch (err) {
    // Redis unavailable — fall through to disk
    logger.debug({ err }, "geo-metrics-persist: count cache read failed")
  }

  lastCountCacheHit = false

  try {
    await ensureDir()
    const entries = await readdir(SNAPSHOTS_DIR, { withFileTypes: true })
    const count = entries.filter((e) => e.isFile() && parseSnapshotFileName(e.name) !== null).length

    // Store in Redis cache (best-effort)
    try {
      await cacheSet(COUNT_CACHE_KEY, count, CACHE_TTL_S)
    } catch (err) {
      logger.debug({ err }, "geo-metrics-persist: count cache write failed")
    }
    return count
  } catch (err) {
    logger.debug({ err }, "geo-metrics-persist: snapshot count query failed")
    return 0
  }
}

export function getSnapshotsDir(): string {
  return SNAPSHOTS_DIR
}
