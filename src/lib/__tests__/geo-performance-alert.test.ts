/**
 * geo-performance-alert.test.ts
 *
 * Unit tests for checkGeoPerformance() — the P95 alert system.
 *
 * Tests cover:
 *   1. Normal: P95 below threshold → no degradation
 *   2. Degradation: P95 above threshold for 2 consecutive checks → alert sent
 *   3. Debounce: alerts within 15min window don't re-trigger
 *   4. Recovery: after degradation, P95 below threshold → recovery sent
 *   5. No baseline: fallback to generous 2s threshold when no baseline
 *   6. Multiple services: each service tracked independently
 *   7. Error severity: severe (>1.5× threshold) triggers "error"
 *   8. Missing service metrics → returns empty result
 *
 * Mocks:
 *   - @/lib/geo-metrics       → factory: vi.fn() for getGeoMetrics
 *   - ./geo-auto-baseline     → factory: vi.fn() for computeGeoBaselines
 *   - @/lib/geo-alert-notify  → factory: vi.fn() for notifyGeoAlert
 *   - @/lib/logger            → factory: vi.fn() stubs
 *
 * Each vi.mock factory uses vi.fn() directly (globals: true) so the
 * mocks can be controlled via vi.mocked() in test blocks.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// vi.mock (hoisted before static imports)
// ---------------------------------------------------------------------------

vi.mock("@/lib/geo-metrics", () => ({
  getGeoMetrics: vi.fn(),
}))

vi.mock("@/lib/geo-auto-baseline", () => ({
  computeGeoBaselines: vi.fn(),
}))

vi.mock("@/lib/geo-alert-notify", () => ({
  notifyGeoAlert: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/logger", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return { default: mockLogger }
})

// ---------------------------------------------------------------------------
// Static imports (after mocks)
// ---------------------------------------------------------------------------

import { getGeoMetrics } from "@/lib/geo-metrics"
import { computeGeoBaselines } from "@/lib/geo-auto-baseline"
import { notifyGeoAlert } from "@/lib/geo-alert-notify"
import { checkGeoPerformance, resetPerformanceAlertState } from "../geo-performance-alert"

// ---------------------------------------------------------------------------
// Typed mock access — the vi.mock factories return vi.fn(), so each imported
// function IS already a vi.fn() with .mockReturnValue etc.
// ---------------------------------------------------------------------------

function mockGM() {
  return getGeoMetrics as unknown as ReturnType<typeof vi.fn>
}
function mockCB() {
  return computeGeoBaselines as unknown as ReturnType<typeof vi.fn>
}
function mockNA() {
  return notifyGeoAlert as unknown as ReturnType<typeof vi.fn>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a getGeoMetrics return value with the given P95 per service. */
function makeGeoMetrics(p95Values: Record<string, number>, counts?: Record<string, number>) {
  const services: Record<
    string,
    {
      p95: number
      count: number
      p50: number
      p99: number
      errorRate: number
      lastSampleAt: number | null
      errorCount: number
    }
  > = {}
  for (const [key, p95] of Object.entries(p95Values)) {
    services[key] = {
      p95,
      p50: Math.round(p95 * 0.5),
      p99: Math.round(p95 * 2),
      count: counts?.[key] ?? 100,
      errorRate: 0,
      lastSampleAt: Date.now(),
      errorCount: 0,
    }
  }
  return { services, timestamp: Date.now(), windowSeconds: 900 }
}

/** Full set of historical baselines (source = "historical"). */
function makeBaselines() {
  return [
    {
      service: "nominatim" as const,
      p95Baseline: 400,
      sampleCount: 100,
      source: "historical" as const,
      threshold: 800,
    },
    {
      service: "viacep" as const,
      p95Baseline: 250,
      sampleCount: 100,
      source: "historical" as const,
      threshold: 500,
    },
    {
      service: "postgis" as const,
      p95Baseline: 30,
      sampleCount: 100,
      source: "historical" as const,
      threshold: 60,
    },
  ]
}

/** Fallback baselines (source = "fallback"). */
function makeFallbackBaselines() {
  return [
    {
      service: "nominatim" as const,
      p95Baseline: 400,
      sampleCount: 0,
      source: "fallback" as const,
      threshold: 800,
    },
    {
      service: "viacep" as const,
      p95Baseline: 250,
      sampleCount: 0,
      source: "fallback" as const,
      threshold: 500,
    },
    {
      service: "postgis" as const,
      p95Baseline: 30,
      sampleCount: 0,
      source: "fallback" as const,
      threshold: 60,
    },
  ]
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  resetPerformanceAlertState()
  // Default: all services healthy
  mockGM().mockReturnValue(makeGeoMetrics({ nominatim: 100, viacep: 50, postgis: 10 }))
  mockCB().mockReturnValue(makeBaselines())
})

