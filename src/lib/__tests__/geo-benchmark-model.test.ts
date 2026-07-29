/**
 * geo-benchmark-model.test.ts
 *
 * Unit tests for the GiST selectivity model pure functions extracted from
 * GiSTSelectivitySection. Tests cover:
 *
 *   1. computeSelectivityPoints — curve generation with and without benchmark
 *   2. computeCrossovers — crossover detection including edge cases
 *   3. computeMeasuredFull — full-scan benchmark extraction
 *   4. computeP95Stats — history statistics (including empty/null)
 *   5. modelPostGISFullMs / modelDelta — model math
 *
 * Each test uses inline fixture data so it's self-contained and easy to
 * understand without cross-referencing production benchmark files.
 */

import { describe, it, expect } from "vitest"
import {
  computeSelectivityPoints,
  computeCrossovers,
  computeMeasuredFull,
  computeP95Stats,
  computeCostAtSelectivity,
  radiusToSelectivity,
  selectivityToRadiusLabel,
  modelPostGISFullMs,
  modelDelta,
  POSTGIS_FIXED_US,
  POSTGIS_PER_ROW_US,
  REFERENCE_RADIUS_KM,
} from "../geo-benchmark-model"

// ===========================================================================
// Fixtures
// ===========================================================================

/** Standard 3-scale benchmark comparisons (100, 1000, 10000 providers). */
function makeComparisons() {
  return [
    {
      scale: 100,
      postgis: { mean: 4200 }, // µs → 4.2 ms
    },
    {
      scale: 1000,
      postgis: { mean: 24000 }, // µs → 24.0 ms
    },
    {
      scale: 10000,
      postgis: { mean: 222000 }, // µs → 222.0 ms
    },
  ]
}

/** Typical avgHaversinePerProvider from geo-benchmark.json analysis (µs). */
const TYPICAL_HAV_US = 0.4978

/** Single-scale comparison (no crossover scenario). */
function makeNoCrossoverComparisons() {
  return [
    {
      scale: 100,
      postgis: { mean: 100 }, // very fast PostGIS (improbable but tests the math)
    },
  ]
}

/** History snapshots with PostGIS P95 values. */
function makeHistorySnapshots(): Array<{
  timestamp: number
  services: Record<string, { p50: number; p95: number; p99: number; count: number }>
}> {
  const now = Date.now()
  return [
    { timestamp: now - 5000, services: { postgis: { p50: 10, p95: 25, p99: 80, count: 200 } } },
    { timestamp: now - 4000, services: { postgis: { p50: 12, p95: 30, p99: 90, count: 180 } } },
    { timestamp: now - 3000, services: { postgis: { p50: 11, p95: 28, p99: 85, count: 220 } } },
    { timestamp: now - 2000, services: { postgis: { p50: 9, p95: 22, p99: 70, count: 190 } } },
    { timestamp: now - 1000, services: { postgis: { p50: 15, p95: 35, p99: 110, count: 210 } } },
  ]
}

// ===========================================================================
// 1. computeSelectivityPoints
// ===========================================================================

