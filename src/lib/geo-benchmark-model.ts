/**
 * geo-benchmark-model.ts
 *
 * Pure functions for the GiST selectivity vs cost benchmark model.
 * Extracted from GiSTSelectivitySection (admin-geo-metrics-dashboard.tsx)
 * to make the computation logic independently testable.
 *
 * The model: T(N, s) = FIXED_US + PER_ROW_US × N × s
 *   N  = number of providers
 *   s  = selectivity (fraction of providers within the search radius, 0–1)
 *   FIXED_US  = constant PostGIS overhead (TCP + query parse/plan)
 *   PER_ROW_US = per-row ST_Distance / GiST index lookup cost
 *
 * This is consumed by GiSTSelectivitySection in the admin dashboard.
 */

// ---------------------------------------------------------------------------
// Model constants (from geo-benchmark-real.mjs analysis)
// ---------------------------------------------------------------------------

/** Fixed PostGIS overhead (TCP + query parse/plan) in µs. */
export const POSTGIS_FIXED_US = 2000
/** Per-row ST_Distance computation cost in µs. */
export const POSTGIS_PER_ROW_US = 22

/** Provider counts used to model the selectivity curves. */
export const PROVIDER_COUNTS = [100, 500, 1000, 5000, 10000]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SelectivityPoint = Record<string, number | string>

export type CrossoverPoint = {
  /** Number of providers at the crossover. */
  n: number
  /** Selectivity fraction (0–1) where Haversine matches PostGIS filtered cost. */
  selectivity: number
}

export type MeasuredPoint = {
  n: number
  ms: number
}

export type P95Stats = {
  /** Number of valid PostGIS P95 samples. */
  count: number
  /** Arithmetic mean of PostGIS P95 values from history (ms). */
  mean: number
  /** Minimum P95 value (ms). */
  min: number
  /** Maximum P95 value (ms). */
  max: number
  /** Sample standard deviation of P95 values (ms). */
  stdev: number
}

export type HistorySnapshot = {
  timestamp: number
  services: Record<string, { p50: number; p95: number; p99: number; count: number }>
}

// ---------------------------------------------------------------------------
// GiST degradation check
// ---------------------------------------------------------------------------

/**
 * Result of the GiST degradation check.
 */
export type GiSTDegradationResult = {
  /** Whether the real P95 exceeds ALL model curves at this selectivity. */
  gistDegraded: boolean
  /** Highest PostGIS filtered latency among all provider scales. */
  maxModelAtSelectivity: number
  /** How many provider scales have model latency below the real P95. */
  exceedingCount: number
}

/**
 * Check whether the real PostGIS P95 exceeds all theoretical model curves
 * at a given selectivity level, indicating possible GiST index degradation.
 *
 * @param selectivityPoints — The full array of selectivity curve points
 *   (from computeSelectivityPoints).
 * @param selectivityLabel  — The selectivity label to look up (e.g. "15%").
 * @param p95Mean           — Real PostGIS P95 mean from geo-metrics history.
 * @param hasP95Data        — Whether valid P95 data is available.
 * @param providerCounts    — Provider scales to check (default PROVIDER_COUNTS).
 */
export function computeGiSTDegradation(
  selectivityPoints: SelectivityPoint[],
  selectivityLabel: string,
  p95Mean: number,
  hasP95Data: boolean,
  providerCounts: number[] = PROVIDER_COUNTS,
): GiSTDegradationResult {
  const result: GiSTDegradationResult = {
    gistDegraded: false,
    maxModelAtSelectivity: 0,
    exceedingCount: 0,
  }

  if (!hasP95Data || p95Mean <= 0) return result

  const selRow = selectivityPoints.find(
    (r: Record<string, unknown>) => r.selectivity === selectivityLabel,
  )
  if (!selRow) return result

  const pgKeys = providerCounts.map((n) => `pg_${n}`)
  let maxVal = 0
  let exceeding = 0

  for (const k of pgKeys) {
    const v = Number(selRow[k] ?? 0)
    if (v > maxVal) maxVal = v
    if (p95Mean > v) exceeding++
  }

  result.maxModelAtSelectivity = maxVal
  result.exceedingCount = exceeding
  result.gistDegraded = p95Mean > maxVal

  return result
}

