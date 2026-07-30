/**
 * geo-auto-baseline.ts
 *
 * Adaptive auto-baseline for geo service performance thresholds.
 *
 * Instead of relying on a static benchmark file (which only contains
 * PostGIS model data), this module derives P95 baselines from the
 * actual historical snapshots persisted by geo-metrics-persist.ts.
 *
 * How it works:
 *   1. Loads the last N hours of persisted snapshots (default: 24h).
 *   2. Computes the mean P95 across all snapshots for each service.
 *   3. The baseline adapts to real operating conditions — times of day,
 *      network variability, API changes — without manual recalibration.
 *   4. Returns a baseline for all three services: Nominatim, ViaCEP, PostGIS.
 *   5. Falls back to sensible defaults when no history is available
 *      (e.g., first deploy or no snapshots yet).
 *
 * The baseline is consumed by geo-performance-alert.ts for the
 * checkGeoPerformance() threshold check.
 */

import "server-only"
import { loadPersistedSnapshots } from "./geo-metrics-persist"
import type { GeoServiceName } from "./geo-metrics"
import logger from "./logger"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Lookback window: how far back to consider for baseline computation. */
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000 // 24 hours

/** Minimum number of snapshots required for a reliable baseline. */
const MIN_SNAPSHOTS_FOR_BASELINE = 5

/**
 * Fallback P95 baselines (ms) for when no historical data is available.
 * These are conservative estimates for a fresh deployment.
 * - Nominatim: external API, typically 200-600ms
 * - ViaCEP: external API, typically 100-400ms
 * - PostGIS: DB query, typically 10-50ms
 */
const FALLBACK_BASELINES: Record<GeoServiceName, number> = {
  nominatim: 400,
  viacep: 250,
  postgis: 30,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ServiceBaseline = {
  /** Service name. */
  service: GeoServiceName
  /** Derived P95 baseline in ms. */
  p95Baseline: number
  /** Number of snapshots used to compute this baseline. */
  sampleCount: number
  /** Whether the baseline was computed from history or is a fallback. */
  source: "historical" | "fallback"
  /** The effective 2× threshold derived from the baseline. */
  threshold: number
}

/**
 * Compute the adaptive P95 baseline for all geo services.
 *
 * @param lookbackMs — Optional lookback window in ms (default: 24h).
 * @returns Array of per-service baselines with metadata.
 */
export async function computeGeoBaselines(
  lookbackMs: number = DEFAULT_LOOKBACK_MS,
): Promise<ServiceBaseline[]> {
  const now = Date.now()
  const cutoff = now - lookbackMs

  // 1. Load persisted snapshots from disk (Redis cache or disk)
  const allSnapshots = await loadPersistedSnapshots()

  // 2. Filter to the lookback window
  const recent = allSnapshots.filter((s) => s.timestamp >= cutoff)

  // 3. Compute per-service P95 mean
  const serviceKeys: GeoServiceName[] = ["nominatim", "viacep", "postgis"]

  const baselines: ServiceBaseline[] = []

  for (const svc of serviceKeys) {
    const p95Values = recent
      .map((s) => s.services[svc]?.p95)
      .filter((v): v is number => v != null && v > 0)

    const sampleCount = p95Values.length

    if (sampleCount >= MIN_SNAPSHOTS_FOR_BASELINE) {
      // Compute mean of historical P95 values
      const sum = p95Values.reduce((a, b) => a + b, 0)
      const mean = +(sum / sampleCount).toFixed(1)

      baselines.push({
        service: svc,
        p95Baseline: mean,
        sampleCount,
        source: "historical",
        threshold: Math.round(mean * 2),
      })
    } else {
      // Not enough data — use fallback
      const fallback = FALLBACK_BASELINES[svc]
      baselines.push({
        service: svc,
        p95Baseline: fallback,
        sampleCount,
        source: "fallback",
        threshold: Math.round(fallback * 2),
      })
    }
  }

  if (recent.length > 0) {
    logger.info(
      {
        snapshotsUsed: recent.length,
        baselines: baselines.map((b) => ({
          service: b.service,
          baseline: b.p95Baseline,
          source: b.source,
          samples: b.sampleCount,
        })),
      },
      "geo-auto-baseline: computed",
    )
  }

  return baselines
}

/**
 * Get the adaptive baseline for a single service.
 * Convenience wrapper around computeGeoBaselines().
 */
export async function getServiceBaseline(
  service: GeoServiceName,
  lookbackMs?: number,
): Promise<ServiceBaseline> {
  const all = await computeGeoBaselines(lookbackMs)
  return (
    all.find((b) => b.service === service) ?? {
      service,
      p95Baseline: FALLBACK_BASELINES[service],
      sampleCount: 0,
      source: "fallback",
      threshold: Math.round(FALLBACK_BASELINES[service] * 2),
    }
  )
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export async function getBaselineDiagnostics(): Promise<{
  lookbackHours: number
  fallbackBaselines: Record<GeoServiceName, number>
  currentBaselines: ServiceBaseline[]
}> {
  return {
    lookbackHours: DEFAULT_LOOKBACK_MS / 3_600_000,
    fallbackBaselines: { ...FALLBACK_BASELINES },
    currentBaselines: await computeGeoBaselines(),
  }
}
