/**
 * benchmark-data.test.ts
 *
 * Unit tests for the pure data transformation functions extracted from
 * BenchmarkSection in admin-geo-metrics-dashboard.tsx.
 *
 * Tests cover:
 *   1. buildBenchmarkBarData — transforms comparisons; preserves all fields
 *   2. getMaxPostgisLatency  — max latency, empty edge case
 *   3. ratioColor            — threshold mapping (green, amber, red)
 *   4. buildTrendData        — per-type aggregated trend by date
 *   5. buildPerBenchTrend    — per-benchmark granular trend with filters
 *   6. perBenchLines         — line configs from trend data
 *
 * Each test uses inline fixture data so it's self-contained.
 */

import { describe, it, expect } from "vitest"
import {
  buildBenchmarkBarData,
  getMaxPostgisLatency,
  ratioColor,
  RATIO_COLOR_FAST,
  RATIO_COLOR_WARN,
  RATIO_COLOR_SLOW,
  buildTrendData,
  buildPerBenchTrend,
  perBenchLines,
  BENCHMARK_TYPE_LABELS,
} from "../benchmark-data"
import type { BenchmarkData, RunsMap, BenchmarkRun } from "../benchmark-data"

// ===========================================================================
// Fixtures
// ===========================================================================

function makeBenchmarkData(): BenchmarkData {
  return {
    comparisons: [
      {
        label: "100 providers",
        scale: 100,
        haversine: { mean: 49.78, opsPerSec: 20088 },
        postgis: { mean: 4200, opsPerSec: 238 },
        ratio: 84.4,
      },
      {
        label: "1k providers",
        scale: 1000,
        haversine: { mean: 497.8, opsPerSec: 2009 },
        postgis: { mean: 24000, opsPerSec: 42 },
        ratio: 48.2,
      },
      {
        label: "10k providers",
        scale: 10000,
        haversine: { mean: 4978, opsPerSec: 201 },
        postgis: { mean: 222000, opsPerSec: 4.5 },
        ratio: 44.6,
      },
    ],
    analysis: {
      note: "Haversine JS é significativamente mais rápido que PostGIS...",
      avgHaversinePerProvider: 0.4978,
    },
    meta: {
      platform: "win32",
      nodeVersion: "v22.14.0",
      centerLabel: "-23.5505, -46.6333",
      timestamp: "2026-04-13T00:00:00.000Z",
    },
  }
}

/** Helper: build a BenchmarkRun inline. */
function run(
  ts: string,
  benchmarks: Array<{ label: string; mean: number; opsPerSec: number; p95?: number }>,
): BenchmarkRun {
  return { meta: { timestamp: ts }, benchmarks }
}

/** Helper: build a RunsMap inline from a simple record. */
function runsMap(types: Record<string, BenchmarkRun[]>): RunsMap {
  return types
}

// ===========================================================================
// 1. buildBenchmarkBarData
// ===========================================================================