// ---------------------------------------------------------------------------
// Selectivity curve
// ---------------------------------------------------------------------------

/**
 * Generate selectivity curve data points (0–100% in 5% increments).
 *
 * For each selectivity level, computes:
 *   - PostGIS filtered latency  = FIXED_US + PER_ROW_US × N × s   (ms)
 *   - Haversine full-scan       = avgHaversinePerProvider × N      (ms)
 *   - PostGIS full-scan (s=1)   = FIXED_US + PER_ROW_US × N       (ms)
 *
 * Real benchmark data points from the benchmark file are also injected
 * at 100% selectivity for comparison.
 */
export function computeSelectivityPoints(
  benchmark: Array<{ scale: number; postgis: { mean: number } }>,
  avgHaversinePerProvider: number,
): SelectivityPoint[] {
  return Array.from({ length: 21 }, (_, i) => {
    const selectivity = i / 20 // 0, 0.05, 0.1, ..., 1.0
    const pct = Math.round(selectivity * 100)

    const row: SelectivityPoint = {
      selectivity: `${pct}%`,
      pct: selectivity,
    }

    for (const n of PROVIDER_COUNTS) {
      // PostGIS filtered (ST_DWithin + ST_Distance on subset)
      const pgFiltered = POSTGIS_FIXED_US + POSTGIS_PER_ROW_US * n * selectivity
      row[`pg_${n}`] = Math.round((pgFiltered / 1000) * 10) / 10 // ms, 1 decimal

      // Haversine full scan
      const haversine = avgHaversinePerProvider * n
      row[`hav_${n}`] = Math.round((haversine / 1000) * 100) / 100 // ms, 2 decimals

      // PostGIS full scan (no filter, s=1.0)
      if (pct === 100) {
        row[`pg_full_${n}`] =
          Math.round(((POSTGIS_FIXED_US + POSTGIS_PER_ROW_US * n) / 1000) * 10) / 10
      }
    }

    // Real benchmark data points for PostGIS full scan
    for (const comp of benchmark) {
      if (pct === 100) {
        const key = `bench_pg_${comp.scale}`
        row[key] = Math.round((comp.postgis.mean / 1000) * 10) / 10
      }
    }

    return row
  })
}

// ---------------------------------------------------------------------------
// Crossover computation
// ---------------------------------------------------------------------------

/**
 * Compute crossover points where Haversine becomes cheaper than PostGIS filtered.
 *
 * Crossover condition:
 *   haversinePerProviderUs × N = FIXED_US + PER_ROW_US × N × s
 *   s = (haversinePerProviderUs × N - FIXED_US) / (PER_ROW_US × N)
 *
 * Crossovers are only valid when 0 < s < 1 (within the chart's domain).
 * When no crossover exists, Haversine is always faster (or PostGIS is
 * always faster) within the modelled range.
 */
export function computeCrossovers(
  haversinePerProviderUs: number,
  providerCounts: number[] = PROVIDER_COUNTS,
): CrossoverPoint[] {
  const crossovers: CrossoverPoint[] = []

  for (const n of providerCounts) {
    const num = haversinePerProviderUs * n - POSTGIS_FIXED_US
    const den = POSTGIS_PER_ROW_US * n
    if (den > 0) {
      const s = num / den
      if (s > 0 && s < 1) {
        crossovers.push({ n, selectivity: s })
      }
    }
  }

  return crossovers
}

// ---------------------------------------------------------------------------
// Measured full-scan latencies
// ---------------------------------------------------------------------------

/**
 * Extract measured full-scan PostGIS latencies from benchmark comparisons,
 * converting from µs to ms.
 */
export function computeMeasuredFull(
  comparisons: Array<{ scale: number; postgis: { mean: number } }>,
): MeasuredPoint[] {
  return comparisons.map((comp) => ({
    n: comp.scale,
    ms: Math.round((comp.postgis.mean / 1000) * 10) / 10,
  }))
}

// ---------------------------------------------------------------------------
// Real P95 statistics from history
// ---------------------------------------------------------------------------

/**
 * Compute PostGIS P95 statistics (mean, min, max, stdev) from the history
 * of geo-metrics snapshots. Returns an empty stats object (count = 0) when
 * history is null, empty, or contains no valid PostGIS P95 values.
 */
