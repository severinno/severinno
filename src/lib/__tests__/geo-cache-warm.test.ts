/**
 * geo-cache-warm.test.ts
 *
 * Tests for geo-cache-warm.ts.
 *
 * Tests cover getWarmConfig() and warmGeoCache() with mocked geo services.
 *
 * Mocks:
 *   - server-only         → required by vitest
 *   - ./logger            → no-op
 *   - ./redis             → cacheGet always returns null (miss) unless overridden
 *   - ./geo               → geocodeSearch, geocodeCEP, reverseGeocode
 *   - ./nominatim-rate-limit → passthrough
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock factories (no vi.hoisted needed — these don't close over test vars)
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}))

vi.mock("../logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("../nominatim-rate-limit", () => ({
  rateLimitedNominatim: <T>(fn: () => Promise<T>) => fn(),
}))

// ---------------------------------------------------------------------------
// Redis and Geo mocks — use vi.hoisted for mutable mock functions
// ---------------------------------------------------------------------------

const mockCacheGet = vi.hoisted(() => vi.fn<(_key: string) => Promise<unknown>>())

vi.mock("../redis", () => ({
  cacheGet: (key: string) => mockCacheGet(key),
}))

const mockGeocodeSearch = vi.hoisted(() => vi.fn<() => Promise<unknown[]>>())
const mockGeocodeCEP = vi.hoisted(() => vi.fn<() => Promise<unknown>>())
const mockReverseGeocode = vi.hoisted(() => vi.fn<() => Promise<unknown>>())

vi.mock("../geo", () => ({
  geocodeSearch: () => mockGeocodeSearch(),
  geocodeCEP: () => mockGeocodeCEP(),
  reverseGeocode: () => mockReverseGeocode(),
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { getWarmConfig, warmGeoCache } from "../geo-cache-warm"

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockCacheGet.mockResolvedValue(null) // default: cache miss
  mockGeocodeSearch.mockResolvedValue([])
  mockGeocodeCEP.mockResolvedValue({ cep: "00000000", street: "", city: "", state: "" })
  mockReverseGeocode.mockResolvedValue({ displayName: "test" })
})

// ═══════════════════════════════════════════════════════════════════════════
// getWarmConfig
// ═══════════════════════════════════════════════════════════════════════════

describe("getWarmConfig", () => {
  it("returns correct city count", () => {
    const config = getWarmConfig()
    expect(config.cities).toBeGreaterThan(0)
    expect(config.cities).toBe(25)
  })

  it("returns correct CEP count", () => {
    const config = getWarmConfig()
    expect(config.ceps).toBe(15)
  })

  it("returns correct coordinate count", () => {
    const config = getWarmConfig()
    expect(config.coords).toBe(8)
  })

  it("totalQueries is sum of all three", () => {
    const config = getWarmConfig()
    expect(config.totalQueries).toBe(config.cities + config.ceps + config.coords)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// warmGeoCache — all cache misses
// ═══════════════════════════════════════════════════════════════════════════

describe("warmGeoCache — all cache misses", () => {
  it("calls geocodeSearch for each city", async () => {
    const result = await warmGeoCache()
    expect(mockGeocodeSearch).toHaveBeenCalledTimes(25)
    expect(result.searches).toBe(25)
    expect(result.skipped).toBe(0)
    expect(result.errors).toBe(0)
    expect(result.total).toBe(25 + 15 + 8)
  })

  it("calls geocodeCEP for each CEP", async () => {
    const result = await warmGeoCache()
    expect(mockGeocodeCEP).toHaveBeenCalledTimes(15)
    expect(result.ceps).toBe(15)
  })

  it("calls reverseGeocode for each coordinate", async () => {
    const result = await warmGeoCache()
    expect(mockReverseGeocode).toHaveBeenCalledTimes(8)
    expect(result.reverses).toBe(8)
  })

  it("elapsedMs is a non-negative number", async () => {
    const result = await warmGeoCache()
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// warmGeoCache — cache hits skip warming
// ═══════════════════════════════════════════════════════════════════════════

describe("warmGeoCache — cache hits skip warming", () => {
  it("skips cached city searches", async () => {
    // Mock cacheGet to return a value when called with "geo:search:são paulo, sp:5"
    mockCacheGet.mockImplementation(async (key: string) => {
      if (key.includes("são paulo, sp:5")) return [{ lat: -23.55 }]
      return null
    })

    const result = await warmGeoCache()
    expect(result.skipped).toBeGreaterThanOrEqual(1)
    expect(result.searches).toBe(24)
  })

  it("skips cached CEP lookups", async () => {
    mockCacheGet.mockImplementation(async (key: string) => {
      if (key === "geo:cep:01310100") return { cep: "01310100" }
      return null
    })

    const result = await warmGeoCache()
    expect(result.skipped).toBeGreaterThanOrEqual(1)
    expect(result.ceps).toBe(14)
  })

  it("skips cached reverse geocodes", async () => {
    mockCacheGet.mockImplementation(async (key: string) => {
      if (key.includes("-23.5505")) return { displayName: "SP" }
      return null
    })

    const result = await warmGeoCache()
    expect(result.skipped).toBeGreaterThanOrEqual(1)
    expect(result.reverses).toBe(7)
  })

  it("all cached returns total=0", async () => {
    mockCacheGet.mockResolvedValue({ dummy: true })
    const result = await warmGeoCache()
    expect(result.searches).toBe(0)
    expect(result.ceps).toBe(0)
    expect(result.reverses).toBe(0)
    expect(result.total).toBe(0)
    expect(result.skipped).toBe(25 + 15 + 8)
    expect(result.errors).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// warmGeoCache — error tolerances
// ═══════════════════════════════════════════════════════════════════════════

describe("warmGeoCache — error tolerance", () => {
  it("continues when geocodeSearch throws", async () => {
    let callCount = 0
    mockGeocodeSearch.mockImplementation(async () => {
      callCount++
      if (callCount === 1) throw new Error("rate limited")
      return []
    })
    const result = await warmGeoCache()
    expect(mockGeocodeSearch).toHaveBeenCalledTimes(25)
    expect(result.errors).toBe(1)
    expect(result.searches).toBe(24)
  })

  it("continues when geocodeCEP throws", async () => {
    mockGeocodeCEP.mockRejectedValueOnce(new Error("timeout"))
    const result = await warmGeoCache()
    expect(mockGeocodeCEP).toHaveBeenCalledTimes(15)
    expect(result.errors).toBe(1)
    expect(result.ceps).toBe(14)
  })

  it("continues when reverseGeocode throws", async () => {
    mockReverseGeocode.mockRejectedValueOnce(new Error("fail"))
    const result = await warmGeoCache()
    expect(mockReverseGeocode).toHaveBeenCalledTimes(8)
    expect(result.errors).toBe(1)
    expect(result.reverses).toBe(7)
  })

  it("tolerates multiple failures across services", async () => {
    mockGeocodeSearch.mockRejectedValueOnce(new Error("e1")).mockRejectedValueOnce(new Error("e2"))
    mockGeocodeCEP.mockRejectedValue(new Error("cep err"))
    mockReverseGeocode.mockRejectedValue(new Error("rev err"))
    const result = await warmGeoCache()
    expect(result.errors).toBeGreaterThanOrEqual(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// warmGeoCache — cacheGet failure
// ═══════════════════════════════════════════════════════════════════════════

describe("warmGeoCache — cacheGet failure", () => {
  it("does not crash when cacheGet throws", async () => {
    mockCacheGet.mockRejectedValue(new Error("Redis down"))
    const result = await warmGeoCache()
    expect(result.errors).toBe(0)
    expect(result.total).toBeGreaterThan(0)
  })
})
