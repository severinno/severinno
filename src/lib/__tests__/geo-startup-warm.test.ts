/**
 * Tests for geo-startup-warm.ts — server-startup cache warmer.
 *
 * Coverage:
 *   ✅ Log-based warm: uses top queries from log, calls geo functions
 *   ✅ Curated fallback: delegates to warmGeoCache when log is sparse
 *   ✅ Skipped counter: increments when cache already has the key
 *   ✅ Errors counter: increments when a geo function throws
 *   ✅ Edge cases: empty log, enough searches but no CEPs
 *   ✅ Edge cases: no coordinates in reverse → skipped
 *   ✅ Diagnostics: includes query log stats in result
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks (must be before module imports)
// ---------------------------------------------------------------------------

// Hoisted mocks for geo-query-log
const mockGetTopSearches = vi.hoisted(() => vi.fn())
const mockGetTopCEPs = vi.hoisted(() => vi.fn())
const mockGetTopReverses = vi.hoisted(() => vi.fn())
const mockGetQueryLogDiagnostics = vi.hoisted(() => vi.fn())

// Hoisted mocks for geo-cache-warm
const mockWarmGeoCache = vi.hoisted(() => vi.fn())
const mockGetWarmConfig = vi.hoisted(() => vi.fn())

// Hoisted mocks for geo functions
const mockGeocodeSearch = vi.hoisted(() => vi.fn())
const mockGeocodeCEP = vi.hoisted(() => vi.fn())
const mockReverseGeocode = vi.hoisted(() => vi.fn())

// Hoisted mock for redis cacheGet
const mockCacheGet = vi.hoisted(() => vi.fn())

// Hoisted mock for redis availability
const mockIsRedisAvailable = vi.hoisted(() => vi.fn())

vi.mock("@/lib/geo-query-log", () => ({
  getTopSearches: mockGetTopSearches,
  getTopCEPs: mockGetTopCEPs,
  getTopReverses: mockGetTopReverses,
  getQueryLogDiagnostics: mockGetQueryLogDiagnostics,
}))

vi.mock("@/lib/geo-cache-warm", () => ({
  warmGeoCache: mockWarmGeoCache,
  getWarmConfig: mockGetWarmConfig,
}))

vi.mock("@/lib/geo", () => ({
  geocodeSearch: mockGeocodeSearch,
  geocodeCEP: mockGeocodeCEP,
  reverseGeocode: mockReverseGeocode,
}))

vi.mock("@/lib/redis", () => ({
  cacheGet: mockCacheGet,
  isRedisAvailable: mockIsRedisAvailable,
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { warmGeoCacheFromLog } from "../geo-startup-warm"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DIAG_EMPTY = {
  totalSearches: 0,
  uniqueSearches: 0,
  totalCEPs: 0,
  uniqueCEPs: 0,
  totalReverses: 0,
  uniqueReverses: 0,
  pendingChanges: 0,
  logPath: "/tmp/geo-query-log.json",
}

const DIAG_SUFFICIENT = {
  totalSearches: 50,
  uniqueSearches: 8,
  totalCEPs: 30,
  uniqueCEPs: 5,
  totalReverses: 10,
  uniqueReverses: 3,
  pendingChanges: 0,
  logPath: "/tmp/geo-query-log.json",
}

const DIAG_PARTIAL = {
  totalSearches: 20,
  uniqueSearches: 5,
  totalCEPs: 0,
  uniqueCEPs: 0,
  totalReverses: 0,
  uniqueReverses: 0,
  pendingChanges: 0,
  logPath: "/tmp/geo-query-log.json",
}

const TOP_SEARCHES = [
  { query: "são paulo, sp", count: 100 },
  { query: "rio de janeiro, rj", count: 50 },
]

const TOP_CEPS = [{ cep: "01310100", count: 30 }]

const TOP_REVERSES = [{ coords: "-23.5505,-46.6333", count: 5 }]

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()

  // Default: sufficient data in log
  mockGetQueryLogDiagnostics.mockReturnValue(DIAG_SUFFICIENT)
  mockGetTopSearches.mockReturnValue(TOP_SEARCHES)
  mockGetTopCEPs.mockReturnValue(TOP_CEPS)
  mockGetTopReverses.mockReturnValue(TOP_REVERSES)

  // Default: Redis available (all queries will be warmed)
  mockIsRedisAvailable.mockReturnValue(true)
  mockCacheGet.mockResolvedValue(null)

  // Default: geo functions succeed
  mockGeocodeSearch.mockResolvedValue([])
  mockGeocodeCEP.mockResolvedValue({
    cep: "01310100",
    street: "",
    district: "",
    city: "",
    state: "",
  })
  mockReverseGeocode.mockResolvedValue({ displayName: "São Paulo" })
})

// ===========================================================================
// Log-based warm
// ===========================================================================

describe("warmGeoCacheFromLog — log-based warm", () => {
  it("warms searches, CEPs, and reverses from query log", async () => {
    const result = await warmGeoCacheFromLog()

    expect(result.source).toBe("query_log")
    expect(result.searches).toBe(2) // both searches
    expect(result.ceps).toBe(1) // 1 CEP
    expect(result.reverses).toBe(1) // 1 reverse
    expect(result.total).toBe(4)
    expect(result.skipped).toBe(0)

    // geo functions called with correct args
    expect(mockGeocodeSearch).toHaveBeenCalledWith("são paulo, sp", 5)
    expect(mockGeocodeSearch).toHaveBeenCalledWith("rio de janeiro, rj", 5)
    expect(mockGeocodeCEP).toHaveBeenCalledWith("01310100")
    expect(mockReverseGeocode).toHaveBeenCalledWith(-23.5505, -46.6333)
  })

  it("increments skipped counter when cache already has the key", async () => {
    // Simulate cache hit — all keys already exist
    mockCacheGet.mockResolvedValue("some cached value")

    const result = await warmGeoCacheFromLog()

    expect(result.source).toBe("query_log")
    expect(result.searches).toBe(0)
    expect(result.ceps).toBe(0)
    expect(result.reverses).toBe(0)
    expect(result.skipped).toBe(4) // all 4 queries skipped
  })

  it("increments errors counter when a geo function throws", async () => {
    mockGeocodeSearch.mockRejectedValue(new Error("Nominatim unavailable"))

    const result = await warmGeoCacheFromLog()

    expect(result.searches).toBe(0) // both failed
    expect(result.ceps).toBe(1) // CEP still succeeded
    expect(result.reverses).toBe(1) // reverse still succeeded
    expect(result.errors).toBe(2) // 2 search errors
  })

  it("passes query log diagnostics in result", async () => {
    const result = await warmGeoCacheFromLog()

    expect(result.diagnostics).toEqual({
      totalSearches: DIAG_SUFFICIENT.totalSearches,
      uniqueSearches: DIAG_SUFFICIENT.uniqueSearches,
      totalCEPs: DIAG_SUFFICIENT.totalCEPs,
      uniqueCEPs: DIAG_SUFFICIENT.uniqueCEPs,
    })
  })

  it("skips reverse queries with invalid coordinate format gracefully", async () => {
    mockGetTopReverses.mockReturnValue([
      { coords: "invalid", count: 1 }, // will fail split+map
      { coords: "abc,def", count: 1 }, // non-numeric tokens
    ])

    const result = await warmGeoCacheFromLog()

    // Invalid / partial coords are skipped without error
    expect(result.reverses).toBe(0)
    expect(result.errors).toBe(0)
    expect(result.skipped).toBe(0) // not "skipped" since they were never checked
  })

  it("warms with partial log data (enough searches but no CEPs)", async () => {
    mockGetQueryLogDiagnostics.mockReturnValue(DIAG_PARTIAL)
    mockGetTopCEPs.mockReturnValue([])
    mockGetTopReverses.mockReturnValue([])

    const result = await warmGeoCacheFromLog()

    expect(result.source).toBe("query_log")
    expect(result.searches).toBe(2)
    expect(result.ceps).toBe(0)
    expect(result.reverses).toBe(0)
    expect(result.total).toBe(2)
  })
})

// ===========================================================================
// Curated fallback
// ===========================================================================

describe("warmGeoCacheFromLog — curated fallback", () => {
  beforeEach(() => {
    // Empty log: fewer than 3 unique searches AND fewer than 3 unique CEPs
    mockGetQueryLogDiagnostics.mockReturnValue(DIAG_EMPTY)
    mockGetTopSearches.mockReturnValue([])
    mockGetTopCEPs.mockReturnValue([])
    mockGetTopReverses.mockReturnValue([])
  })

  it("falls back to curated list when query log is empty", async () => {
    mockWarmGeoCache.mockResolvedValue({
      searches: 10,
      ceps: 8,
      reverses: 5,
      total: 23,
      skipped: 0,
      errors: 0,
      elapsedMs: 15000,
    })
    mockGetWarmConfig.mockReturnValue({ cities: 25, ceps: 15, coords: 8, totalQueries: 48 })

    const result = await warmGeoCacheFromLog()

    expect(result.source).toBe("curated_fallback")
    expect(result.total).toBe(23)
    expect(result.searches).toBe(10)
    expect(result.ceps).toBe(8)
    expect(result.reverses).toBe(5)

    // Delegated to warmGeoCache
    expect(mockWarmGeoCache).toHaveBeenCalledTimes(1)
  })

  it("falls back when log has very few unique entries (< 3)", async () => {
    // Only 1 unique search, 2 unique CEPs — both below threshold
    mockGetQueryLogDiagnostics.mockReturnValue({
      ...DIAG_EMPTY,
      uniqueSearches: 1,
      uniqueCEPs: 2,
    })

    mockWarmGeoCache.mockResolvedValue({
      searches: 5,
      ceps: 5,
      reverses: 3,
      total: 13,
      skipped: 10,
      errors: 0,
      elapsedMs: 10000,
    })
    mockGetWarmConfig.mockReturnValue({ cities: 25, ceps: 15, coords: 8, totalQueries: 48 })

    const result = await warmGeoCacheFromLog()

    expect(result.source).toBe("curated_fallback")
    expect(mockWarmGeoCache).toHaveBeenCalledTimes(1)
  })

  it("does NOT query geo functions when falling back to curated", async () => {
    mockWarmGeoCache.mockResolvedValue({
      searches: 5,
      ceps: 5,
      reverses: 3,
      total: 13,
      skipped: 10,
      errors: 0,
      elapsedMs: 10000,
    })
    mockGetWarmConfig.mockReturnValue({ cities: 25, ceps: 15, coords: 8, totalQueries: 48 })

    await warmGeoCacheFromLog()

    // Individual geo functions should NOT be called during fallback
    expect(mockGeocodeSearch).not.toHaveBeenCalled()
    expect(mockGeocodeCEP).not.toHaveBeenCalled()
    expect(mockReverseGeocode).not.toHaveBeenCalled()
  })

  it("includes empty log diagnostics in fallback result", async () => {
    mockWarmGeoCache.mockResolvedValue({
      searches: 0,
      ceps: 0,
      reverses: 0,
      total: 0,
      skipped: 0,
      errors: 0,
      elapsedMs: 0,
    })
    mockGetWarmConfig.mockReturnValue({ cities: 25, ceps: 15, coords: 8, totalQueries: 48 })

    const result = await warmGeoCacheFromLog()

    expect(result.diagnostics.totalSearches).toBe(0)
    expect(result.diagnostics.uniqueSearches).toBe(0)
  })
})

// ===========================================================================
// Edge cases
// ===========================================================================

describe("warmGeoCacheFromLog — edge cases", () => {
  it("reports elapsedMs >= 0", async () => {
    const result = await warmGeoCacheFromLog()
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it("handles when cacheGet throws (treated as cache miss)", async () => {
    mockCacheGet.mockRejectedValue(new Error("Redis unavailable"))

    const result = await warmGeoCacheFromLog()

    // Falls through to geo functions (cache miss behavior)
    expect(result.searches).toBe(2)
    expect(result.ceps).toBe(1)
    expect(result.reverses).toBe(1)
  })

  it("skips warming entirely when Redis is unavailable", async () => {
    mockIsRedisAvailable.mockReturnValue(false)

    const result = await warmGeoCacheFromLog()

    expect(result.source).toBe("nothing_to_warm")
    expect(result.total).toBe(0)
    expect(result.searches).toBe(0)
    expect(result.ceps).toBe(0)
    expect(result.reverses).toBe(0)

    // No external geo calls and no curated fallback when Redis is down
    expect(mockGeocodeSearch).not.toHaveBeenCalled()
    expect(mockGeocodeCEP).not.toHaveBeenCalled()
    expect(mockReverseGeocode).not.toHaveBeenCalled()
    expect(mockWarmGeoCache).not.toHaveBeenCalled()
  })
})