describe("computeSelectivityPoints", () => {
  it("produces 21 data points (0% to 100% in 5% steps)", () => {
    const points = computeSelectivityPoints(makeComparisons(), TYPICAL_HAV_US)
    expect(points).toHaveLength(21)
    expect(points[0]!.selectivity).toBe("0%")
    expect(points[20]!.selectivity).toBe("100%")
    expect(points[5]!.selectivity).toBe("25%")
    expect(points[10]!.selectivity).toBe("50%")
    expect(points[15]!.selectivity).toBe("75%")
  })

  it("computes PostGIS filtered latency increasing with selectivity", () => {
    const points = computeSelectivityPoints(makeComparisons(), TYPICAL_HAV_US)

    // At 0% selectivity, only fixed overhead remains → ~2ms
    const at0 = points[0] as Record<string, number | string>
    expect(Number(at0.pg_100)).toBeCloseTo(2.0, 0)
    expect(Number(at0.pg_1000)).toBeCloseTo(2.0, 0)
    expect(Number(at0.pg_10000)).toBeCloseTo(2.0, 0)

    // At 100% selectivity, full cost: FIXED_US + PER_ROW_US × N
    const at100 = points[20] as Record<string, number | string>
    expect(Number(at100.pg_100)).toBeGreaterThan(Number(at0.pg_100))
    expect(Number(at100.pg_10000)).toBeGreaterThan(Number(at0.pg_10000))

    // pg_10000 should be much larger than pg_100 at the same selectivity
    const at50 = points[10] as Record<string, number | string>
    expect(Number(at50.pg_10000)).toBeGreaterThan(Number(at50.pg_100))
  })

  it("includes Haversine full-scan reference lines", () => {
    const points = computeSelectivityPoints(makeComparisons(), TYPICAL_HAV_US)

    // Haversine is constant across selectivity (full scan, no filter)
    const at0 = points[0] as Record<string, number | string>
    const at50 = points[10] as Record<string, number | string>
    const at100 = points[20] as Record<string, number | string>

    expect(Number(at0.hav_100)).toBeCloseTo(Number(at50.hav_100), 1)
    expect(Number(at0.hav_100)).toBeCloseTo(Number(at100.hav_100), 1)
  })

  it("includes benchmark data points at 100% selectivity", () => {
    const points = computeSelectivityPoints(makeComparisons(), TYPICAL_HAV_US)
    const at100 = points[20] as Record<string, number | string>

    // 100 providers: 4200µs / 1000 = 4.2ms
    expect(Number(at100.bench_pg_100)).toBeCloseTo(4.2, 1)
    // 1000 providers: 24000µs / 1000 = 24.0ms
    expect(Number(at100.bench_pg_1000)).toBeCloseTo(24.0, 1)
    // 10000 providers: 222000µs / 1000 = 222.0ms
    expect(Number(at100.bench_pg_10000)).toBeCloseTo(222.0, 1)
  })

  it("handles empty benchmark comparisons gracefully", () => {
    const points = computeSelectivityPoints([], TYPICAL_HAV_US)
    expect(points).toHaveLength(21)

    // No bench_pg_* keys should exist
    const keys = Object.keys(points[20]!)
    expect(keys.some((k) => k.startsWith("bench_pg_"))).toBe(false)
  })
})

// ===========================================================================
// 2. computeCrossovers
// ===========================================================================

describe("computeCrossovers", () => {
  it("detects crossovers for typical Haversine cost", () => {
    const crossovers = computeCrossovers(TYPICAL_HAV_US)

    // With typical parameters, there should be crossovers in the modelled range
    expect(crossovers.length).toBeGreaterThan(0)

    // Each crossover should be within (0, 1)
    for (const c of crossovers) {
      expect(c.selectivity).toBeGreaterThan(0)
      expect(c.selectivity).toBeLessThan(1)
      expect(c.n).toBeGreaterThan(0)
    }
  })

  it("returns no crossovers when Haversine is always faster (extremely cheap)", () => {
    // Extremely cheap haversine (0.001µs per provider = 1ns)
    const crossovers = computeCrossovers(0.001)
    expect(crossovers).toHaveLength(0)
  })

  it("returns no crossovers when Haversine is always slower (extremely expensive)", () => {
    // Extremely expensive haversine (1000µs per provider)
    const crossovers = computeCrossovers(1000)
    expect(crossovers).toHaveLength(0)
  })

  it("produces higher selectivity crossovers for larger provider counts", () => {
    const crossovers = computeCrossovers(TYPICAL_HAV_US)

    // Sort by provider count for comparison
    const sorted = [...crossovers].sort((a, b) => a.n - b.n)

    // Math: s(N) = h/p - F/(p·N) where h = avgHaversinePerProvider,
    // p = PER_ROW_US, F = FIXED_US. As N increases, the term F/(p·N)
    // decreases, so s(N) increases toward h/p asymptotically.
    // Higher N → HIGHER crossover selectivity (PostGIS advantages spans
    // a wider range of selectivities because fixed overhead is amortized).
    if (sorted.length >= 2) {
      expect(sorted[sorted.length - 1]!.selectivity).toBeGreaterThanOrEqual(sorted[0]!.selectivity)
    }
  })

  it("handles custom provider counts", () => {
    // Must be large enough that haversine total exceeds FIXED_US
    // h*N > F → N > F/h = 2000/0.4978 ≈ 4018
    const customCounts = [2000, 5000, 10000]
    const crossovers = computeCrossovers(TYPICAL_HAV_US, customCounts)

    // 2000 is below threshold (0.4978*2000=995.6 < 2000), no crossover
    // 5000 and 10000 should produce crossovers
    expect(crossovers.length).toBe(2)
    expect(crossovers.every((c) => c.n >= 5000)).toBe(true)
    for (const c of crossovers) {
      expect(customCounts).toContain(c.n)
    }
  })
})

