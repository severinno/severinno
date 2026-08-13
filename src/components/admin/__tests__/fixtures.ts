/**
 * fixtures.ts
 *
 * Shared fixture data for admin component tests.
 *
 * These fixtures are used across multiple test files to avoid duplicating
 * the same data objects.  Each fixture is a plain JS object (or factory
 * function) that can be imported and spread/overridden per-test.
 *
 * Usage:
 *
 *   import { FIXTURE_BENCHMARK, FIXTURE_NORMAL_HISTORY } from "./fixtures"
 *   render(<BenchmarkSection benchmark={FIXTURE_BENCHMARK} />)
 */

import type { BenchmarkData } from "@/lib/benchmark-data"

// ===========================================================================
// Benchmark data (BenchmarkSection, GiSTSelectivitySection)
// ===========================================================================

/**
 * Canonical benchmark fixture — Haversine JS vs PostGIS latency comparison
 * across 3 provider scales (100, 1k, 10k).
 *
 * Used by:
 *   - benchmark-section-snapshot.test.tsx  → <BenchmarkSection benchmark={} />
 *   - gist-selectivity-section.test.tsx    → <GiSTSelectivitySection benchmark={} />
 */
export const FIXTURE_BENCHMARK: BenchmarkData = {
  meta: {
    timestamp: "2026-04-13T00:00:00.000Z",
    platform: "win32",
    nodeVersion: "v22.14.0",
    centerLabel: "-23.5505, -46.6333",
  },
  comparisons: [
    {
      label: "100 providers",
      scale: 100,
      haversine: { mean: 49.78, opsPerSec: 20088 },
      postgis: { mean: 4200, opsPerSec: 238 },
      ratio: 84.4,
    },
    {
      label: "1 000 providers",
      scale: 1000,
      haversine: { mean: 497.8, opsPerSec: 2009 },
      postgis: { mean: 24000, opsPerSec: 42 },
      ratio: 48.2,
    },
    {
      label: "10 000 providers",
      scale: 10000,
      haversine: { mean: 4978, opsPerSec: 201 },
      postgis: { mean: 222000, opsPerSec: 4.5 },
      ratio: 44.6,
    },
  ],
  analysis: {
    note: "Haversine JS é significativamente mais rápido que PostGIS para buscas de providers em São Paulo.",
    avgHaversinePerProvider: 0.4978,
  },
}

// ===========================================================================
// Bar chart data (BenchmarkSection)
// ===========================================================================

import type { BenchmarkBarItem } from "@/lib/benchmark-data"

/**
 * Canonical bar data fixture — 3 bars for Haversine vs PostGIS latency.
 *
 * Used by:
 *   - benchmark-section-snapshot.test.tsx  → mock for buildBenchmarkBarData()
 */
export const FIXTURE_BAR_DATA: BenchmarkBarItem[] = [
  {
    label: "100 providers",
    scale: 100,
    haversine: 49.78,
    postgis: 4200,
    haversine_ops: 20088,
    postgis_ops: 238,
    ratio: 84.4,
  },
  {
    label: "1 000 providers",
    scale: 1000,
    haversine: 497.8,
    postgis: 24000,
    haversine_ops: 2009,
    postgis_ops: 42,
    ratio: 48.2,
  },
  {
    label: "10 000 providers",
    scale: 10000,
    haversine: 4978,
    postgis: 222000,
    haversine_ops: 201,
    postgis_ops: 4.5,
    ratio: 44.6,
  },
]

// ===========================================================================
// Geo history data (GiSTSelectivitySection)
// ===========================================================================

/**
 * History with P95 values BELOW all model curves (normal operation).
 *
 * 5 entries, P95 ranges from 11ms to 15ms — well under the GiST degradation
 * threshold.  Used as the default/degraded=false scenario.
 *
 * Used by:
 *   - gist-selectivity-section.test.tsx  → <GiSTSelectivitySection history={} />
 */
export const FIXTURE_NORMAL_HISTORY: Array<{
  timestamp: number
  services: Record<string, { p50: number; p95: number; p99: number; count: number }>
}> = (() => {
  const now = Date.now()
  return [
    { timestamp: now - 5000, services: { postgis: { p50: 8, p95: 12, p99: 30, count: 200 } } },
    { timestamp: now - 4000, services: { postgis: { p50: 9, p95: 15, p99: 35, count: 180 } } },
    { timestamp: now - 3000, services: { postgis: { p50: 7, p95: 11, p99: 28, count: 220 } } },
    { timestamp: now - 2000, services: { postgis: { p50: 10, p95: 14, p99: 32, count: 190 } } },
    { timestamp: now - 1000, services: { postgis: { p50: 8, p95: 13, p99: 29, count: 210 } } },
  ]
})()

/**
 * History with P95 values that EXCEED all model curves (degraded GiST).
 *
 * All 5 entries have P95=250ms, producing a deterministic mean of 250.0.
 * When passed to GiSTSelectivitySection with 5 consecutive renders, this
 * fills the degradation buffer (size=5) and triggers the alert.
 *
 * Used by:
 *   - gist-selectivity-section.test.tsx  → degradation alert tests
 */
export const FIXTURE_DEGRADED_HISTORY: Array<{
  timestamp: number
  services: Record<string, { p50: number; p95: number; p99: number; count: number }>
}> = (() => {
  const now = Date.now()
  return [
    { timestamp: now - 5000, services: { postgis: { p50: 80, p95: 250, p99: 500, count: 200 } } },
    { timestamp: now - 4000, services: { postgis: { p50: 80, p95: 250, p99: 500, count: 200 } } },
    { timestamp: now - 3000, services: { postgis: { p50: 80, p95: 250, p99: 500, count: 200 } } },
    { timestamp: now - 2000, services: { postgis: { p50: 80, p95: 250, p99: 500, count: 200 } } },
    { timestamp: now - 1000, services: { postgis: { p50: 80, p95: 250, p99: 500, count: 200 } } },
  ]
})()

// ===========================================================================
// Baseline values (GiSTSelectivitySection)
// ===========================================================================

/**
 * Default baseline P95 values for geo services (ms).
 *
 * Used by:
 *   - gist-selectivity-section.test.tsx  → <GiSTSelectivitySection baselines={} />
 */
export const FIXTURE_BASELINES: Record<string, number> = {
  nominatim: 400,
  viacep: 250,
  postgis: 30,
}

// ===========================================================================
// RadiusDensitySelector default props
// ===========================================================================

import { vi } from "vitest"

/**
 * Default props for rendering RadiusDensitySelector in tests.
 *
 * Uses realistic defaults (radius=15km, density=10/km², ~7k providers, 15%
 * selectivity).  Individual tests override specific fields via spread:
 *
 *   render(<RadiusDensitySelector {...FIXTURE_RADIUS_DENSITY_PROPS} density={2} />)
 *
 * Used by:
 *   - radius-density-selector.test.tsx  → default render setup
 */
export const FIXTURE_RADIUS_DENSITY_PROPS = {
  radiusKm: 15,
  onRadiusKmChange: vi.fn(),
  density: 10,
  onDensityChange: vi.fn(),
  estimatedProviders: 7068,
  densityLabel: "São Paulo (~10/km²)",
  currentSelectivity: 0.15,
  selPct: 15,
}
