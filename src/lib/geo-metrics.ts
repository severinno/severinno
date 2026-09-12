import "server-only"
import { persistSnapshot, loadPersistedSnapshots } from "./geo-metrics-persist"
import logger from "./logger"

/**
 * Geo Performance Metrics — in-memory sliding window for geo service latencies.
 *
 * Tracks P50 / P95 / P99 response times for Nominatim, ViaCEP, and PostGIS
 * calls. Exposes a thread-safe (single-process) API that the admin dashboard
 * queries via GET /api/admin/geo-metrics.
 *
 * Data model:
 *   ┌──────────────────┐
 *   │  sliding window   │  ← time-based (last 15 min), capped at MAX_SAMPLES
 *   │  per service      │
 *   ├──────────────────┤
 *   │  latency + error  │  ← each sample is { ms: number, error: boolean }
 *   └──────────────────┘
 *
 * Historical snapshots are persisted to disk (docs/benchmarks/metrics/)
 * via geo-metrics-persist.ts — they survive server restarts with auto-
 * rotation at 1000 files.
 */

export type GeoServiceName = "nominatim" | "viacep" | "postgis"

type Sample = {
  ms: number
  error: boolean
  timestamp: number
}

// ── Config ────────────────────────────────────────────────────────────────

/** Window duration in milliseconds (default: 15 minutes). */
const WINDOW_MS = 15 * 60 * 1000

/** Hard cap on samples kept per service (prevents unbounded memory growth). */
const MAX_SAMPLES = 5000

/** Labels for display. */
export const SERVICE_LABELS: Record<GeoServiceName, string> = {
  nominatim: "Nominatim (OSM)",
  viacep: "ViaCEP",
  postgis: "PostGIS",
}

// ── In-memory store ──────────────────────────────────────────────────────

const store: Record<GeoServiceName, Sample[]> = {
  nominatim: [],
  viacep: [],
  postgis: [],
}

// ── Internal helpers ─────────────────────────────────────────────────────

/** Prune samples older than WINDOW_MS and enforce MAX_SAMPLES cap.
 *  Uses binary search (O(log n)) since timestamps are monotonically increasing. */
function prune(service: GeoServiceName): void {
  const now = Date.now()
  const cutoff = now - WINDOW_MS
  let arr = store[service]

  // Binary search: find first index where timestamp >= cutoff
  if (arr.length > 0 && arr[0]!.timestamp < cutoff) {
    let lo = 0
    let hi = arr.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (arr[mid]!.timestamp < cutoff) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) arr = arr.slice(lo)
  }

  // Cap size
  if (arr.length > MAX_SAMPLES) {
    arr = arr.slice(arr.length - MAX_SAMPLES)
  }
  store[service] = arr
}

/** Compute the Nth percentile from a sorted array of numbers. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]!
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Record a latency sample for a geo service.
 *
 * @param service  - The geo service that was called.
 * @param ms       - Total elapsed time in milliseconds.
 * @param error    - Whether the call resulted in an error.
 */
export function recordGeoLatency(service: GeoServiceName, ms: number, error = false): void {
  if (!store[service]) return
  store[service].push({ ms, error, timestamp: Date.now() })
}

/**
 * Convenience wrapper: measure an async function's duration and record it.
 *
 * Usage:
 *   const result = await trackGeoLatency("nominatim", () => geocodeSearch(...))
 *
 * On success → recordGeoLatency(service, ms, false)
 * On throw   → recordGeoLatency(service, ms, true) then re-throw
 */
export async function trackGeoLatency<T>(
  service: GeoServiceName,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now()
  try {
    const result = await fn()
    const elapsed = performance.now() - start
    recordGeoLatency(service, elapsed, false)
    return result
  } catch (e) {
    const elapsed = performance.now() - start
    recordGeoLatency(service, elapsed, true)
    throw e
  }
}

// ── Metrics computation ──────────────────────────────────────────────────

export type GeoServiceMetrics = {
  /** P50 latency in ms. */
  p50: number
  /** P95 latency in ms. */
  p95: number
  /** P99 latency in ms. */
  p99: number
  /** Number of samples in the current window. */
  count: number
  /** Error rate (0–1). */
  errorRate: number
  /** Timestamp of the last recorded sample. */
  lastSampleAt: number | null
  /** Total error count in the current window. */
  errorCount: number
}

