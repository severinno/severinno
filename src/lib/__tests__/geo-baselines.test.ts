/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * geo-baselines.test.ts
 *
 * Tests for geo-baselines.ts.
 *
 * The module reads process.env at import time, so each test sets the
 * relevant env vars BEFORE importing the module via dynamic import().
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Helper: reset env for each test ──────────────────────────────────────

const ENV_KEYS = [
  "GEO_P95_BASELINE_NOMINATIM",
  "GEO_P95_BASELINE_VIACEP",
  "GEO_P95_BASELINE_POSTGIS",
]

beforeEach(() => {
  vi.resetModules()
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
})

// ═════════════════════════════════════════════════════════════════════════
// Default values (no env vars set)
// ═════════════════════════════════════════════════════════════════════════

describe("P95_BASELINE_MS — defaults", () => {
  it("uses hardcoded fallback for nominatim when env is not set", async () => {
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    expect(P95_BASELINE_MS.nominatim).toBe(400)
  })

  it("uses hardcoded fallback for viacep when env is not set", async () => {
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    expect(P95_BASELINE_MS.viacep).toBe(250)
  })

  it("uses hardcoded fallback for postgis when env is not set", async () => {
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    expect(P95_BASELINE_MS.postgis).toBe(30)
  })

  it("all three services are present in the record", async () => {
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    expect(Object.keys(P95_BASELINE_MS)).toEqual(["nominatim", "viacep", "postgis"])
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Env var override
// ═════════════════════════════════════════════════════════════════════════

describe("P95_BASELINE_MS — env var override", () => {
  it("reads GEO_P95_BASELINE_NOMINATIM from env", async () => {
    process.env.GEO_P95_BASELINE_NOMINATIM = "500"
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    expect(P95_BASELINE_MS.nominatim).toBe(500)
  })

  it("reads GEO_P95_BASELINE_VIACEP from env", async () => {
    process.env.GEO_P95_BASELINE_VIACEP = "300"
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    expect(P95_BASELINE_MS.viacep).toBe(300)
  })

  it("reads GEO_P95_BASELINE_POSTGIS from env", async () => {
    process.env.GEO_P95_BASELINE_POSTGIS = "50"
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    expect(P95_BASELINE_MS.postgis).toBe(50)
  })

  it("falls back to default when env var is empty string", async () => {
    process.env.GEO_P95_BASELINE_NOMINATIM = ""
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    expect(P95_BASELINE_MS.nominatim).toBe(400)
  })

  it("falls back to default when env var is invalid string", async () => {
    process.env.GEO_P95_BASELINE_VIACEP = "abc"
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    expect(P95_BASELINE_MS.viacep).toBe(250)
  })

  it("overrides all three simultaneously", async () => {
    process.env.GEO_P95_BASELINE_NOMINATIM = "600"
    process.env.GEO_P95_BASELINE_VIACEP = "350"
    process.env.GEO_P95_BASELINE_POSTGIS = "45"
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    expect(P95_BASELINE_MS.nominatim).toBe(600)
    expect(P95_BASELINE_MS.viacep).toBe(350)
    expect(P95_BASELINE_MS.postgis).toBe(45)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Edge cases — env var boundary values
// ═════════════════════════════════════════════════════════════════════════

describe("P95_BASELINE_MS — edge cases", () => {
  it("treats env var '0' as falsy and falls back to default", async () => {
    process.env.GEO_P95_BASELINE_NOMINATIM = "0"
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    // Number("0") is 0, which is falsy → falls back to 400
    expect(P95_BASELINE_MS.nominatim).toBe(400)
  })

  it("accepts negative env var values", async () => {
    process.env.GEO_P95_BASELINE_VIACEP = "-50"
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    // Number("-50") is -50, which is truthy → uses -50
    expect(P95_BASELINE_MS.viacep).toBe(-50)
  })

  it("trims whitespace around env var value", async () => {
    process.env.GEO_P95_BASELINE_POSTGIS = "  45  "
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    // Number() trims whitespace: Number("  45  ") → 45
    expect(P95_BASELINE_MS.postgis).toBe(45)
  })

  it("falls back to default when env var is the string 'NaN'", async () => {
    process.env.GEO_P95_BASELINE_NOMINATIM = "NaN"
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    // Number("NaN") is NaN, which is falsy → falls back to 400
    expect(P95_BASELINE_MS.nominatim).toBe(400)
  })

  it("accepts float values from env var", async () => {
    process.env.GEO_P95_BASELINE_VIACEP = "275.5"
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    expect(P95_BASELINE_MS.viacep).toBe(275.5)
  })

  it("accepts very large env var values", async () => {
    process.env.GEO_P95_BASELINE_POSTGIS = "9999"
    const { P95_BASELINE_MS } = await import("../geo-baselines")
    expect(P95_BASELINE_MS.postgis).toBe(9999)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// getP95Baselines
// ═════════════════════════════════════════════════════════════════════════

describe("getP95Baselines", () => {
  it("returns a copy of P95_BASELINE_MS (not the same reference)", async () => {
    const { getP95Baselines, P95_BASELINE_MS } = await import("../geo-baselines")
    const result = getP95Baselines()
    expect(result).toEqual(P95_BASELINE_MS)
    expect(result).not.toBe(P95_BASELINE_MS) // different reference
  })

  it("mutation of returned object does not affect original", async () => {
    const { getP95Baselines, P95_BASELINE_MS } = await import("../geo-baselines")
    const result = getP95Baselines()
    result.nominatim = 999
    expect(P95_BASELINE_MS.nominatim).toBe(400) // unchanged
  })

  it("returns all three services", async () => {
    const { getP95Baselines } = await import("../geo-baselines")
    const result = getP95Baselines()
    expect(Object.keys(result)).toEqual(["nominatim", "viacep", "postgis"])
  })
})