describe("buildBenchmarkBarData", () => {
  it("produces one item per comparison", () => {
    const data = buildBenchmarkBarData(makeBenchmarkData())
    expect(data).toHaveLength(3)
  })

  it("preserves label, scale, and ratio from input", () => {
    const data = buildBenchmarkBarData(makeBenchmarkData())

    expect(data[0]!.label).toBe("100 providers")
    expect(data[0]!.scale).toBe(100)
    expect(data[0]!.ratio).toBeCloseTo(84.4, 1)

    expect(data[1]!.label).toBe("1k providers")
    expect(data[1]!.scale).toBe(1000)
    expect(data[1]!.ratio).toBeCloseTo(48.2, 1)

    expect(data[2]!.label).toBe("10k providers")
    expect(data[2]!.scale).toBe(10000)
    expect(data[2]!.ratio).toBeCloseTo(44.6, 1)
  })

  it("extracts haversine mean and ops from comparison input", () => {
    const data = buildBenchmarkBarData(makeBenchmarkData())

    expect(data[0]!.haversine).toBeCloseTo(49.78, 1)
    expect(data[0]!.haversine_ops).toBeCloseTo(20088, 0)

    expect(data[1]!.haversine).toBeCloseTo(497.8, 0)
    expect(data[1]!.haversine_ops).toBeCloseTo(2009, 0)

    expect(data[2]!.haversine).toBeCloseTo(4978, 0)
    expect(data[2]!.haversine_ops).toBeCloseTo(201, 0)
  })

  it("extracts postgis mean and ops from comparison input", () => {
    const data = buildBenchmarkBarData(makeBenchmarkData())

    expect(data[0]!.postgis).toBeCloseTo(4200, 0)
    expect(data[0]!.postgis_ops).toBeCloseTo(238, 0)

    expect(data[1]!.postgis).toBeCloseTo(24000, 0)
    expect(data[1]!.postgis_ops).toBeCloseTo(42, 0)

    expect(data[2]!.postgis).toBeCloseTo(222000, 0)
    expect(data[2]!.postgis_ops).toBeCloseTo(4.5, 1)
  })

  it("returns empty array for empty comparisons", () => {
    const empty: BenchmarkData = {
      comparisons: [],
      analysis: { note: "", avgHaversinePerProvider: 0 },
      meta: { platform: "", nodeVersion: "", centerLabel: "", timestamp: "" },
    }
    const data = buildBenchmarkBarData(empty)
    expect(data).toHaveLength(0)
  })

  it("handles single comparison gracefully", () => {
    const single: BenchmarkData = {
      comparisons: [
        {
          label: "50 providers",
          scale: 50,
          haversine: { mean: 25, opsPerSec: 40000 },
          postgis: { mean: 2100, opsPerSec: 476 },
          ratio: 84.0,
        },
      ],
      analysis: { note: "", avgHaversinePerProvider: 0.5 },
      meta: { platform: "", nodeVersion: "", centerLabel: "", timestamp: "" },
    }
    const data = buildBenchmarkBarData(single)
    expect(data).toHaveLength(1)
    expect(data[0]!.label).toBe("50 providers")
    expect(data[0]!.haversine).toBe(25)
    expect(data[0]!.postgis).toBe(2100)
  })

  it("extracts ratio = postgis.mean / haversine.mean", () => {
    const data = buildBenchmarkBarData(makeBenchmarkData())
    for (const item of data) {
      const expectedRatio = +(item.postgis / item.haversine).toFixed(1)
      expect(Math.abs(item.ratio - expectedRatio)).toBeLessThanOrEqual(0.21)
    }
  })

  it("extends correctly when additional scales are added", () => {
    const extended: BenchmarkData = {
      comparisons: [
        ...makeBenchmarkData().comparisons,
        {
          label: "50k providers",
          scale: 50000,
          haversine: { mean: 24890, opsPerSec: 40 },
          postgis: { mean: 1100000, opsPerSec: 0.9 },
          ratio: 44.2,
        },
      ],
      analysis: makeBenchmarkData().analysis,
      meta: makeBenchmarkData().meta,
    }
    const data = buildBenchmarkBarData(extended)
    expect(data).toHaveLength(4)
    expect(data[3]!.label).toBe("50k providers")
    expect(data[3]!.scale).toBe(50000)
    expect(data[3]!.postgis).toBe(1100000)
  })
})

// ===========================================================================
// 2. getMaxPostgisLatency
// ===========================================================================

describe("getMaxPostgisLatency", () => {
  it("returns the maximum PostGIS mean across all items", () => {
    const data = buildBenchmarkBarData(makeBenchmarkData())
    expect(getMaxPostgisLatency(data)).toBe(222000)
  })

  it("handles descending-scale comparisons", () => {
    const data = buildBenchmarkBarData(makeBenchmarkData())
    expect(getMaxPostgisLatency(data)).toBe(222000)
  })

  it("handles single-item data", () => {
    const data = buildBenchmarkBarData({
      comparisons: [
        {
          label: "100 providers",
          scale: 100,
          haversine: { mean: 50, opsPerSec: 20000 },
          postgis: { mean: 5000, opsPerSec: 200 },
          ratio: 100,
        },
      ],
      analysis: { note: "", avgHaversinePerProvider: 0.5 },
      meta: { platform: "", nodeVersion: "", centerLabel: "", timestamp: "" },
    })
    expect(getMaxPostgisLatency(data)).toBe(5000)
  })

  it("returns 0 for empty data", () => {
    expect(getMaxPostgisLatency([])).toBe(0)
  })

  it("returns the correct value when all values are equal", () => {
    const data: BenchmarkData = {
      comparisons: [
        {
          label: "A",
          scale: 100,
          haversine: { mean: 100, opsPerSec: 10000 },
          postgis: { mean: 300, opsPerSec: 3333 },
          ratio: 3,
        },
        {
          label: "B",
          scale: 1000,
          haversine: { mean: 100, opsPerSec: 10000 },
          postgis: { mean: 300, opsPerSec: 3333 },
          ratio: 3,
        },
      ],
      analysis: { note: "", avgHaversinePerProvider: 1 },
      meta: { platform: "", nodeVersion: "", centerLabel: "", timestamp: "" },
    }
    expect(getMaxPostgisLatency(buildBenchmarkBarData(data))).toBe(300)
  })
})