export function computeP95Stats(history: HistorySnapshot[] | null | undefined): P95Stats {
  const values: number[] = []

  if (history != null) {
    for (const snap of history) {
      const pg = snap.services["postgis"]
      if (pg != null && pg.p95 > 0) {
        values.push(pg.p95)
      }
    }
  }

  if (values.length === 0) {
    return { count: 0, mean: 0, min: 0, max: 0, stdev: 0 }
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const min = Math.min(...values)
  const max = Math.max(...values)
  const stdev = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length)

  return { count: values.length, mean, min, max, stdev }
}

// ---------------------------------------------------------------------------
// Radius ↔ selectivity conversion
// ---------------------------------------------------------------------------

/**
 * Default reference radius (km) for the selectivity model.
 * Providers within this radius constitute 100% selectivity.
 * Based on typical max search radius for provider discovery.
 */
export const REFERENCE_RADIUS_KM = 50

/**
 * Convert a search radius (km) to selectivity (0–1) assuming uniform
 * provider distribution within the reference radius.
 *
 * selectivity = (r / R)² where R = REFERENCE_RADIUS_KM.
 * Capped at 1.0 when r >= R.
 */
export function radiusToSelectivity(radiusKm: number): number {
  if (radiusKm <= 0) return 0
  if (radiusKm >= REFERENCE_RADIUS_KM) return 1.0
  const ratio = radiusKm / REFERENCE_RADIUS_KM
  return Math.min(ratio * ratio, 1.0)
}

/**
 * Map selectivity (0–1) to an approximate radius label for display.
 * Based on the same inverse square relationship.
 */
export function selectivityToRadiusLabel(s: number): string {
  if (s <= 0) return "< 1 km"
  const radiusKm = Math.sqrt(s) * REFERENCE_RADIUS_KM
  if (radiusKm < 2) return "< 2 km"
  if (radiusKm < 5) return `${Math.round(radiusKm)} km`
  return `${Math.round(radiusKm / 5) * 5} km`
}

// ---------------------------------------------------------------------------
// Cost computation at a given selectivity
// ---------------------------------------------------------------------------

export type CostAtSelectivity = {
  /** Provider count. */
  n: number
  /** PostGIS filtered latency (ms) at this selectivity. */
  postgisMs: number
  /** Haversine full-scan latency (ms) for the same provider count. */
  haversineMs: number
  /** Ratio of PostGIS to Haversine (>1 means Haversine is faster). */
  ratio: number
  /** Which regime is faster at this provider count. */
  faster: "PostGIS" | "Haversine" | "tie"
}

/**
 * Compute estimated latencies for PostGIS filtered vs Haversine at a
 * given selectivity for each provider count in PROVIDER_COUNTS.
 */
export function computeCostAtSelectivity(
  selectivity: number,
  avgHaversinePerProvider: number,
): CostAtSelectivity[] {
  return PROVIDER_COUNTS.map((n) => {
    const pgMs = (POSTGIS_FIXED_US + POSTGIS_PER_ROW_US * n * selectivity) / 1000
    const havMs = (avgHaversinePerProvider * n) / 1000
    const ratio = havMs > 0 ? +(pgMs / havMs).toFixed(1) : 0
    const faster = pgMs < havMs ? "PostGIS" : pgMs > havMs ? "Haversine" : "tie"
    return { n, postgisMs: +pgMs.toFixed(2), haversineMs: +havMs.toFixed(2), ratio, faster }
  })
}

// ---------------------------------------------------------------------------
// Model latency helpers
// ---------------------------------------------------------------------------

/**
 * Compute the theoretical PostGIS full-scan latency for a given provider count.
 * Returns the value in milliseconds.
 */
export function modelPostGISFullMs(n: number): number {
  return +(POSTGIS_FIXED_US + POSTGIS_PER_ROW_US * n) / 1000
}

/**
 * Compute the delta (measured - model) for a full-scan benchmark point.
 * Returns the difference in milliseconds.
 */
export function modelDelta(measuredMs: number, n: number): number {
  return measuredMs - modelPostGISFullMs(n)
}
