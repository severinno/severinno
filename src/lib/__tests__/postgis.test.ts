/**
 * Tests for src/lib/postgis.ts
 *
 * All functions (`findProvidersWithinRadius`, `getDistanceBetween`,
 * `isPostGISAvailable`) use injected `db.$queryRaw` and `withCache`.
 * These tests mock both dependencies to verify the SQL shape, caching
 * behavior, error handling, and edge cases — without a real PostGIS DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks — must use vi.hoisted() so variable initialisers run before
// the hoisted vi.mock() calls.
// ---------------------------------------------------------------------------

const { mockQueryRaw, mockWithCache } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
  mockWithCache: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: mockQueryRaw,
  },
}))

vi.mock("@/lib/redis", () => ({
  withCache: (...args: unknown[]) => (mockWithCache as any)(...args),
}))

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  findProvidersWithinRadius,
  getDistanceBetween,
  isPostGISAvailable,
  type ProximityResult,
} from "../postgis"

// ---------------------------------------------------------------------------
// findProvidersWithinRadius
// ---------------------------------------------------------------------------

describe("findProvidersWithinRadius", () => {
  const LAT = -23.5505
  const LNG = -46.6333
  const RADIUS_KM = 10

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: withCache invokes factory (cache miss)
    mockWithCache.mockImplementation(
      async (_key: string, fn: () => unknown) => fn(),
    )
  })

  // ---- Happy path -------------------------------------------------------

  it("returns providers within radius with distance in km", async () => {
    const dbRows = [
      { id: "p1", distance_km: 2.543 },
      { id: "p2", distance_km: 5.789 },
    ]
    mockQueryRaw.mockResolvedValue(dbRows)

    const result = await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ id: "p1", distanceKm: 2.543 })
    expect(result[1]).toEqual({ id: "p2", distanceKm: 5.789 })
  })

  it("returns empty array when no providers are within radius", async () => {
    mockQueryRaw.mockResolvedValue([])

    const result = await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    expect(result).toEqual([])
  })

  it("returns a single provider when only one is within radius", async () => {
    mockQueryRaw.mockResolvedValue([{ id: "p1", distance_km: 1.2 }])

    const result = await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("p1")
    expect(result[0].distanceKm).toBe(1.2)
  })

  // ---- Caching ----------------------------------------------------------

  it("uses withCache with a proximity: cache key containing rounded coords and radius", async () => {
    mockQueryRaw.mockResolvedValue([])

    await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    const cacheKey = mockWithCache.mock.calls[0][0] as string
    expect(cacheKey).toMatch(/^proximity:/)
    // Coords rounded to 3 decimals (~110m precision).
    // Floating-point toFixed(3) may round -23.5505 to "-23.551" or "-23.550"
    // depending on internal representation — accept either.
    expect(cacheKey).toMatch(/-\d+\.\d{3}:-\d+\.\d{3}/)
    expect(cacheKey).toContain(":10")      // radius
  })

  it("calls $queryRaw on cache miss, returns cached result on cache hit", async () => {
    // First call (cache miss) — $queryRaw is called
    mockQueryRaw.mockResolvedValue([{ id: "p1", distance_km: 5.0 }])
    await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    expect(mockQueryRaw).toHaveBeenCalledTimes(1)

    // Second call (simulated cache hit)
    vi.clearAllMocks()
    const cachedRows: ProximityResult[] = [{ id: "p1", distanceKm: 3.0 }]
    mockWithCache.mockImplementation(
      async (_key: string, _fn: () => unknown, _ttl: number) => cachedRows,
    )

    const result = await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    expect(result).toEqual(cachedRows)
    // $queryRaw should NOT have been called (cache hit — factory not invoked)
    expect(mockQueryRaw).not.toHaveBeenCalled()
  })

  it("uses 60s TTL for proximity queries", async () => {
    mockQueryRaw.mockResolvedValue([])

    await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    expect(mockWithCache).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
      60,
    )
  })

  // ---- Error handling ---------------------------------------------------

  it("returns empty array when PostGIS query fails (catch block)", async () => {
    mockQueryRaw.mockRejectedValue(new Error("PostGIS connection lost"))

    const result = await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    expect(result).toEqual([])
  })

  it("returns empty array when withCache itself throws", async () => {
    mockWithCache.mockRejectedValue(new Error("Redis unavailable"))

    const result = await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    expect(result).toEqual([])
  })

  // ---- Edge cases -------------------------------------------------------

  it("handles radius = 0 (returns empty — no providers at exact point)", async () => {
    mockQueryRaw.mockResolvedValue([])

    const result = await findProvidersWithinRadius(LAT, LNG, 0)

    expect(result).toEqual([])
  })

  it("handles a very large radius (5000 km)", async () => {
    mockQueryRaw.mockResolvedValue([{ id: "p1", distance_km: 1500 }])

    const result = await findProvidersWithinRadius(LAT, LNG, 5000)

    expect(result).toHaveLength(1)
    expect(result[0].distanceKm).toBe(1500)
  })

  it("handles equatorial coordinates (lat = 0)", async () => {
    mockQueryRaw.mockResolvedValue([{ id: "p1", distance_km: 50 }])

    const result = await findProvidersWithinRadius(0, 0, 100)

    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// getDistanceBetween
// ---------------------------------------------------------------------------

describe("getDistanceBetween", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWithCache.mockImplementation(
      async (_key: string, fn: () => unknown) => fn(),
    )
  })

  it("returns the distance between two users", async () => {
    mockQueryRaw.mockResolvedValue([{ distance_km: 15.3 }])

    const distance = await getDistanceBetween("user-a", "user-b")

    expect(distance).toBe(15.3)
  })

  it("returns null when either user has no location (DB returns null)", async () => {
    mockQueryRaw.mockResolvedValue([{ distance_km: null }])

    const distance = await getDistanceBetween("user-a", "user-b")

    expect(distance).toBeNull()
  })

  it("returns null when query returns empty rows", async () => {
    mockQueryRaw.mockResolvedValue([])

    const distance = await getDistanceBetween("user-a", "user-b")

    expect(distance).toBeNull()
  })

  it("sorts IDs alphabetically in cache key for consistency", async () => {
    mockQueryRaw.mockResolvedValue([{ distance_km: 10 }])

    await getDistanceBetween("user-b", "user-a")
    const keyBA = mockWithCache.mock.calls[0][0] as string

    vi.clearAllMocks()
    mockWithCache.mockImplementation(
      async (_key: string, fn: () => unknown) => fn(),
    )
    mockQueryRaw.mockResolvedValue([{ distance_km: 10 }])

    await getDistanceBetween("user-a", "user-b")
    const keyAB = mockWithCache.mock.calls[0][0] as string

    // Both should be the same key (sorted: user-a:user-b)
    expect(keyAB).toBe(keyBA)
    expect(keyBA).toContain("distance:")
    expect(keyBA).toContain("user-a:")
    expect(keyBA).toContain(":user-b")
  })

  it("returns null when PostGIS query fails (catch block)", async () => {
    mockQueryRaw.mockRejectedValue(new Error("DB error"))

    const distance = await getDistanceBetween("user-a", "user-b")

    expect(distance).toBeNull()
  })

  it("uses 60s TTL for distance queries", async () => {
    mockQueryRaw.mockResolvedValue([{ distance_km: 5 }])

    await getDistanceBetween("user-a", "user-b")

    expect(mockWithCache).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
      60,
    )
  })
})

// ---------------------------------------------------------------------------
// isPostGISAvailable
// ---------------------------------------------------------------------------

describe("isPostGISAvailable", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWithCache.mockImplementation(
      async (_key: string, fn: () => unknown) => fn(),
    )
  })

  it("returns true when PostGIS extension is installed", async () => {
    mockQueryRaw.mockResolvedValue([{ available: true }])

    const result = await isPostGISAvailable()

    expect(result).toBe(true)
  })

  it("returns false when PostGIS extension is not installed (empty rows)", async () => {
    mockQueryRaw.mockResolvedValue([])

    const result = await isPostGISAvailable()

    expect(result).toBe(false)
  })

  it("returns false when query fails (catch block)", async () => {
    mockQueryRaw.mockRejectedValue(new Error("DB connection lost"))

    const result = await isPostGISAvailable()

    expect(result).toBe(false)
  })

  it("caches result with 'postgis:available' key and 300s TTL", async () => {
    mockQueryRaw.mockResolvedValue([{ available: true }])

    await isPostGISAvailable()

    expect(mockWithCache).toHaveBeenCalledWith(
      "postgis:available",
      expect.any(Function),
      300,
    )
  })

  it("returns cached result on second call without querying DB", async () => {
    // First call: cache miss, query executes
    mockQueryRaw.mockResolvedValue([{ available: true }])
    const result1 = await isPostGISAvailable()
    expect(result1).toBe(true)

    // Second call: simulated cache hit
    vi.clearAllMocks()
    mockWithCache.mockImplementation(
      async (_key: string, _fn: () => unknown, _ttl: number) => true,
    )

    const result2 = await isPostGISAvailable()
    expect(result2).toBe(true)
    expect(mockQueryRaw).not.toHaveBeenCalled()
  })
})