// ===========================================================================
// 3. ratioColor
// ===========================================================================

describe("ratioColor", () => {
  it("returns fast color for ratio <= 10", () => {
    expect(ratioColor(0)).toBe(RATIO_COLOR_FAST)
    expect(ratioColor(1)).toBe(RATIO_COLOR_FAST)
    expect(ratioColor(5)).toBe(RATIO_COLOR_FAST)
    expect(ratioColor(10)).toBe(RATIO_COLOR_FAST)
  })

  it("returns warn color for 10 < ratio <= 50", () => {
    expect(ratioColor(10.1)).toBe(RATIO_COLOR_WARN)
    expect(ratioColor(20)).toBe(RATIO_COLOR_WARN)
    expect(ratioColor(50)).toBe(RATIO_COLOR_WARN)
  })

  it("returns slow color for ratio > 50", () => {
    expect(ratioColor(50.1)).toBe(RATIO_COLOR_SLOW)
    expect(ratioColor(84.4)).toBe(RATIO_COLOR_SLOW)
    expect(ratioColor(100)).toBe(RATIO_COLOR_SLOW)
    expect(ratioColor(1000)).toBe(RATIO_COLOR_SLOW)
  })

  it("handles negative ratio defensively (should not happen in practice)", () => {
    const color = ratioColor(-1)
    expect(color).toBe(RATIO_COLOR_FAST)
  })

  it("handles fractional ratio correctly", () => {
    expect(ratioColor(9.999)).toBe(RATIO_COLOR_FAST)
    expect(ratioColor(10.001)).toBe(RATIO_COLOR_WARN)
    expect(ratioColor(49.999)).toBe(RATIO_COLOR_WARN)
    expect(ratioColor(50.001)).toBe(RATIO_COLOR_SLOW)
  })

  it("maps to the same colors used by the ratio bar chart cells", () => {
    const testCases = [
      { ratio: 5, expected: RATIO_COLOR_FAST },
      { ratio: 15, expected: RATIO_COLOR_WARN },
      { ratio: 60, expected: RATIO_COLOR_SLOW },
    ]
    for (const { ratio, expected } of testCases) {
      expect(ratioColor(ratio)).toBe(expected)
    }
  })
})

// ===========================================================================
// 4. buildTrendData
// ===========================================================================

describe("buildTrendData", () => {
  const geoRun1 = run("2026-01-15T10:00:00Z", [
    { label: "haversine_100", mean: 50, opsPerSec: 20000 },
  ])
  const geoRun2 = run("2026-01-20T10:00:00Z", [
    { label: "haversine_100", mean: 55, opsPerSec: 18000, p95: 58 },
  ])
  const cacheRun1 = run("2026-01-15T12:00:00Z", [
    { label: "cache_get", mean: 2, opsPerSec: 500000 },
  ])
  const cacheRun2 = run("2026-01-18T10:00:00Z", [
    { label: "cache_get", mean: 2.5, opsPerSec: 400000 },
  ])

  it("groups runs by date with one row per type per date", () => {
    const result = buildTrendData(
      runsMap({ geo: [geoRun1, geoRun2], cache: [cacheRun1, cacheRun2] }),
    )

    // 3 distinct dates: Jan 15, Jan 18, Jan 20
    expect(result).toHaveLength(3)

    // Sorted chronologically
    expect(result[0]!.date).toBe("15/01/2026")
    expect(result[1]!.date).toBe("18/01/2026")
    expect(result[2]!.date).toBe("20/01/2026")
  })

  it("extracts mean, ops, and p95 keys per type per row", () => {
    const result = buildTrendData(runsMap({ geo: [geoRun1, geoRun2] }))

    expect(result).toHaveLength(2)

    // First row (Jan 15): geo type present
    expect(result[0]!.geo).toBe(50) // mean
    expect(result[0]!.geo_ops).toBe(20000)
    expect(result[0]!.geo_p95).toBe(50) // p95 fallback to mean

    // Second row (Jan 20): p95 explicitly set
    expect(result[1]!.geo).toBe(55)
    expect(result[1]!.geo_ops).toBe(18000)
    expect(result[1]!.geo_p95).toBe(58)
  })

  it("returns empty array for empty runs", () => {
    expect(buildTrendData({})).toHaveLength(0)
  })

  it("skips runs without timestamp", () => {
    const noTs = run("", [{ label: "test", mean: 10, opsPerSec: 100 }])
    // Remove timestamp by using meta without timestamp
    noTs.meta = { timestamp: undefined }
    const result = buildTrendData(runsMap({ geo: [noTs] }))
    expect(result).toHaveLength(0)
  })

  it("skips runs with empty benchmarks array", () => {
    const emptyBench = run("2026-01-15T10:00:00Z", [])
    const result = buildTrendData(runsMap({ geo: [emptyBench] }))
    expect(result).toHaveLength(0)
  })

  it("sorts runs chronologically even when input is out of order", () => {
    const later = run("2026-01-20T10:00:00Z", [
      { label: "haversine_100", mean: 60, opsPerSec: 16600 },
    ])
    const earlier = run("2026-01-10T10:00:00Z", [
      { label: "haversine_100", mean: 45, opsPerSec: 22200 },
    ])

    // Pass out of order (later first)
    const result = buildTrendData(runsMap({ geo: [later, earlier] }))

    expect(result[0]!.geo).toBe(45) // Jan 10 first
    expect(result[1]!.geo).toBe(60) // Jan 20 second
  })

  it("overwrites type data when multiple runs fall on the same date", () => {
    const first = run("2026-01-15T10:00:00Z", [
      { label: "haversine_100", mean: 50, opsPerSec: 20000 },
    ])
    const second = run("2026-01-15T14:00:00Z", [
      { label: "haversine_100", mean: 55, opsPerSec: 18000 },
    ])

    const result = buildTrendData(runsMap({ geo: [first, second] }))

    expect(result).toHaveLength(1)
    // Only one row for Jan 15 with the last run's data
    expect(result[0]!.geo).toBe(55)
    expect(result[0]!.geo_ops).toBe(18000)
  })

  it("handles multiple types with different date coverage", () => {
    // geo: Jan 15, Jan 20  |  cache: Jan 15 only
    const result = buildTrendData(runsMap({ geo: [geoRun1, geoRun2], cache: [cacheRun1] }))

    expect(result).toHaveLength(2)
    // Jan 15: geo + cache
    expect(result[0]!.geo).toBe(50)
    expect(result[0]!.cache).toBe(2)
    // Jan 20: geo only
    expect(result[1]!.geo).toBe(55)
    expect(result[1]!.cache).toBeUndefined()
  })
})

