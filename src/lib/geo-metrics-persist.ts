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
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from "node:fs"
import { join, basename } from "node:path"
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
let pendingSnapshot: PersistedSnapshot | null = null

// ── Module-level cache for loadPersistedSnapshots ────────────────────────
// Prevents reading + parsing up to 1000 files on every API request.
// Invalidated when a new snapshot is written to disk.

/** Cache TTL in ms. After this, the next call re-reads from disk. */
const CACHE_TTL_MS = 10_000

interface SnapshotCache {
  data: PersistedSnapshot[]
  cachedAt: number
}

let snapshotsCache: SnapshotCache | null = null

// ---------------------------------------------------------------------------
// Directory management
// ---------------------------------------------------------------------------

function ensureDir(): void {
  if (!existsSync(SNAPSHOTS_DIR)) {
    mkdirSync(SNAPSHOTS_DIR, { recursive: true })
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
 * Save a single snapshot to disk.
 * Path: {SNAPSHOTS_DIR}/snap-{timestamp}.json
 */
function invalidateSnapshotsCache(): void {
  snapshotsCache = null
}

function writeSnapshot(snapshot: PersistedSnapshot): void {
  try {
    ensureDir()
    const filePath = join(SNAPSHOTS_DIR, `${FILE_PREFIX}${snapshot.timestamp}.json`)
    writeFileSync(filePath, JSON.stringify(snapshot), "utf-8")
    invalidateSnapshotsCache()
  } catch (err) {
    logger.error({ err }, "geo-metrics-persist: failed to write snapshot")
  }
}

/**
 * Enforce MAX_SNAPSHOTS limit by deleting the oldest files.
 * Called after each write.
 */
function rotateOldSnapshots(): void {
  try {
    ensureDir()
    const entries = readdirSync(SNAPSHOTS_DIR, { withFileTypes: true })
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
        unlinkSync(join(SNAPSHOTS_DIR, f.name))
      } catch {
        // best-effort
      }
    }

    invalidateSnapshotsCache()

    logger.info(
      { deleted: toDelete.length, remaining: MAX_SNAPSHOTS },
      "geo-metrics-persist: rotated old snapshots",
    )
  } catch (err) {
    logger.error({ err }, "geo-metrics-persist: failed to rotate snapshots")
  }
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

  debounceTimer = setTimeout(() => {
    debounceTimer = null
    if (pendingSnapshot) {
      writeSnapshot(pendingSnapshot)
      rotateOldSnapshots()
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
 * Results are cached at the module level for CACHE_TTL_MS to avoid
 * reading + parsing up to 1000 files on every API request. The cache is
 * invalidated whenever a snapshot is written or deleted.
 */
export function loadPersistedSnapshots(): PersistedSnapshot[] {
  // Return cached data if still fresh
  if (snapshotsCache && Date.now() - snapshotsCache.cachedAt < CACHE_TTL_MS) {
    return snapshotsCache.data
  }

  try {
    ensureDir()
    const entries = readdirSync(SNAPSHOTS_DIR, { withFileTypes: true })
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
        const content = readFileSync(join(SNAPSHOTS_DIR, f.name), "utf-8")
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

    // Store in cache
    snapshotsCache = { data: snapshots, cachedAt: Date.now() }

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
export function flushGeoMetrics(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (pendingSnapshot) {
    writeSnapshot(pendingSnapshot)
    rotateOldSnapshots()
    pendingSnapshot = null
  }
  // Always invalidate cache — even when there's no pending snapshot,
  // external writes (e.g. historical snapshots placed directly on disk)
  // must be visible on the next loadPersistedSnapshots() call.
  invalidateSnapshotsCache()
}

function setupShutdownHandlers(): void {
  const handler = () => {
    flushGeoMetrics()
  }
  process.on("SIGINT", handler)
  process.on("SIGTERM", handler)
}

setupShutdownHandlers()

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export function getSnapshotCount(): number {
  try {
    ensureDir()
    const entries = readdirSync(SNAPSHOTS_DIR, { withFileTypes: true })
    return entries.filter((e) => e.isFile() && parseSnapshotFileName(e.name) !== null).length
  } catch {
    return 0
  }
}

export function getSnapshotsDir(): string {
  return SNAPSHOTS_DIR
}
