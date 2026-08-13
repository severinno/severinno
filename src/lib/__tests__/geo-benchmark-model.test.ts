/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for pure functions in geo-benchmark-model.ts.
 *
 * Currently covers computeGiSTDegradation() — the GiST degradation detection
 * logic extracted from GiSTSelectivitySection (admin-geo-metrics-dashboard.tsx).
 */

import { describe, it, expect } from "vitest"
import {
  computeGiSTDegradation,
  computeSelectivityPoints,
  PROVIDER_COUNTS,
  POSTGIS_FIXED_US,
  POSTGIS_PER_ROW_US,
} from "@/lib/geo-benchmark-model"

// ── Fixtures ──────────────────────────────────────────────────────────────

/** Benchmark fixture with 3 provider scales. */
const BENCHMARK_FIXTURE = [
  { scale: 100, postgis: { mean: 2200 } },
  { scale: 1000, postgis: { mean: 24000 } },
  { scale: 10000, postgis: { mean: 222000 } },
]

/** Haversine per provider (in µs). */
const HAV_US = 0.1323

/** Full selectivity curve from the fixture. */
function buildSelectivityCurve() {
  return computeSelectivityPoints(BENCHMARK_FIXTURE, HAV_US)
}

// ── computeGiSTDegradation ────────────────────────────────────────────────

describe("computeGiSTDegradation", () => {
  it("returns degraded=true when real P95 exceeds ALL model curves", () => {
    const points = buildSelectivityCurve()

    // Selectivity "15%" — find max pg_* value
    const result = computeGiSTDegradation(points, "15%", 100, true)

    // At 15% selectivity, the max model value for 10k providers should be
    // well below 100ms (our p95Mean). Let's verify with constants:
    // POSTGIS_FIXED_US = 2000, POSTGIS_PER_ROW_US = 22, s = 0.15
    // pg_10000 = (2000 + 22 * 10000 * 0.15) / 1000 = (2000 + 33000) / 1000 = 35ms
    expect(result.gistDegraded).toBe(true)
    expect(result.exceedingCount).toBe(PROVIDER_COUNTS.length) // All scales exceeded
    expect(result.maxModelAtSelectivity).toBeGreaterThan(0)
  })

  it("returns degraded=false when real P95 is below all model curves", () => {
    const points = buildSelectivityCurve()

    // At 100% selectivity, model values are highest.
    // pg_100 = (2000 + 22 * 100) / 1000 = 4.2ms
    // pg_10000 = (2000 + 22 * 10000) / 1000 = 222ms
    // Using p95Mean = 0.1ms, all model values exceed it → not degraded
    const result = computeGiSTDegradation(points, "100%", 0.1, true)

    expect(result.gistDegraded).toBe(false)
    expect(result.exceedingCount).toBe(0)
    expect(result.maxModelAtSelectivity).toBeGreaterThan(0)
  })

  it("returns degraded=false when p95Mean is zero (no real data)", () => {
    const points = buildSelectivityCurve()

    const result = computeGiSTDegradation(points, "15%", 0, true)

    expect(result.gistDegraded).toBe(false)
    expect(result.maxModelAtSelectivity).toBe(0)
    expect(result.exceedingCount).toBe(0)
  })

  it("returns degraded=false when hasP95Data is false", () => {
    const points = buildSelectivityCurve()

    const result = computeGiSTDegradation(points, "15%", 100, false)

    expect(result.gistDegraded).toBe(false)
    expect(result.maxModelAtSelectivity).toBe(0)
    expect(result.exceedingCount).toBe(0)
  })

  it("returns degraded=false when selectivity row not found", () => {
    const points = buildSelectivityCurve()

    // "99%" doesn't exist in the 5% increment grid (0, 5, 10, ..., 100)
    const result = computeGiSTDegradation(points, "99%", 100, true)

    expect(result.gistDegraded).toBe(false)
    expect(result.maxModelAtSelectivity).toBe(0)
    expect(result.exceedingCount).toBe(0)
  })

  it("reports correct maxModelAtSelectivity and exceedingCount", () => {
    const points = buildSelectivityCurve()

    // At "5%" selectivity, compute the theoretical model values:
    // pg_100   = (2000 + 22 * 100 * 0.05) / 1000 = 2.11ms → rounded 2.1ms
    // pg_500   = (2000 + 22 * 500 * 0.05) / 1000 = 2.55ms → rounded 2.6ms (2.6? no, 2.55 rounds to 2.6... wait 2.55 rounds to 2.5? Math.round(2.55 * 10) / 10 = 26/10 = 2.6)
    // pg_1000  = (2000 + 22 * 1000 * 0.05) / 1000 = 3.1ms → rounded 3.1ms
    // pg_5000  = (2000 + 22 * 5000 * 0.05) / 1000 = 7.5ms → rounded 7.5ms
    // pg_10000 = (2000 + 22 * 10000 * 0.05) / 1000 = 13.0ms → rounded 13.0ms
    // Max is 13.0ms at pg_10000
    // With p95Mean = 5ms, exceeding: pg_100 (2.1 < 5 ✓), pg_500 (2.6 < 5 ✓),
    //   pg_1000 (3.1 < 5 ✓), pg_5000 (7.5 < 5 ✗), pg_10000 (13.0 < 5 ✗)
    // So exceedingCount = 3
    // p95Mean (5) < max (13.0) → not degraded
    const result = computeGiSTDegradation(points, "5%", 5, true)

    // Verify by manually computing the expected values
    const s = 0.05
    const expectedValues = PROVIDER_COUNTS.map((n) => {
      const pgFiltered = POSTGIS_FIXED_US + POSTGIS_PER_ROW_US * n * s
      return Math.round((pgFiltered / 1000) * 10) / 10
    })

    const expectedMax = Math.max(...expectedValues)
    const expectedExceeding = expectedValues.filter((v) => 5 > v).length

    expect(result.maxModelAtSelectivity).toBe(expectedMax)
    expect(result.exceedingCount).toBe(expectedExceeding)

    // At p95Mean=5 < max=13.0 → not degraded
    expect(result.gistDegraded).toBe(false)
  })

  it("handles partial exceeding correctly — some scales below, some above p95", () => {
    const points = buildSelectivityCurve()

    // At "50%" selectivity (s=0.5):
    // pg_10000 = (2000 + 22 * 10000 * 0.5) / 1000 = (2000 + 110000) / 1000 = 112ms
    // pg_1000  = (2000 + 22 * 1000 * 0.5) / 1000 = (2000 + 11000) / 1000 = 13ms
    // pg_100   = (2000 + 22 * 100 * 0.5) / 1000 = (2000 + 1100) / 1000 = 3.1ms
    // With p95Mean = 10ms:
    //   pg_100 (3.1 < 10 ✓), pg_500 (?), pg_1000 (13 < 10 ✗), pg_5000 (?), pg_10000 (112 < 10 ✗)
    // Let me just verify the result has sensible properties
    const result = computeGiSTDegradation(points, "50%", 10, true)

    // At least some scales exceeded, but not all (the largest scale won't be)
    expect(result.exceedingCount).toBeGreaterThan(0)
    expect(result.exceedingCount).toBeLessThan(PROVIDER_COUNTS.length)

    // Max model is at pg_10000
    const s = 0.5
    const pg10000 =
      Math.round(((POSTGIS_FIXED_US + POSTGIS_PER_ROW_US * 10000 * s) / 1000) * 10) / 10
    expect(result.maxModelAtSelectivity).toBe(pg10000)

    // p95Mean=10 < max=pg10000 → not degraded
    expect(result.gistDegraded).toBe(false)
  })
})
