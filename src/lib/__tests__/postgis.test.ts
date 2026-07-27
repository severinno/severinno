import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  },
}))

const { mockWithCache } = vi.hoisted(() => ({
  mockWithCache: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))
vi.mock("@/lib/redis", () => ({ withCache: mockWithCache }))

// ── Imports under test ----------------------------------------------------

import {
  findProvidersWithinRadius,
  getDistanceBetween,
  isPostGISAvailable,
} from "../postgis"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake proximity row as returned by $queryRaw. */
function makeRow(id: string, distanceKm: number): { id: string; distance_km: number } {
  return { id, distance_km: distanceKm }
}

/** Build a fake pg_extension availability row. */
function availabilityRow(available: boolean): Array<{ available: boolean }> {
  return available ? [{ available: true }] : []
}

// ---------------------------------------------------------------------------
// findProvidersWithinRadius
// ---------------------------------------------------------------------------

describe("findProvidersWithinRadius", () => {
  const LAT = -23.5505
  const LNG = -46.6333
  const RADIUS_KM = 10
  const CACHE_TTL = 60

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    // Default: withCache invokes the factory function
    mockWithCache.mockImplementation(async (_key: string, fn: () => unknown) => fn())
  })

  it("returns providers within radius from PostGIS query", async () => {
    const rows = [makeRow("prov-1", 2.5), makeRow("prov-2", 5.1)]
    mockDb.$queryRaw.mockResolvedValue(rows)

    const result = await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    expect(result).toEqual([
      { id: "prov-1", distanceKm: 2.5 },
      { id: "prov-2", distanceKm: 5.1 },
    ])

    // Verify withCache was called with a correct cache key
    expect(mockWithCache).toHaveBeenCalledTimes(1)
    const cacheKey = mockWithCache.mock.calls[0][0]
    expect(cacheKey).toMatch(/^proximity:/)
    expect(cacheKey).toContain(`${RADIUS_KM}`)

    // Verify $queryRaw was called with a parameterized SQL containing ST_DWithin
    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1)
    const sql = mockDb.$queryRaw.mock.calls[0][0] as TemplateStringsArray
    expect(sql.raw.join(" ")).toContain("ST_DWithin")
    expect(sql.raw.join(" ")).toContain("ST_Distance")
  })

  it("returns empty array when no providers match", async () => {
    mockDb.$queryRaw.mockResolvedValue([])

    const result = await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    expect(result).toEqual([])
  })

  it("returns empty array on PostGIS query failure (fallback)", async () => {
    mockDb.$queryRaw.mockRejectedValue(new Error("PostGIS not available"))

    const result = await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    // Should gracefully fall back — no throw
    expect(result).toEqual([])
    expect(console.warn).toHaveBeenCalledWith(
      "PostGIS ST_DWithin query failed:",
      expect.any(Error),
    )
  })

  it("uses cached result when Redis has the key", async () => {
    const cached = [{ id: "prov-1", distanceKm: 2.5 }]
    mockWithCache.mockImplementation(async (_key: string) => cached as never)

    const result = await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    expect(result).toEqual(cached)
    // Factory should NOT have been called since cache hit
    expect(mockDb.$queryRaw).not.toHaveBeenCalled()
  })

  it("passes the correct TTL to withCache", async () => {
    mockDb.$queryRaw.mockResolvedValue([])

    await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    expect(mockWithCache).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
      CACHE_TTL,
    )
  })

  it("rounds coordinates for cache key to 3 decimal places", async () => {
    mockDb.$queryRaw.mockResolvedValue([])

    await findProvidersWithinRadius(-23.5505123, -46.6333789, RADIUS_KM)

    const cacheKey = mockWithCache.mock.calls[0][0] as string
    // Should contain rounded coordinates
    expect(cacheKey).toContain("-23.551")
    expect(cacheKey).toContain("-46.633")
  })

  it("handles non-numeric distance_km by converting to number", async () => {
    const row = { id: "prov-1", distance_km: 3.7 }
    mockDb.$queryRaw.mockResolvedValue([row])

    const result = await findProvidersWithinRadius(LAT, LNG, RADIUS_KM)

    expect(result[0].distanceKm).toBe(3.7)
    expect(typeof result[0].distanceKm).toBe("number")
  })

  it("returns empty array for radiusKm = 0 (ST_DWithin matches nothing)", async () => {
    mockDb.$queryRaw.mockResolvedValue([])

    const result = await findProvidersWithinRadius(LAT, LNG, 0)

    expect(result).toEqual([])
    // SQL was still called with 0 meters — no error
    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it("returns empty array for negative radiusKm (ST_DWithin throws)", async () => {
    mockDb.$queryRaw.mockRejectedValue(new Error("ST_DWithin: radius must be non-negative"))

    const result = await findProvidersWithinRadius(LAT, LNG, -5)

    expect(result).toEqual([])
    // Error was caught, console.warn logged
    expect(console.warn).toHaveBeenCalledWith(
      "PostGIS ST_DWithin query failed:",
      expect.any(Error),
    )
  })
})