// ===========================================================================
// Tests
// ===========================================================================

describe("checkGeoPerformance", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 1. Normal — P95 below threshold
  // ═══════════════════════════════════════════════════════════════════════

  it("returns not degraded when P95 is below 2x baseline", async () => {
    // Default from beforeEach: P95 values are below thresholds
    const results = await checkGeoPerformance()

    expect(results).toHaveLength(3)
    for (const r of results) {
      expect(r.degraded).toBe(false)
      expect(r.alerted).toBe(false)
      expect(r.recovered).toBe(false)
    }
    expect(mockNA()).not.toHaveBeenCalled()
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Degradation — P95 above threshold for 2 consecutive checks
  // ═══════════════════════════════════════════════════════════════════════

  it("alerts after 2 consecutive violations (CONSECUTIVE_THRESHOLD)", async () => {
    mockGM().mockReturnValue(makeGeoMetrics({ nominatim: 900, viacep: 50, postgis: 10 }))
    mockCB().mockReturnValue(makeBaselines())

    // First call: 1st violation (degraded=true, alerted=false)
    const r1 = await checkGeoPerformance()
    const nom1 = r1.find((r) => r.p95 === 900)!
    expect(nom1.degraded).toBe(true)
    expect(nom1.alerted).toBe(false)
    expect(nom1.consecutiveViolations).toBe(1)

    // Second call: 2nd violation → should alert
    const r2 = await checkGeoPerformance()
    const nom2 = r2.find((r) => r.p95 === 900)!
    expect(nom2.degraded).toBe(true)
    expect(nom2.alerted).toBe(true)
    expect(nom2.consecutiveViolations).toBe(2)

    // Verify alert was sent via notifyGeoAlert
    expect(mockNA()).toHaveBeenCalledTimes(1)
    const alertCall = mockNA().mock.calls[0][0]
    expect(alertCall.title).toContain("900ms")
    expect(alertCall.tag).toBe("geo-perf:nominatim:degraded")
    expect(alertCall.severity).toBe("warning")
    expect(alertCall.context.service).toBe("nominatim")
    expect(alertCall.context.value).toBe(900)
    expect(alertCall.context.threshold).toBe(800)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Debounce — alerts within 15min don't re-trigger
  // ═══════════════════════════════════════════════════════════════════════

  it("does not re-alert within debounce window (15 min)", async () => {
    mockGM().mockReturnValue(makeGeoMetrics({ nominatim: 900, viacep: 50, postgis: 10 }))
    mockCB().mockReturnValue(makeBaselines())

    // Call 1-2: trigger alert (2 consecutive violations)
    await checkGeoPerformance() // 1st violation
    await checkGeoPerformance() // 2nd violation → alert sent
    expect(mockNA()).toHaveBeenCalledTimes(1)

    // Call 3-4: still degraded but within debounce → no re-alert
    mockNA().mockClear()
    const r3 = await checkGeoPerformance()
    expect(r3.find((r) => r.p95 === 900)!.alerted).toBe(false)
    expect(mockNA()).not.toHaveBeenCalled()

    const r4 = await checkGeoPerformance()
    expect(r4.find((r) => r.p95 === 900)!.alerted).toBe(false)
    expect(mockNA()).not.toHaveBeenCalled()
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Recovery — P95 returns below threshold
  // ═══════════════════════════════════════════════════════════════════════

  it("sends recovery notification when P95 drops back below threshold", async () => {
    // Start degraded
    mockGM().mockReturnValue(makeGeoMetrics({ nominatim: 900, viacep: 50, postgis: 10 }))
    mockCB().mockReturnValue(makeBaselines())

    // Trigger alert (2 violations)
    await checkGeoPerformance()
    await checkGeoPerformance()
    expect(mockNA()).toHaveBeenCalledTimes(1)

    // Now P95 drops below threshold
    mockGM().mockReturnValue(makeGeoMetrics({ nominatim: 200, viacep: 50, postgis: 10 }))

    // Recovery should happen
    const result = await checkGeoPerformance()
    const nomResult = result.find((r) => r.p95 === 200)!
    expect(nomResult.degraded).toBe(false)
    expect(nomResult.recovered).toBe(true)
    expect(nomResult.consecutiveViolations).toBe(0)

    // Recovery notification should be sent
    expect(mockNA()).toHaveBeenCalledTimes(2)
    const recoveryCall = mockNA().mock.calls[1][0]
    expect(recoveryCall.tag).toBe("geo-perf:nominatim:recovery")
    expect(recoveryCall.severity).toBe("info")
    expect(recoveryCall.context.value).toBe(200)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 5. No baseline — fallback to generous 2s threshold
  // ═══════════════════════════════════════════════════════════════════════

  it("uses generous 2s threshold when no baseline is available", async () => {
    mockGM().mockReturnValue(makeGeoMetrics({ nominatim: 1500, viacep: 800, postgis: 50 }))
    // source = "fallback" → code falls through to generous 2s default
    // (or PostGIS benchmark file if it exists on disk)
    mockCB().mockReturnValue(makeFallbackBaselines())

    const results = await checkGeoPerformance()

    // Nominatim: 1500 < 2000 → not degraded (generous 2s threshold)
    const nom = results.find((r) => r.p95 === 1500)!
    expect(nom.degraded).toBe(false)
    expect(nom.threshold).toBe(2000)
    expect(nom.baselineSource).toBeNull()

    // ViaCEP: 800 < 2000 → not degraded
    const via = results.find((r) => r.p95 === 800)!
    expect(via.degraded).toBe(false)
    expect(via.threshold).toBe(2000)

    // PostGIS: may use benchmark file if it exists on disk.
    // Check only that it's not degraded.
    const pg = results.find((r) => r.p95 === 50)!
    expect(pg.degraded).toBe(false)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Multiple services — independent tracking
  // ═══════════════════════════════════════════════════════════════════════

  it("tracks violations independently per service", async () => {
    mockGM().mockReturnValue(makeGeoMetrics({ nominatim: 900, viacep: 500, postgis: 10 }))
    mockCB().mockReturnValue(makeBaselines())

    // First call: all services evaluated
    const r1 = await checkGeoPerformance()
    // Nominatim: 900 > 800 → degraded
    expect(r1.find((r) => r.p95 === 900)!.degraded).toBe(true)
    // ViaCEP: 500 == 500 → NOT >, so not degraded
    expect(r1.find((r) => r.p95 === 500)!.degraded).toBe(false)
    // PostGIS: 10 < 60 → not degraded
    expect(r1.find((r) => r.p95 === 10)!.degraded).toBe(false)

    // Second call: Nominatim alerts (second violation)
    const r2 = await checkGeoPerformance()
    expect(r2.find((r) => r.p95 === 900)!.alerted).toBe(true)
    expect(mockNA()).toHaveBeenCalledTimes(1)
    expect(mockNA().mock.calls[0][0].tag).toBe("geo-perf:nominatim:degraded")
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Error severity — P95 exceeds 1.5× threshold → "error"
  // ═══════════════════════════════════════════════════════════════════════

  it("uses 'error' severity when P95 exceeds 1.5x threshold", async () => {
    // P95=1500, threshold=800 → 1500 > 1200 (800×1.5) → "error"
    mockGM().mockReturnValue(makeGeoMetrics({ nominatim: 1500, viacep: 50, postgis: 10 }))
    mockCB().mockReturnValue(makeBaselines())

    // Trigger alert
    await checkGeoPerformance()
    await checkGeoPerformance()

    expect(mockNA()).toHaveBeenCalledTimes(1)
    const alertCall = mockNA().mock.calls[0][0]
    expect(alertCall.severity).toBe("error")
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 9. Edge case — P95 exactly equal to threshold (not degraded)
  // ═══════════════════════════════════════════════════════════════════════

  it("returns not degraded when P95 equals threshold exactly (>= vs >)", async () => {
    // ViaCEP threshold is 500 (2 × 250).  P95 === threshold exactly.
    // The guard uses strict `p95 > threshold`, not `p95 >= threshold`,
    // so equality must NOT trigger degradation.
    mockGM().mockReturnValue(makeGeoMetrics({ nominatim: 100, viacep: 500, postgis: 10 }))
    mockCB().mockReturnValue(makeBaselines())

    const results = await checkGeoPerformance()

    const via = results.find((r) => r.p95 === 500)!
    expect(via.p95).toBe(500)
    expect(via.threshold).toBe(500)
    // Strict >, not >= → P95 equal to threshold is NOT degraded
    expect(via.degraded).toBe(false)
    expect(via.alerted).toBe(false)
    expect(via.recovered).toBe(false)
    expect(mockNA()).not.toHaveBeenCalled()

    // Confirm other services still work as expected
    expect(results.find((r) => r.p95 === 100)!.degraded).toBe(false)
    expect(results.find((r) => r.p95 === 10)!.degraded).toBe(false)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Missing service metrics — returns empty result
  // ═══════════════════════════════════════════════════════════════════════

  it("returns empty result when service has no metrics", async () => {
    mockGM().mockReturnValue({
      services: {},
      timestamp: Date.now(),
      windowSeconds: 900,
    })
    mockCB().mockReturnValue(makeFallbackBaselines())

    const results = await checkGeoPerformance(["nominatim"])

    expect(results).toHaveLength(1)
    expect(results[0].p95).toBe(0)
    expect(results[0].threshold).toBe(0)
    expect(results[0].baselineSource).toBeNull()
    expect(results[0].degraded).toBe(false)
    expect(results[0].alerted).toBe(false)
  })
})