// ===========================================================================
// 5. buildPerBenchTrend
// ===========================================================================

describe("buildPerBenchTrend", () => {
  const alwaysTrue: (ts: string | undefined) => boolean = () => true
  const alwaysFalse: (ts: string | undefined) => boolean = () => false

  const geoRun = run("2026-01-15T10:00:00Z", [
    { label: "haversine_100", mean: 50, opsPerSec: 20000 },
    { label: "haversine_1000", mean: 500, opsPerSec: 2000 },
  ])
  const cacheRun = run("2026-01-15T12:00:00Z", [{ label: "cache_get", mean: 2, opsPerSec: 500000 }])

  it("preserves per-benchmark granularity with type::label keys", () => {
    const result = buildPerBenchTrend(
      runsMap({ geo: [geoRun], cache: [cacheRun] }),
      alwaysTrue,
      new Set(["geo", "cache"]),
    )

    expect(result).toHaveLength(1) // both on same date

    // Keys include type::label for each benchmark
    expect(result[0]!["geo::haversine_100_mean"]).toBe(50)
    expect(result[0]!["geo::haversine_100_ops"]).toBe(20000)
    expect(result[0]!["geo::haversine_100_p95"]).toBe(50) // p95 fallback to mean

    expect(result[0]!["geo::haversine_1000_mean"]).toBe(500)
    expect(result[0]!["geo::haversine_1000_ops"]).toBe(2000)

    expect(result[0]!["cache::cache_get_mean"]).toBe(2)
    expect(result[0]!["cache::cache_get_ops"]).toBe(500000)
  })

  it("returns empty array for empty allRuns", () => {
    const result = buildPerBenchTrend({}, alwaysTrue, new Set(["geo"]))
    expect(result).toHaveLength(0)
  })

  it("skips types not in selectedTypes", () => {
    const result = buildPerBenchTrend(
      runsMap({ geo: [geoRun], cache: [cacheRun] }),
      alwaysTrue,
      new Set(["geo"]), // cache NOT selected
    )

    expect(result).toHaveLength(1)
    expect(result[0]!["geo::haversine_100_mean"]).toBe(50)
    expect(result[0]!["cache::cache_get_mean"]).toBeUndefined()
  })

  it("skips runs where filterFn returns false", () => {
    const result = buildPerBenchTrend(runsMap({ geo: [geoRun] }), alwaysFalse, new Set(["geo"]))

    expect(result).toHaveLength(0)
  })

  it("skips runs without timestamp", () => {
    const noTs = run("", [{ label: "test", mean: 10, opsPerSec: 100 }])
    noTs.meta = { timestamp: undefined }
    const result = buildPerBenchTrend(runsMap({ geo: [noTs] }), alwaysTrue, new Set(["geo"]))
    expect(result).toHaveLength(0)
  })

  it("groups benchmarks from different dates into separate rows sorted chronologically", () => {
    const early = run("2026-01-10T10:00:00Z", [
      { label: "haversine_100", mean: 40, opsPerSec: 25000 },
    ])
    const late = run("2026-01-20T10:00:00Z", [
      { label: "haversine_100", mean: 60, opsPerSec: 16600 },
    ])

    const result = buildPerBenchTrend(
      runsMap({ geo: [late, early] }), // out of order
      alwaysTrue,
      new Set(["geo"]),
    )

    expect(result).toHaveLength(2)
    expect(result[0]!.date).toBe("10/01/2026")
    expect(result[1]!.date).toBe("20/01/2026")
  })
})