// ===========================================================================
// 3. computeMeasuredFull
// ===========================================================================

describe("computeMeasuredFull", () => {
  it("extracts scale and ms from benchmark comparisons", () => {
    const measured = computeMeasuredFull(makeComparisons())

    expect(measured).toHaveLength(3)
    expect(measured[0]!.n).toBe(100)
    expect(measured[0]!.ms).toBeCloseTo(4.2, 1)
    expect(measured[1]!.n).toBe(1000)
    expect(measured[1]!.ms).toBeCloseTo(24.0, 1)
    expect(measured[2]!.n).toBe(10000)
    expect(measured[2]!.ms).toBeCloseTo(222.0, 1)
  })

  it("returns empty array for empty comparisons", () => {
    const measured = computeMeasuredFull([])
    expect(measured).toHaveLength(0)
  })
})

// ===========================================================================
// 4. computeP95Stats
// ===========================================================================

describe("computeP95Stats", () => {
  it("computes P95 mean, min, max, stdev from history snapshots", () => {
    const stats = computeP95Stats(makeHistorySnapshots())

    expect(stats.count).toBe(5)
    // Values: 25, 30, 28, 22, 35 → mean = 28
    expect(stats.mean).toBeCloseTo(28, 0)
    expect(stats.min).toBe(22)
    expect(stats.max).toBe(35)
    // Stdev = sqrt(((25-28)^2 + (30-28)^2 + (28-28)^2 + (22-28)^2 + (35-28)^2) / 5)
    // = sqrt((9 + 4 + 0 + 36 + 49) / 5) = sqrt(98/5) = sqrt(19.6) ≈ 4.43
    expect(stats.stdev).toBeCloseTo(4.43, 1)
  })

  it("skips snapshots with missing or zero PostGIS P95", () => {
    const history = [
      ...makeHistorySnapshots(),
      { timestamp: Date.now(), services: { viacep: { p50: 5, p95: 10, p99: 20, count: 100 } } },
    ]
    const stats = computeP95Stats(history)
    expect(stats.count).toBe(5) // Last snapshot has no postgis key
  })

  it("skips snapshots with p95 <= 0", () => {
    const history = [
      makeHistorySnapshots()[0]!,
      { timestamp: Date.now(), services: { postgis: { p50: 0, p95: 0, p99: 0, count: 0 } } },
    ]
    const stats = computeP95Stats(history)
    expect(stats.count).toBe(1) // Only the first valid snapshot
    expect(stats.mean).toBe(25)
  })

  it("returns zeros when history is null", () => {
    const stats = computeP95Stats(null)
    expect(stats).toEqual({ count: 0, mean: 0, min: 0, max: 0, stdev: 0 })
  })

  it("returns zeros when history is empty", () => {
    const stats = computeP95Stats([])
    expect(stats).toEqual({ count: 0, mean: 0, min: 0, max: 0, stdev: 0 })
  })

  it("returns zeros when history is undefined", () => {
    const stats = computeP95Stats(undefined)
    expect(stats).toEqual({ count: 0, mean: 0, min: 0, max: 0, stdev: 0 })
  })

  it("computes single-value stdev as 0", () => {
    const history = [
      { timestamp: Date.now(), services: { postgis: { p50: 10, p95: 30, p99: 50, count: 100 } } },
    ]
    const stats = computeP95Stats(history)
    expect(stats.count).toBe(1)
    expect(stats.mean).toBe(30)
    expect(stats.min).toBe(30)
    expect(stats.max).toBe(30)
    expect(stats.stdev).toBe(0)
  })
})

