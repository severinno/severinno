/**
 * geo-auto-baseline.test.ts
 *
 * Unit tests for geo-auto-baseline.ts.
 *
 * Tests cover getServiceBaseline() and getBaselineDiagnostics().
 * computeGeoBaselines() is already tested via geo-integration-realtime.test.ts.
 *
 * Mocks:
 *   - ./geo-metrics-persist → loadPersistedSnapshots returns [] (no history)
 *   - ./logger              → no-op
 *   - server-only           → required by vitest
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}))

vi.mock("../logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("../geo-metrics-persist", () => ({
  loadPersistedSnapshots: vi.fn(() => []),
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { getServiceBaseline, getBaselineDiagnostics } from "../geo-auto-baseline"

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════
// getServiceBaseline
// ═══════════════════════════════════════════════════════════════════════════

describe("getServiceBaseline", () => {
  it("returns fallback baseline for nominatim when no history exists", () => {
    const result = getServiceBaseline("nominatim")

    expect(result.service).toBe("nominatim")
    expect(result.p95Baseline).toBe(400)
    expect(result.source).toBe("fallback")
    expect(result.threshold).toBe(800) // 2x baseline
    expect(result.sampleCount).toBe(0)
  })

  it("returns fallback baseline for viacep when no history exists", () => {
    const result = getServiceBaseline("viacep")

    expect(result.service).toBe("viacep")
    expect(result.p95Baseline).toBe(250)
    expect(result.source).toBe("fallback")
    expect(result.threshold).toBe(500)
    expect(result.sampleCount).toBe(0)
  })

  it("returns fallback baseline for postgis when no history exists", () => {
    const result = getServiceBaseline("postgis")

    expect(result.service).toBe("postgis")
    expect(result.p95Baseline).toBe(30)
    expect(result.source).toBe("fallback")
    expect(result.threshold).toBe(60)
  })

  it("returns different baselines for different services", () => {
    const nom = getServiceBaseline("nominatim")
    const pg = getServiceBaseline("postgis")
    expect(nom.p95Baseline).not.toBe(pg.p95Baseline)
    expect(nom.threshold).not.toBe(pg.threshold)
  })

  it("accepts custom lookbackMs parameter", () => {
    // The lookback parameter is passed to computeGeoBaselines,
    // which then passes it to loadPersistedSnapshots. With our
    // mock returning [], the result is still fallback.
    const result = getServiceBaseline("viacep", 3600_000) // 1h lookback
    expect(result.service).toBe("viacep")
    expect(result.source).toBe("fallback")
  })

  it("returns ServiceBaseline type with all required fields", () => {
    const result = getServiceBaseline("nominatim")

    expect(result).toHaveProperty("service")
    expect(result).toHaveProperty("p95Baseline")
    expect(result).toHaveProperty("sampleCount")
    expect(result).toHaveProperty("source")
    expect(result).toHaveProperty("threshold")

    expect(["historical", "fallback"]).toContain(result.source)
    expect(typeof result.p95Baseline).toBe("number")
    expect(typeof result.sampleCount).toBe("number")
    expect(typeof result.threshold).toBe("number")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// getBaselineDiagnostics
// ═══════════════════════════════════════════════════════════════════════════

describe("getBaselineDiagnostics", () => {
  it("returns fallbackBaselines with correct defaults", () => {
    const diag = getBaselineDiagnostics()

    expect(diag.fallbackBaselines.nominatim).toBe(400)
    expect(diag.fallbackBaselines.viacep).toBe(250)
    expect(diag.fallbackBaselines.postgis).toBe(30)
  })

  it("returns lookbackHours as 24", () => {
    const diag = getBaselineDiagnostics()
    expect(diag.lookbackHours).toBe(24)
  })

  it("returns currentBaselines with 3 services (all fallback)", () => {
    const diag = getBaselineDiagnostics()

    expect(diag.currentBaselines).toHaveLength(3)
    expect(diag.currentBaselines.map((b) => b.service)).toEqual(["nominatim", "viacep", "postgis"])

    for (const b of diag.currentBaselines) {
      expect(b.source).toBe("fallback")
    }
  })

  it("returns immutable copies (not references to internal state)", () => {
    const diag = getBaselineDiagnostics()
    // Mutate the returned object
    diag.fallbackBaselines.nominatim = 999
    diag.currentBaselines[0]!.p95Baseline = 999

    // Call again — should still have original values
    const diag2 = getBaselineDiagnostics()
    expect(diag2.fallbackBaselines.nominatim).toBe(400)
    expect(diag2.currentBaselines[0]!.p95Baseline).toBe(400)
  })
})