export type GeoMetricsSnapshot = {
  services: Record<GeoServiceName, GeoServiceMetrics>
  /** Unix ms timestamp when this snapshot was computed. */
  timestamp: number
  /** Sliding window size in seconds. */
  windowSeconds: number
}

// ── Historical snapshot buffer ──────────────────────────────────────────

/** Max number of historical snapshots kept in memory. */
const MAX_HISTORY = 1000

/**
 * In-memory ring buffer of historical snapshots.
 * Hydrated from disk on module init and kept updated in memory.
 * Also persisted to disk via geo-metrics-persist.ts.
 */
const snapshotHistory: Array<{
  timestamp: number
  services: Record<GeoServiceName, { p50: number; p95: number; p99: number; count: number }>
}> = new Array(MAX_HISTORY)
let historyIndex = 0
let historyCount = 0

/** Get the current historical snapshot buffer (in-memory). */
export function getGeoMetricsHistory(): Array<{
  timestamp: number
  services: Record<GeoServiceName, { p50: number; p95: number; p99: number; count: number }>
}> {
  if (historyCount < MAX_HISTORY) {
    return snapshotHistory.slice(0, historyCount)
  }
  // Ring buffer: oldest entry is at historyIndex % MAX_HISTORY
  return [
    ...snapshotHistory.slice(historyIndex % MAX_HISTORY),
    ...snapshotHistory.slice(0, historyIndex % MAX_HISTORY),
  ]
}

// ── Module init: hydrate from disk ────────────────────────────────────────
// Load persisted snapshots from the previous server session so the
// historical timeline doesn't start empty after a restart.
// Uses async IIFE because loadPersistedSnapshots is async (Redis-backed).

;(async () => {
  try {
    const persisted = await loadPersistedSnapshots()
    for (const snap of persisted) {
      snapshotHistory[historyIndex % MAX_HISTORY] = snap
      historyIndex++
      if (historyCount < MAX_HISTORY) historyCount++
    }
    if (persisted.length > 0) {
      logger.info(
        { loaded: persisted.length, capped: historyCount },
        "geo-metrics: hydrated historical snapshots from disk",
      )
    }
  } catch (err) {
    logger.warn({ err }, "geo-metrics: failed to hydrate snapshots from disk")
  }
})()

/**
 * Compute the current metrics snapshot for all geo services.
 * Prunes expired samples before computing.
 */
export function getGeoMetrics(): GeoMetricsSnapshot {
  const services = {} as Record<GeoServiceName, GeoServiceMetrics>

  for (const svc of Object.keys(store) as GeoServiceName[]) {
    prune(svc)
    const samples = store[svc]

    // Single pass: collect latencies and count errors
    const sorted: number[] = []
    let errorCount = 0
    for (const s of samples) {
      if (s.error) errorCount++
      else sorted.push(s.ms)
    }
    sorted.sort((a, b) => a - b)

    services[svc] = {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      count: samples.length,
      errorRate: samples.length > 0 ? errorCount / samples.length : 0,
      lastSampleAt: samples.length > 0 ? samples[samples.length - 1]!.timestamp : null,
      errorCount,
    }
  }

  const snapshot = {
    services,
    timestamp: Date.now(),
    windowSeconds: WINDOW_MS / 1000,
  }

  // Auto-save to history ring buffer (O(1) instead of O(n) shift)
  const historyEntry = {
    timestamp: snapshot.timestamp,
    services: Object.fromEntries(
      Object.entries(services).map(([key, val]) => [
        key,
        { p50: val.p50, p95: val.p95, p99: val.p99, count: val.count },
      ]),
    ) as Record<GeoServiceName, { p50: number; p95: number; p99: number; count: number }>,
  }
  snapshotHistory[historyIndex % MAX_HISTORY] = historyEntry
  historyIndex++
  if (historyCount < MAX_HISTORY) historyCount++

  // Persist to disk (debounced, survives restarts)
  persistSnapshot(historyEntry)

  return snapshot
}

/**
 * Reset all metrics (useful for tests or manual admin action).
 */
export function resetGeoMetrics(): void {
  for (const svc of Object.keys(store) as GeoServiceName[]) {
    store[svc] = []
  }
}