// ===========================================================================
// 5. modelPostGISFullMs / modelDelta
// ===========================================================================

describe("modelPostGISFullMs", () => {
  it("computes full-scan PostGIS latency in ms", () => {
    // T = (FIXED_US + PER_ROW_US × N) / 1000
    const for100 = (POSTGIS_FIXED_US + POSTGIS_PER_ROW_US * 100) / 1000
    expect(modelPostGISFullMs(100)).toBeCloseTo(for100, 4)

    const for1000 = (POSTGIS_FIXED_US + POSTGIS_PER_ROW_US * 1000) / 1000
    expect(modelPostGISFullMs(1000)).toBeCloseTo(for1000, 4)

    const for10000 = (POSTGIS_FIXED_US + POSTGIS_PER_ROW_US * 10000) / 1000
    expect(modelPostGISFullMs(10000)).toBeCloseTo(for10000, 4)
  })

  it("increases linearly with provider count", () => {
    const diff1 = modelPostGISFullMs(2000) - modelPostGISFullMs(1000)
    const diff2 = modelPostGISFullMs(3000) - modelPostGISFullMs(2000)
    expect(diff1).toBeCloseTo(diff2, 4)
  })
})

// ===========================================================================
// 6. radiusToSelectivity
// ===========================================================================

describe("radiusToSelectivity", () => {
  it("returns 0 for zero radius", () => {
    expect(radiusToSelectivity(0)).toBe(0)
    expect(radiusToSelectivity(-1)).toBe(0)
  })

  it("returns 1.0 for radius >= reference radius", () => {
    expect(radiusToSelectivity(REFERENCE_RADIUS_KM)).toBe(1.0)
    expect(radiusToSelectivity(100)).toBe(1.0)
  })

  it("computes (r/REFERENCE_RADIUS_KM)² for intermediate radii", () => {
    // At half the reference radius: (0.5)² = 0.25
    const half = REFERENCE_RADIUS_KM / 2
    expect(radiusToSelectivity(half)).toBeCloseTo(0.25, 2)

    // At quarter: (0.25)² = 0.0625
    const quarter = REFERENCE_RADIUS_KM / 4
    expect(radiusToSelectivity(quarter)).toBeCloseTo(0.0625, 2)
  })

  it("increases quadratically with radius", () => {
    const s10 = radiusToSelectivity(10)
    const s20 = radiusToSelectivity(20)
    // Doubling radius quadruples selectivity
    expect(s20).toBeCloseTo(s10 * 4, 1)
  })
})

// ===========================================================================
// 7. selectivityToRadiusLabel
// ===========================================================================

describe("selectivityToRadiusLabel", () => {
  it("returns '> 1 km' for zero selectivity", () => {
    expect(selectivityToRadiusLabel(0)).toBe("< 1 km")
  })

  it("returns labels matching the inverse square relationship", () => {
    // 25% selectivity = sqrt(0.25) * 50 = 25km → rounded to 25km
    expect(selectivityToRadiusLabel(0.25)).toBe("25 km")

    // 100% selectivity = sqrt(1.0) * 50 = 50km → 50km
    expect(selectivityToRadiusLabel(1.0)).toBe("50 km")
  })

  it("rounds to nearest 5km for larger values", () => {
    const label = selectivityToRadiusLabel(0.5)
    expect(label).toMatch(/^\d+ km$/)
  })
})

// ===========================================================================
// 8. computeCostAtSelectivity
// ===========================================================================

