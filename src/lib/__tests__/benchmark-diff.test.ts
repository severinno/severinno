// @ts-nocheck
import { describe, it, expect } from "vitest"
import { pct, arrow, computeDiff } from "../benchmark-diff.mjs"
import type { BenchmarkJson } from "../benchmark-diff"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baselineFixture: BenchmarkJson = {
  meta: { cpuItersPerMs: 1000, platform: "linux", arch: "x64", nodeVersion: "v22", timestamp: "2026-07-01T00:00:00.000Z" },
  benchmarks: [
    { name: "bench A", label: "bench_a", mean: 100, min: 90, max: 110, opsPerSec: 10000 },
    { name: "bench B", label: "bench_b", mean: 200, min: 180, max: 220, opsPerSec: 5000 },
  ],
}

const currentFixture: BenchmarkJson = {
  meta: { cpuItersPerMs: 1000, platform: "linux", arch: "x64", nodeVersion: "v22", timestamp: "2026-07-26T00:00:00.000Z" },
  benchmarks: [
    { name: "bench A", label: "bench_a", mean: 110, min: 95, max: 125, opsPerSec: 9000 },
    { name: "bench B", label: "bench_b", mean: 150, min: 140, max: 160, opsPerSec: 6667 },
  ],
}

// Fixtures with NO regressions — for new/removed benchmark tests
const noRegressionBaseline: BenchmarkJson = {
  meta: {},
  benchmarks: [
    { name: "bench A", label: "bench_a", mean: 100, min: 90, max: 110, opsPerSec: 10000 },
  ],
}

const noRegressionCurrent: BenchmarkJson = {
  meta: {},
  benchmarks: [
    { name: "bench A", label: "bench_a", mean: 95, min: 86, max: 104, opsPerSec: 10526 },
  ],
}

// ---------------------------------------------------------------------------
// pct()
// ---------------------------------------------------------------------------

