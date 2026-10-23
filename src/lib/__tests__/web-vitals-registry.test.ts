import { describe, it, expect, beforeEach } from "vitest"
import { webVitalsRegistry } from "../web-vitals-registry"

describe("webVitalsRegistry", () => {
  beforeEach(() => {
    webVitalsRegistry.reset()
  })

  it("records metrics and calculates percentiles correctly", () => {
    // Record TTFB samples: 50, 100, 150, 200, 250
    const values = [50, 100, 150, 200, 250]
    for (const val of values) {
      webVitalsRegistry.record({
        name: "TTFB",
        value: val,
      })
    }

    const summary = webVitalsRegistry.getSummary()
    const ttfb = summary.metrics.TTFB

    expect(ttfb.count).toBe(5)
    expect(ttfb.min).toBe(50)
    expect(ttfb.max).toBe(250)
    expect(ttfb.avg).toBe(150)
    expect(ttfb.p50).toBe(150)
    expect(ttfb.status).toBe("OPTIMAL")
    expect(ttfb.ratings.good).toBe(5)
    expect(ttfb.ratings.goodPercent).toBe(100)
  })

  it("correctly identifies NEEDS_IMPROVEMENT and POOR ratings based on Google thresholds", () => {
    // LCP threshold: good <= 2500, needsImprovement <= 4000
    webVitalsRegistry.record({ name: "LCP", value: 1200 }) // good
    webVitalsRegistry.record({ name: "LCP", value: 3200 }) // needs-improvement
    webVitalsRegistry.record({ name: "LCP", value: 5000 }) // poor

    const summary = webVitalsRegistry.getSummary()
    const lcp = summary.metrics.LCP

    expect(lcp.count).toBe(3)
    expect(lcp.ratings.good).toBe(1)
    expect(lcp.ratings.needsImprovement).toBe(1)
    expect(lcp.ratings.poor).toBe(1)
    // p75 of [1200, 3200, 5000] is 4100 -> > 4000 -> POOR
    expect(lcp.status).toBe("POOR")
  })

  it("handles empty metrics with INSUFFICIENT_DATA status", () => {
    const summary = webVitalsRegistry.getSummary()
    expect(summary.totalSamples).toBe(0)
    expect(summary.complianceScore).toBe(100)
    expect(summary.metrics.CLS.status).toBe("INSUFFICIENT_DATA")
    expect(summary.metrics.CLS.count).toBe(0)
  })

  it("ignores unknown metric names or invalid values", () => {
    webVitalsRegistry.record({ name: "UNKNOWN_METRIC", value: 100 })
    webVitalsRegistry.record({ name: "CLS", value: Number.NaN })

    const summary = webVitalsRegistry.getSummary()
    expect(summary.totalSamples).toBe(0)
  })

  it("resets metrics buffer on reset()", () => {
    webVitalsRegistry.record({ name: "FCP", value: 900 })
    expect(webVitalsRegistry.getSummary().totalSamples).toBe(1)

    webVitalsRegistry.reset()
    expect(webVitalsRegistry.getSummary().totalSamples).toBe(0)
  })
})