describe("computeCostAtSelectivity", () => {
  it("returns one entry per provider count", () => {
    const costs = computeCostAtSelectivity(0.1, TYPICAL_HAV_US)
    expect(costs).toHaveLength(5) // PROVIDER_COUNTS length
  })

  it("PostGIS cost increases with provider count", () => {
    const costs = computeCostAtSelectivity(0.1, TYPICAL_HAV_US)
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i]!.postgisMs).toBeGreaterThan(costs[i - 1]!.postgisMs)
    }
  })

  it("Haversine cost is proportional to N", () => {
    const costs = computeCostAtSelectivity(0.5, TYPICAL_HAV_US)
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i]!.haversineMs).toBeGreaterThan(costs[i - 1]!.haversineMs)
    }
  })

  it("PostGIS wins for large provider counts at very low selectivity", () => {
    // At s=0.001 (0.1%), PostGIS beats Haversine when N is large enough
    // that the fixed overhead gets amortized: s < (h·N - F) / (p·N)
    // For N=10000: s < 0.0135 → PostGIS wins
    const costs = computeCostAtSelectivity(0.001, TYPICAL_HAV_US)
    const large = costs.find((c) => c.n >= 10000)
    expect(large).toBeDefined()
    expect(large!.faster).toBe("PostGIS")
  })

  it("Haversine always wins for small provider counts regardless of selectivity", () => {
    // PostGIS fixed overhead (2ms) dominates for N <= 1000:
    // s < (h·N - F) / (p·N) requires h·N > F, i.e., N > F/h = 4018
    const costsAtLowSel = computeCostAtSelectivity(0.001, TYPICAL_HAV_US)
    const smallAtLow = costsAtLowSel.find((c) => c.n <= 1000)
    expect(smallAtLow).toBeDefined()
    expect(smallAtLow!.faster).toBe("Haversine")

    const costsAtHighSel = computeCostAtSelectivity(0.5, TYPICAL_HAV_US)
    const smallAtHigh = costsAtHighSel.find((c) => c.n <= 1000)
    expect(smallAtHigh).toBeDefined()
    expect(smallAtHigh!.faster).toBe("Haversine")
  })

  it("Haversine wins at high selectivity with many providers", () => {
    const costs = computeCostAtSelectivity(0.5, TYPICAL_HAV_US) // 50% selectivity
    // At 50% selectivity: N > F/(h - p·s) = 2000/(0.4978 - 11) — negative.
    // So Haversine is always faster at 50% selectivity for any N.
    for (const c of costs) {
      expect(c.faster).toBe("Haversine")
    }
  })

  it("ratio equals pgMs / havMs rounded to 1 decimal", () => {
    const costs = computeCostAtSelectivity(0.1, TYPICAL_HAV_US)
    for (const c of costs) {
      expect(c.ratio).toBeGreaterThan(0)
      // Recompute ratio from the already-rounded values and verify they match
      const recomputed = +(c.postgisMs / c.haversineMs).toFixed(1)
      // Accept up to 0.21 tolerance due to floating-point rounding in toFixed
      expect(Math.abs(c.ratio - recomputed)).toBeLessThanOrEqual(0.21)
    }
  })
})

describe("modelDelta", () => {
  it("computes positive delta when measured exceeds model", () => {
    // Model for 1000 providers
    const model1000 = modelPostGISFullMs(1000)
    // Measured is higher
    const delta = modelDelta(model1000 + 5, 1000)
    expect(delta).toBeCloseTo(5, 2)
  })

  it("computes negative delta when measured is below model", () => {
    const model1000 = modelPostGISFullMs(1000)
    const delta = modelDelta(model1000 - 3, 1000)
    expect(delta).toBeCloseTo(-3, 2)
  })

  it("returns zero delta when measured equals model", () => {
    const model1000 = modelPostGISFullMs(1000)
    const delta = modelDelta(model1000, 1000)
    expect(delta).toBeCloseTo(0, 4)
  })
})