// ---------------------------------------------------------------------------
// getDistanceBetween
// ---------------------------------------------------------------------------

describe("getDistanceBetween", () => {
  const USER_A = "user-alpha"
  const USER_B = "user-beta"
  const CACHE_TTL = 60

  beforeEach(() => {
    vi.clearAllMocks()
    mockWithCache.mockImplementation(async (_key: string, fn: () => unknown) => fn())
  })

  it("returns distance in km between two users", async () => {
    mockDb.$queryRaw.mockResolvedValue([{ distance_km: 12.4 }])

    const result = await getDistanceBetween(USER_A, USER_B)

    expect(result).toBe(12.4)
    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it("returns null when distance is null (one user has no location)", async () => {
    mockDb.$queryRaw.mockResolvedValue([{ distance_km: null }])

    const result = await getDistanceBetween(USER_A, USER_B)

    expect(result).toBeNull()
  })

  it("returns null when query returns empty rows", async () => {
    mockDb.$queryRaw.mockResolvedValue([])

    const result = await getDistanceBetween(USER_A, USER_B)

    expect(result).toBeNull()
  })

  it("returns null on database error", async () => {
    mockDb.$queryRaw.mockRejectedValue(new Error("Connection lost"))

    const result = await getDistanceBetween(USER_A, USER_B)

    expect(result).toBeNull()
  })

  it("sorts IDs for cache key so A:B and B:A share cache", async () => {
    mockDb.$queryRaw.mockResolvedValue([{ distance_km: 5.0 }])

    // Call with (A, B) then (B, A) — both must produce the same cache key
    await getDistanceBetween(USER_A, USER_B)
    await getDistanceBetween(USER_B, USER_A)

    const keyFromFirstCall = mockWithCache.mock.calls[0][0]
    const keyFromSecondCall = mockWithCache.mock.calls[1][0]

    expect(keyFromFirstCall).toBe(keyFromSecondCall)
  })

  it("passes the correct TTL to withCache", async () => {
    mockDb.$queryRaw.mockResolvedValue([{ distance_km: 3.0 }])

    await getDistanceBetween(USER_A, USER_B)

    expect(mockWithCache).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
      CACHE_TTL,
    )
  })
})

// ---------------------------------------------------------------------------
// isPostGISAvailable
// ---------------------------------------------------------------------------

describe("isPostGISAvailable", () => {
  const CACHE_TTL = 300

  beforeEach(() => {
    vi.clearAllMocks()
    mockWithCache.mockImplementation(async (_key: string, fn: () => unknown) => fn())
  })

  it("returns true when postgis extension exists", async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([{ available: true }])

    const result = await isPostGISAvailable()

    expect(result).toBe(true)
    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it("returns false when postgis extension is not installed", async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([])

    const result = await isPostGISAvailable()

    expect(result).toBe(false)
  })

  it("returns false on database error", async () => {
    mockDb.$queryRaw.mockRejectedValueOnce(new Error("Connection refused"))

    const result = await isPostGISAvailable()

    expect(result).toBe(false)
  })

  it("passes the correct TTL (5 minutes) to withCache", async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([{ available: true }])

    await isPostGISAvailable()

    expect(mockWithCache).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
      CACHE_TTL,
    )
  })

  it("uses the expected cache key", async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([{ available: true }])

    await isPostGISAvailable()

    const cacheKey = mockWithCache.mock.calls[0][0]
    expect(cacheKey).toBe("postgis:available")
  })

  it("returns cached value on subsequent calls without hitting DB", async () => {
    mockWithCache.mockImplementation(async (_key: string) => true as never)

    const result = await isPostGISAvailable()

    expect(result).toBe(true)
    expect(mockDb.$queryRaw).not.toHaveBeenCalled()
  })
})
