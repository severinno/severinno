/**
 * benchmark-data.ts
 *
 * Pure data transformation functions for the Benchmark comparison charts
 * (BenchmarkSection in admin-geo-metrics-dashboard.tsx).
 *
 * Extracted from the BenchmarkSection component to make the data pipeline
 * independently testable, following the same pattern as geo-benchmark-model.ts.
 *
 * Covers:
 *   - buildBenchmarkBarData  → transforms benchmark comparisons into chart data
 *   - getMaxPostgisLatency   → computes the max PostGIS latency for axis scaling
 *   - ratioColor             → maps PostGIS/Haversine ratio to a color threshold
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkComparison {
  label: string
  scale: number
  haversine: { mean: number; opsPerSec: number }
  postgis: { mean: number; opsPerSec: number }
  ratio: number
}

export interface BenchmarkBarItem {
  label: string
  scale: number
  haversine: number
  postgis: number
  haversine_ops: number
  postgis_ops: number
  ratio: number
}

export interface BenchmarkMeta {
  platform: string
  nodeVersion: string
  centerLabel: string
  timestamp: string
}

export interface BenchmarkAnalysis {
  note: string
  avgHaversinePerProvider: number
}

export interface BenchmarkData {
  comparisons: BenchmarkComparison[]
  analysis: BenchmarkAnalysis
  meta: BenchmarkMeta
}

// ---------------------------------------------------------------------------
// Color palette constants (mirrors the component's COLOR_P50/P95/P99)
// ---------------------------------------------------------------------------

export const RATIO_COLOR_FAST = "hsl(160, 84%, 39%)" // PostGIS is ~same speed
export const RATIO_COLOR_WARN = "hsl(38, 92%, 50%)" // ratio between 10–50×
export const RATIO_COLOR_SLOW = "hsl(0, 72%, 51%)" // ratio > 50× (PostGIS much slower)

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Transform raw benchmark comparisons into chart-ready bar data.
 *
 * Each comparison becomes a BenchmarkBarItem with:
 *   - haversine / postgis: mean latency in µs
 *   - haversine_ops / postgis_ops: throughput in ops/sec
 *   - ratio: PostGIS mean ÷ Haversine mean
 */
export function buildBenchmarkBarData(benchmark: BenchmarkData): BenchmarkBarItem[] {
  return benchmark.comparisons.map((c) => ({
    label: c.label,
    scale: c.scale,
    haversine: c.haversine.mean,
    postgis: c.postgis.mean,
    haversine_ops: c.haversine.opsPerSec,
    postgis_ops: c.postgis.opsPerSec,
    ratio: c.ratio,
  }))
}

/**
 * Compute the maximum PostGIS mean latency across all comparisons.
 * Used to set the X-axis domain for the latency chart.
 * Returns 0 when data is empty.
 */
export function getMaxPostgisLatency(barData: BenchmarkBarItem[]): number {
  if (barData.length === 0) return 0
  return Math.max(...barData.map((d) => d.postgis))
}

/**
 * Map the PostGIS/Haversine ratio to a color for the ratio bar chart cells.
 *
 * Thresholds:
 *   - ≤ 10×   → green  (PostGIS competitive)
 *   - 10–50×  → amber (PostGIS noticeably slower)
 *   - > 50×   → red    (PostGIS dramatically slower — full-scan regime)
 */
export function ratioColor(ratio: number): string {
  if (ratio > 50) return RATIO_COLOR_SLOW
  if (ratio > 10) return RATIO_COLOR_WARN
  return RATIO_COLOR_FAST
}
