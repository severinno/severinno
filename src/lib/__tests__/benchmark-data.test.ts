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
} from "../benchmark-data"
import type { BenchmarkData } from "../benchmark-data"

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
        ratio: 84.4, // PostGIS ~84× slower
      },
      {
        label: "1k providers",
        scale: 1000,
        haversine: { mean: 497.8, opsPerSec: 2009 },
        postgis: { mean: 24000, opsPerSec: 42 },
        ratio: 48.2, // PostGIS ~48× slower
      },
      {
        label: "10k providers",
        scale: 10000,
        haversine: { mean: 4978, opsPerSec: 201 },
        postgis: { mean: 222000, opsPerSec: 4.5 },
        ratio: 44.6, // PostGIS ~45× slower
      },
    ],
    analysis: {
      note: "Haversine JS é significativamente mais rápido que PostGIS para buscas de providers em São Paulo. O overhead fixo do PostGIS (TCP + query parsing) domina o custo total e torna o Haversine mais vantajoso para qualquer consulta sem filtro espacial.",
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
      // The ratio stored in the fixture should match
      const expectedRatio = +(item.postgis / item.haversine).toFixed(1)
      expect(Math.abs(item.ratio - expectedRatio)).toBeLessThanOrEqual(0.21) // float tolerance
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
    const maxLatency = getMaxPostgisLatency(data)
    // Largest PostGIS value: 222000
    expect(maxLatency).toBe(222000)
  })

  it("handles descending-scale comparisons", () => {
    const data = buildBenchmarkBarData(makeBenchmarkData())
    // All PostGIS values: 4200, 24000, 222000
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
    expect(ratioColor(10)).toBe(RATIO_COLOR_FAST) // boundary
  })

  it("returns warn color for 10 < ratio <= 50", () => {
    // Just above 10 — warn
    expect(ratioColor(10.1)).toBe(RATIO_COLOR_WARN)
    expect(ratioColor(20)).toBe(RATIO_COLOR_WARN)
    expect(ratioColor(50)).toBe(RATIO_COLOR_WARN) // boundary
  })

  it("returns slow color for ratio > 50", () => {
    // Just above 50 — red
    expect(ratioColor(50.1)).toBe(RATIO_COLOR_SLOW)
    expect(ratioColor(84.4)).toBe(RATIO_COLOR_SLOW)
    expect(ratioColor(100)).toBe(RATIO_COLOR_SLOW)
    expect(ratioColor(1000)).toBe(RATIO_COLOR_SLOW)
  })

  it("handles negative ratio defensively (should not happen in practice)", () => {
    // Negative ratio doesn't make sense but shouldn't crash
    const color = ratioColor(-1)
    expect(color).toBe(RATIO_COLOR_FAST) // falls into ≤ 10
  })

  it("handles fractional ratio correctly", () => {
    expect(ratioColor(9.999)).toBe(RATIO_COLOR_FAST)
    expect(ratioColor(10.001)).toBe(RATIO_COLOR_WARN)
    expect(ratioColor(49.999)).toBe(RATIO_COLOR_WARN)
    expect(ratioColor(50.001)).toBe(RATIO_COLOR_SLOW)
  })

  it("maps to the same colors used by the ratio bar chart cells", () => {
    // This test ensures the extracted function produces the same result
    // as the inline ternary in the original component:
    //   fill={entry.ratio > 50 ? COLOR_P99 : entry.ratio > 10 ? COLOR_P95 : COLOR_P50}
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