// ===========================================================================
// 6. perBenchLines
// ===========================================================================

describe("perBenchLines", () => {
  const trendData = [
    {
      date: "15/01/2026",
      "geo::haversine_100_mean": 50,
      "geo::haversine_100_ops": 20000,
      "geo::haversine_100_p95": 50,
      "geo::haversine_1000_mean": 500,
      "geo::haversine_1000_ops": 2000,
      "geo::haversine_1000_p95": 500,
      "cache::cache_get_mean": 2,
      "cache::cache_get_ops": 500000,
      "cache::cache_get_p95": 2,
    },
  ]

  it("returns empty array for empty data", () => {
    expect(perBenchLines([], "mean")).toHaveLength(0)
  })

  it("returns one line per benchmark key ending with _mean suffix", () => {
    const lines = perBenchLines(trendData, "mean")
    // 3 benchmarks: haversine_100, haversine_1000, cache_get
    expect(lines).toHaveLength(3)
  })

  it("returns one line per benchmark key ending with _ops suffix", () => {
    const lines = perBenchLines(trendData, "ops")
    expect(lines).toHaveLength(3)
    // dataKey should end with _ops
    expect(lines[0]!.dataKey).toMatch(/_ops$/)
  })

  it("returns one line per benchmark key ending with _p95 suffix", () => {
    const lines = perBenchLines(trendData, "p95")
    expect(lines).toHaveLength(3)
    expect(lines[0]!.dataKey).toMatch(/_p95$/)
  })

  it("extracts prettyName from type::label format using BENCHMARK_TYPE_LABELS", () => {
    const lines = perBenchLines(trendData, "mean")

    // geo::haversine_100 → "Modelo CPU (Haversine + PostGIS): haversine 100"
    expect(lines[0]!.name).toBe(`${BENCHMARK_TYPE_LABELS.geo}: haversine 100`)

    // cache::cache_get → "Cache Performance: cache get"
    expect(lines[2]!.name).toBe(`${BENCHMARK_TYPE_LABELS.cache}: cache get`)
  })

  it("falls back to type name when label is missing (no :: separator)", () => {
    const withoutLabel = [
      {
        date: "15/01/2026",
        geo_mean: 50, // type-only key (no ::)
      },
    ]

    const lines = perBenchLines(withoutLabel, "mean")
    expect(lines).toHaveLength(1)
    expect(lines[0]!.dataKey).toBe("geo_mean")
    expect(lines[0]!.name).toBe(BENCHMARK_TYPE_LABELS.geo)
  })

  it("falls back to raw type key when unknown type is passed", () => {
    const unknownType = [
      {
        date: "15/01/2026",
        "unknown_type::bench_mean": 100,
      },
    ]

    const lines = perBenchLines(unknownType, "mean")
    expect(lines).toHaveLength(1)
    expect(lines[0]!.name).toBe("unknown_type: bench")
  })

  it("wraps color palette when more than 8 lines exist", () => {
    const manyLines: Array<Record<string, number | string>> = [
      {
        date: "15/01/2026",
      },
    ]
    // Add 10 benchmark keys — palette only has 8 colors
    for (let i = 0; i < 10; i++) {
      manyLines[0]![`type_${i}::bench_${i}_mean`] = i * 10
    }

    const lines = perBenchLines(manyLines, "mean")
    expect(lines).toHaveLength(10)

    // First 8 colors should be unique modulo palette length
    // Color for index 8 should equal color for index 0 (modulo 8)
    expect(lines[8]!.color).toBe(lines[0]!.color)
    expect(lines[9]!.color).toBe(lines[1]!.color)
  })
})