describe("pct", () => {
  it("returns 0 when both values are 0", () => {
    expect(pct(0, 0)).toBe(0)
  })

  it("returns Infinity when baseline is 0 and current is positive", () => {
    expect(pct(0, 5)).toBe(Infinity)
  })

  it("returns Infinity when baseline is 0 and current is negative", () => {
    expect(pct(0, -5)).toBe(Infinity)
  })

  it("returns 0 when values are equal", () => {
    expect(pct(100, 100)).toBe(0)
  })

  it("returns positive for increase", () => {
    expect(pct(100, 110)).toBe(10)
  })

  it("returns negative for decrease", () => {
    expect(pct(100, 90)).toBe(-10)
  })

  it("handles decimal values", () => {
    expect(pct(50.5, 75.75)).toBeCloseTo(50, 0)
  })

  it("handles negative baseline", () => {
    expect(pct(-100, -50)).toBe(50)
  })

  it("handles large numbers without overflow", () => {
    const result = pct(1e6, 2e6)
    expect(result).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// arrow()
// ---------------------------------------------------------------------------

describe("arrow", () => {
  it("returns neutral arrow when change is below 0.5%", () => {
    expect(arrow(0)).toBe(" →")
    expect(arrow(0.3)).toBe(" →")
    expect(arrow(-0.3)).toBe(" →")
  })

  it("returns up arrow for positive change >= 0.5%", () => {
    expect(arrow(0.5)).toBe(" ↑")
    expect(arrow(10)).toBe(" ↑")
  })

  it("returns down arrow for negative change <= -0.5%", () => {
    expect(arrow(-0.5)).toBe(" ↓")
    expect(arrow(-10)).toBe(" ↓")
  })

  it("handles Infinity", () => {
    expect(arrow(Infinity)).toBe(" ↑")
    expect(arrow(-Infinity)).toBe(" ↓")
  })
})

// ---------------------------------------------------------------------------
// computeDiff()
// ---------------------------------------------------------------------------

describe("computeDiff", () => {
  it("computes elapsedMs between timestamps", () => {
    const result = computeDiff(baselineFixture, currentFixture)
    // 25 days in ms = 25 * 24 * 60 * 60 * 1000
    expect(result.meta.elapsedMs).toBe(25 * 24 * 60 * 60 * 1000)
  })

  it("returns 0 elapsedMs when timestamps are missing", () => {
    const noTs: BenchmarkJson = { meta: {}, benchmarks: [] }
    const result = computeDiff(noTs, noTs)
    expect(result.meta.elapsedMs).toBe(0)
  })

  it("computes pct for all metrics in each benchmark entry", () => {
    const result = computeDiff(baselineFixture, currentFixture)

    const benchA = result.benchmarks.find((b) => b.label === "bench_a")!
    expect(benchA).toBeDefined()

    if ("mean" in benchA) {
      // 100 → 110 = +10%
      expect(benchA.mean.pct).toBeCloseTo(10, 0)
      expect(benchA.mean.baseline).toBe(100)
      expect(benchA.mean.current).toBe(110)

      // 90 → 95 = +5.6%
      expect(benchA.min.pct).toBeCloseTo(5.6, 0)

      // 110 → 125 = +13.6%
      expect(benchA.max.pct).toBeCloseTo(13.6, 0)

      // 10000 → 9000 = -10%
      expect(benchA.opsPerSec.pct).toBeCloseTo(-10, 0)
    }
  })

  it("detects regression when mean increases above threshold", () => {
    const result = computeDiff(baselineFixture, currentFixture, { threshold: 5 })
    // bench A: mean 100 → 110 = +10% > 5% → regression
    expect(result.regressions.some((r) => r.label === "bench_a")).toBe(true)
    // bench B: mean 200 → 150 = -25% < 5% → improvement, not regression
    expect(result.regressions.some((r) => r.label === "bench_b")).toBe(false)
  })

  it("marks entry as 'changed' when change is between 1% and threshold", () => {
    const result = computeDiff(baselineFixture, currentFixture, { threshold: 20 })
    // bench A: 100 → 110 = +10%, which is < 20% threshold → "changed", not "regression"
    const benchA = result.benchmarks.find((b) => b.label === "bench_a")!
    expect(benchA).toBeDefined()
    if ("status" in benchA) {
      expect(benchA.status).toBe("changed")
    }
    expect(result.regressions.length).toBe(0)
  })

  it("marks new benchmarks when label exists only in current", () => {
    const currentWithNew: BenchmarkJson = {
      ...noRegressionCurrent,
      benchmarks: [
        ...noRegressionCurrent.benchmarks,
        { name: "bench B", label: "bench_b", mean: 200, min: 180, max: 220, opsPerSec: 5000 },
      ],
    }
    const result = computeDiff(noRegressionBaseline, currentWithNew)
    const benchB = result.benchmarks.find((b) => b.label === "bench_b")!
    expect(benchB).toBeDefined()
    expect(benchB.status).toBe("new")
    // No regressions because bench A improved (100→95) and bench B is new
    expect(result.regressions.length).toBe(0)
  })

  it("marks removed benchmarks when label exists only in baseline", () => {
    const baselineWithExtra: BenchmarkJson = {
      ...noRegressionBaseline,
      benchmarks: [
        ...noRegressionBaseline.benchmarks,
        { name: "bench B", label: "bench_b", mean: 200, min: 180, max: 220, opsPerSec: 5000 },
      ],
    }
    const result = computeDiff(baselineWithExtra, noRegressionCurrent)
    const benchB = result.benchmarks.find((b) => b.label === "bench_b")!
    expect(benchB).toBeDefined()
    expect(benchB.status).toBe("removed")
  })

  it("filters by label prefix when filterPrefix is provided", () => {
    const result = computeDiff(baselineFixture, currentFixture, { filterPrefix: "bench_a" })
    const labels = result.benchmarks.map((b) => b.label)
    expect(labels).toEqual(["bench_a"])
    expect(labels).not.toContain("bench_b")
  })

  it("returns empty benchmarks when filterPrefix matches nothing", () => {
    const result = computeDiff(baselineFixture, currentFixture, { filterPrefix: "nonexistent_" })
    expect(result.benchmarks).toHaveLength(0)
  })

  it("uses default threshold of 5 when not specified", () => {
    const result = computeDiff(baselineFixture, currentFixture)
    // bench A: +10% > 5% → regression
    expect(result.regressions.some((r) => r.label === "bench_a")).toBe(true)
  })

  it("handles empty benchmark arrays", () => {
    const empty: BenchmarkJson = { meta: {}, benchmarks: [] }
    const result = computeDiff(empty, empty)
    expect(result.benchmarks).toHaveLength(0)
    expect(result.regressions).toHaveLength(0)
  })

  it("computes analysis diff when both have analysis", () => {
    const withAnalysis: BenchmarkJson = {
      meta: {},
      benchmarks: [],
      analysis: {
        haversineUnitCosts: { at100: 0.5, at1000: 0.05, at10000: 0.005 },
        avgHaversinePerProvider: 0.185,
      },
    }
    const withAnalysis2: BenchmarkJson = {
      meta: {},
      benchmarks: [],
      analysis: {
        haversineUnitCosts: { at100: 0.6, at1000: 0.06, at10000: 0.006 },
        avgHaversinePerProvider: 0.222,
      },
    }
    const result = computeDiff(withAnalysis, withAnalysis2)
    expect(result.analysis).not.toBeNull()
    expect(result.analysis!.haversineUnitCosts!.at100.pct).toBeCloseTo(20, 0)
    expect(result.analysis!.avgHaversinePerProvider.pct).toBeCloseTo(20, 0)
  })

  it("returns null analysis when one side lacks analysis", () => {
    const result = computeDiff(baselineFixture, currentFixture)
    expect(result.analysis).toBeNull()
  })

  it("marks 'unchanged' when change is below 1%", () => {
    const almostSame: BenchmarkJson = {
      meta: {},
      benchmarks: [
        { name: "bench A", label: "bench_a", mean: 100, min: 90, max: 110, opsPerSec: 10000 },
      ],
    }
    const almostSame2: BenchmarkJson = {
      meta: {},
      benchmarks: [
        { name: "bench A", label: "bench_a", mean: 100.3, min: 90.2, max: 110.1, opsPerSec: 9990 },
      ],
    }
    const result = computeDiff(almostSame, almostSame2)
    const benchA = result.benchmarks.find((b) => b.label === "bench_a")!
    expect(benchA).toBeDefined()
    if ("status" in benchA) {
      expect(benchA.status).toBe("unchanged")
    }
  })
})
