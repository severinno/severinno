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
// Redis, Geo, and Query-Log mocks — use vi.hoisted for mutable mock functions
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

// ── Mock geo-query-log: empty by default, overridden in log-based tests ──
const mockGetTopSearches = vi.hoisted(() =>
  vi.fn<(_n: number) => Array<{ query: string; count: number }>>(),
)
const mockGetTopCEPs = vi.hoisted(() =>
  vi.fn<(_n: number) => Array<{ cep: string; count: number }>>(),
)
const mockGetTopReverses = vi.hoisted(() =>
  vi.fn<(_n: number) => Array<{ coords: string; count: number }>>(),
)

vi.mock("../geo-query-log", () => ({
  getTopSearches: (n: number) => mockGetTopSearches(n),
  getTopCEPs: (n: number) => mockGetTopCEPs(n),
  getTopReverses: (n: number) => mockGetTopReverses(n),
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
  // Log queries: empty by default — tests that need log data override these
  mockGetTopSearches.mockReturnValue([])
  mockGetTopCEPs.mockReturnValue([])
  mockGetTopReverses.mockReturnValue([])
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

  it("returns correct neighborhood count (Grupo 1)", () => {
    const config = getWarmConfig()
    expect(config.neighborhoods).toBe(5)
  })

  it("returns correct missing capitals count (Grupo 3)", () => {
    const config = getWarmConfig()
    expect(config.missingCapitals).toBe(6)
  })

  it("returns correct CEP count", () => {
    const config = getWarmConfig()
    expect(config.ceps).toBe(15)
  })

  it("returns correct coordinate count", () => {
    const config = getWarmConfig()
    expect(config.coords).toBe(8)
  })

  it("totalQueries is sum of all static entries", () => {
    const config = getWarmConfig()
    const expectedStatic =
      config.cities + config.neighborhoods + config.missingCapitals + config.ceps + config.coords
    expect(config.totalQueries).toBe(expectedStatic)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// warmGeoCache — all cache misses
// ═══════════════════════════════════════════════════════════════════════════

describe("warmGeoCache — all cache misses", () => {
  it("calls geocodeSearch for each city + neighborhood + missing capital (static only, no log data)", async () => {
    const result = await warmGeoCache()
    // 25 cities + 5 neighborhoods + 6 missing capitals = 36
    expect(mockGeocodeSearch).toHaveBeenCalledTimes(36)
    expect(result.searches).toBe(36)
    expect(result.logSearches).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors).toBe(0)
    expect(result.total).toBe(36 + 15 + 8)
  })

  it("calls geocodeCEP for each CEP (static only)", async () => {
    const result = await warmGeoCache()
    expect(mockGeocodeCEP).toHaveBeenCalledTimes(15)
    expect(result.ceps).toBe(15)
    expect(result.logCeps).toBe(0)
  })

  it("calls reverseGeocode for each coordinate (static only)", async () => {
    const result = await warmGeoCache()
    expect(mockReverseGeocode).toHaveBeenCalledTimes(8)
    expect(result.reverses).toBe(8)
    expect(result.logReverses).toBe(0)
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
    // Exact key match to avoid matching neighborhoods that contain "São Paulo, SP"
    mockCacheGet.mockImplementation(async (key: string) => {
      if (key === "geo:search:são paulo, sp:5") return [{ lat: -23.55 }]
      return null
    })

    const result = await warmGeoCache()
    expect(result.skipped).toBeGreaterThanOrEqual(1)
    expect(result.searches).toBe(35) // 36 - 1 cached
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
    expect(result.logSearches).toBe(0)
    expect(result.logCeps).toBe(0)
    expect(result.logReverses).toBe(0)
    expect(result.total).toBe(0)
    expect(result.skipped).toBe(36 + 15 + 8)
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
    expect(mockGeocodeSearch).toHaveBeenCalledTimes(36) // 25 cities + 5 neighborhoods + 6 capitals
    expect(result.errors).toBe(1)
    expect(result.searches).toBe(35) // 36 - 1 failed
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
// warmGeoCache — log-based warming
// ═══════════════════════════════════════════════════════════════════════════

describe("warmGeoCache — log-based warming", () => {
  it("warms log-based searches alongside static list", async () => {
    mockGetTopSearches.mockReturnValue([
      { query: "nova iguaçu, rj", count: 42 },
      { query: "campos dos goytacazes, rj", count: 31 },
    ])

    const result = await warmGeoCache()
    expect(mockGeocodeSearch).toHaveBeenCalledTimes(36 + 2)
    expect(result.searches).toBe(36)
    expect(result.logSearches).toBe(2)
    expect(result.total).toBe(36 + 15 + 8 + 2)
  })

  it("warms log-based CEPs alongside static list", async () => {
    mockGetTopCEPs.mockReturnValue([
      { cep: "22775040", count: 15 },
      { cep: "05763010", count: 12 },
      { cep: "29100010", count: 9 },
    ])

    const result = await warmGeoCache()
    expect(mockGeocodeCEP).toHaveBeenCalledTimes(15 + 3)
    expect(result.ceps).toBe(15)
    expect(result.logCeps).toBe(3)
    expect(result.total).toBe(36 + 15 + 8 + 3)
  })

  it("warms log-based reverse geocodes alongside static list", async () => {
    mockGetTopReverses.mockReturnValue([{ coords: "-22.9110,-43.2094", count: 22 }])

    const result = await warmGeoCache()
    expect(mockReverseGeocode).toHaveBeenCalledTimes(8 + 1)
    expect(result.reverses).toBe(8)
    expect(result.logReverses).toBe(1)
    expect(result.total).toBe(36 + 15 + 8 + 1)
  })

  it("all categories simultaneously", async () => {
    mockGetTopSearches.mockReturnValue([{ query: "sorocaba, sp", count: 10 }])
    mockGetTopCEPs.mockReturnValue([{ cep: "18035010", count: 8 }])
    mockGetTopReverses.mockReturnValue([{ coords: "-23.5010,-47.4580", count: 5 }])

    const result = await warmGeoCache()
    expect(result.searches).toBe(36)
    expect(result.logSearches).toBe(1)
    expect(result.ceps).toBe(15)
    expect(result.logCeps).toBe(1)
    expect(result.reverses).toBe(8)
    expect(result.logReverses).toBe(1)
    expect(result.total).toBe(36 + 15 + 8 + 1 + 1 + 1)
    expect(result.errors).toBe(0)
  })

  it("skips log-based entry already cached by static list", async () => {
    // "são paulo, sp" is already in TOP_CITIES
    mockGetTopSearches.mockReturnValue([
      { query: "são paulo, sp", count: 99 },
      { query: "rio de janeiro, rj", count: 88 },
    ])

    // Exact key match to avoid matching neighborhoods that contain "São Paulo, SP"
    mockCacheGet.mockImplementation(async (key: string) => {
      if (key === "geo:search:são paulo, sp:5") return [{ lat: -23.55 }]
      return null
    })

    const result = await warmGeoCache()
    // Static: 36 total, 1 skipped (são paulo already cached) = 35 searches
    // Log: 2 entries, 1 skipped (são paulo already in cache) = 1 log search
    expect(result.skipped).toBeGreaterThanOrEqual(2)
    expect(result.searches).toBe(35) // 36 - 1 cached static
    expect(result.logSearches).toBe(1) // only rio was not yet cached
    expect(mockGeocodeSearch).toHaveBeenCalledTimes(36) // 35 static + 1 log
  })

  it("skips log-based CEP already cached by static list", async () => {
    // 01310100 is already in TOP_CEPS
    mockGetTopCEPs.mockReturnValue([
      { cep: "01310100", count: 50 },
      { cep: "99999999", count: 3 },
    ])

    mockCacheGet.mockImplementation(async (key: string) => {
      if (key === "geo:cep:01310100") return { cep: "01310100" }
      return null
    })

    const result = await warmGeoCache()
    expect(result.skipped).toBeGreaterThanOrEqual(2)
    expect(result.ceps).toBe(14) // 15 - 1 skipped in static
    expect(result.logCeps).toBe(1) // only 99999999 was not cached
  })

  it("handles malformed coords gracefully (no crash)", async () => {
    mockGetTopReverses.mockReturnValue([
      { coords: "not-a-coord", count: 1 },
      { coords: "-23.5505,-46.6333", count: 10 },
    ])

    const result = await warmGeoCache()
    // 8 static reverses + 1 valid log reverse (malformed one skipped w/ error)
    expect(result.reverses).toBe(8)
    expect(result.logReverses).toBe(1)
    expect(result.errors).toBe(1)
  })

  it("tolerates log-based warming errors without crashing", async () => {
    mockGetTopSearches.mockReturnValue([{ query: "unknown city", count: 5 }])
    mockGetTopCEPs.mockReturnValue([{ cep: "00000000", count: 3 }])
    mockGetTopReverses.mockReturnValue([{ coords: "0.0000,0.0000", count: 1 }])

    // Make only the log-based calls fail (after static lists complete).
    // Static: 36 search + 15 CEP + 8 reverse = 59 total calls before log phase.
    let searchCalls = 0
    mockGeocodeSearch.mockImplementation(async () => {
      searchCalls++
      if (searchCalls > 36) throw new Error("rate limit")
      return []
    })
    let cepCalls = 0
    mockGeocodeCEP.mockImplementation(async () => {
      cepCalls++
      if (cepCalls > 15) throw new Error("timeout")
      return { cep: "00000000", street: "", city: "", state: "" }
    })
    let reverseCalls = 0
    mockReverseGeocode.mockImplementation(async () => {
      reverseCalls++
      if (reverseCalls > 8) throw new Error("fail")
      return { displayName: "test" }
    })

    const result = await warmGeoCache()
    expect(result.errors).toBe(3) // 1 search (log) + 1 CEP (log) + 1 reverse (log)
    expect(result.searches).toBe(36)
    expect(result.logSearches).toBe(0) // failed
    expect(result.ceps).toBe(15)
    expect(result.logCeps).toBe(0) // failed
    expect(result.reverses).toBe(8)
    expect(result.logReverses).toBe(0) // failed
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Post-restart scenario: Redis cold → warmGeoCache → cache populated
// ═══════════════════════════════════════════════════════════════════════════

describe("Post-restart: Redis cold → warmGeoCache → cache populated", () => {
  it("calls cacheGet for every entry before calling geo functions (cold start)", async () => {
    // Track which cache keys were checked
    const checkedKeys = new Set<string>()
    mockCacheGet.mockImplementation(async (key: string) => {
      checkedKeys.add(key)
      return null // cold cache — all misses
    })

    await warmGeoCache()

    // Should have checked all 59 static entries
    expect(checkedKeys.size).toBe(36 + 15 + 8)

    // Spot-check a search key
    expect(checkedKeys.has("geo:search:são paulo, sp:5")).toBe(true)
    expect(checkedKeys.has("geo:search:moema, são paulo, sp:5")).toBe(true)
    expect(checkedKeys.has("geo:search:belém, pa:5")).toBe(true)

    // Spot-check a CEP key
    expect(checkedKeys.has("geo:cep:01310100")).toBe(true)
    expect(checkedKeys.has("geo:cep:22041001")).toBe(true)

    // Spot-check a reverse key
    expect(checkedKeys.has("geo:reverse:-23.5505,-46.6333")).toBe(true)
    expect(checkedKeys.has("geo:reverse:-22.9068,-43.1729")).toBe(true)
  })

  it("warms all entries when cache is cold — returns full result counts", async () => {
    mockCacheGet.mockResolvedValue(null) // cold

    const result = await warmGeoCache()

    // All 59 static entries were cache misses and were warmed
    expect(result.searches).toBe(36)
    expect(result.ceps).toBe(15)
    expect(result.reverses).toBe(8)
    expect(result.logSearches).toBe(0)
    expect(result.logCeps).toBe(0)
    expect(result.logReverses).toBe(0)
    expect(result.total).toBe(59)
    expect(result.skipped).toBe(0)
    expect(result.errors).toBe(0)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)

    // All three geo functions were called
    expect(mockGeocodeSearch).toHaveBeenCalledTimes(36)
    expect(mockGeocodeCEP).toHaveBeenCalledTimes(15)
    expect(mockReverseGeocode).toHaveBeenCalledTimes(8)
  })

  it("warms log-based entries alongside static when log has data (post-restart with persisted log)", async () => {
    mockCacheGet.mockResolvedValue(null) // cold

    // Simulate log with data persisted from previous sessions
    mockGetTopSearches.mockReturnValue([
      { query: "nova iguaçu, rj", count: 42 },
      { query: "campos dos goytacazes, rj", count: 31 },
      { query: "são paulo, sp", count: 88 }, // already in static list
    ])
    mockGetTopCEPs.mockReturnValue([{ cep: "22775040", count: 15 }])
    mockGetTopReverses.mockReturnValue([{ coords: "-22.9110,-43.2094", count: 22 }])

    const result = await warmGeoCache()

    // Static: 36 search + 15 CEP + 8 reverse = 59
    // Log: mock cache stays cold (null), so isKeyCached returns false for
    // every entry — even "são paulo, sp" which was already warmed in static
    expect(result.searches).toBe(36)
    expect(result.logSearches).toBe(3) // all 3 log entries warmed (cold mock)
    expect(result.ceps).toBe(15)
    expect(result.logCeps).toBe(1)
    expect(result.reverses).toBe(8)
    expect(result.logReverses).toBe(1)
    expect(result.total).toBe(59 + 3 + 1 + 1)
    expect(result.errors).toBe(0)

    // Total geo calls: static + log (including duplicate são paulo)
    expect(mockGeocodeSearch).toHaveBeenCalledTimes(36 + 3) // 36 static + 3 log
    expect(mockGeocodeCEP).toHaveBeenCalledTimes(15 + 1)
    expect(mockReverseGeocode).toHaveBeenCalledTimes(8 + 1)
  })

  it("second warmGeoCache run skips all entries (cache already populated)", async () => {
    // First run: cold cache misses
    await warmGeoCache()

    // Reset mocks but keep default behavior
    vi.clearAllMocks()
    mockCacheGet.mockResolvedValue({ cached: true }) // cache is now hot
    mockGeocodeSearch.mockResolvedValue([])
    mockGeocodeCEP.mockResolvedValue({ cep: "00000000", street: "", city: "", state: "" })
    mockReverseGeocode.mockResolvedValue({ displayName: "test" })
    mockGetTopSearches.mockReturnValue([])
    mockGetTopCEPs.mockReturnValue([])
    mockGetTopReverses.mockReturnValue([])

    // Second run: all cache hits
    const result = await warmGeoCache()

    expect(result.searches).toBe(0)
    expect(result.ceps).toBe(0)
    expect(result.reverses).toBe(0)
    expect(result.logSearches).toBe(0)
    expect(result.logCeps).toBe(0)
    expect(result.logReverses).toBe(0)
    expect(result.total).toBe(0)
    expect(result.skipped).toBe(59) // all skipped
    expect(result.errors).toBe(0)

    // No geo functions called — all cache hits
    expect(mockGeocodeSearch).not.toHaveBeenCalled()
    expect(mockGeocodeCEP).not.toHaveBeenCalled()
    expect(mockReverseGeocode).not.toHaveBeenCalled()
  })

  it("third run with partial cache — only missing entries warmed", async () => {
    // First warm: nothing cached
    const r1 = await warmGeoCache()
    expect(r1.total).toBe(59)

    vi.clearAllMocks()

    // Simulate partial cache: only first city + first CEP are cached
    const cachedKeys = new Set([
      "geo:search:são paulo, sp:5",
      "geo:cep:01310100",
      "geo:reverse:-23.5505,-46.6333",
    ])
    mockCacheGet.mockImplementation(async (key: string) => {
      // For the mock, isKeyCached checks the Set in an idempotent way
      if (cachedKeys.has(key)) return { cached: true }
      return null
    })
    mockGeocodeSearch.mockResolvedValue([])
    mockGeocodeCEP.mockResolvedValue({ cep: "00000000", street: "", city: "", state: "" })
    mockReverseGeocode.mockResolvedValue({ displayName: "test" })
    mockGetTopSearches.mockReturnValue([])
    mockGetTopCEPs.mockReturnValue([])
    mockGetTopReverses.mockReturnValue([])

    // Second warm: only non-cached entries are warmed
    const r2 = await warmGeoCache()

    // 36 - 1 cached city = 35 searches warmed
    expect(r2.searches).toBe(35)
    // 15 - 1 cached CEP = 14 CEPs warmed
    expect(r2.ceps).toBe(14)
    // 8 - 1 cached coord = 7 reverses warmed
    expect(r2.reverses).toBe(7)
    expect(r2.total).toBe(35 + 14 + 7)
    expect(r2.skipped).toBe(3)
    expect(r2.errors).toBe(0)
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
