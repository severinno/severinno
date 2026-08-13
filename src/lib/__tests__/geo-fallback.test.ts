/**
 * Tests for the 3 local DB fallback functions in geo.ts.
 *
 * When Nominatim / ViaCEP is unavailable, each public geocoding function
 * falls back to a local DB search (User / Provider table).
 *
 * This test file mocks:
 *   - globalThis.fetch   → rejects (simulating API failure)
 *   - @/lib/db           → returns provider address data
 *
 * IMPORTANT: Each test uses a UNIQUE search term/CEP/coord to prevent
 * cache collisions. The withCachedGeo wrapper caches results via an
 * in-memory fallback, so tests sharing the same cache key would get
 * stale cached results instead of reaching the DB fallback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock @/lib/db — vi.hoisted ensures it's defined before vi.mock runs
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => ({
  user: {
    findMany: vi.fn<() => Promise<unknown[]>>(),
    findFirst: vi.fn<() => Promise<unknown>>(),
  },
}))

vi.mock("@/lib/db", () => ({
  db: mockDb,
}))

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

// Factory for mock provider objects.
// Uses `Record<string, unknown>` for overrides because Partial<T> drops `null`
// from union types (street/cep can be null in Prisma select results).
function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    lat: -23.5505,
    lng: -46.6333,
    street: "Rua Augusta",
    district: "Consolação",
    city: "São Paulo",
    state: "SP",
    cep: "01310-100",
    ...overrides,
  }
}

const MOCK_PROVIDER_SP = makeProvider()
const MOCK_PROVIDER_RJ = makeProvider({
  lat: -22.9068, lng: -43.1729,
  street: "Avenida Atlântica", district: "Copacabana",
  city: "Rio de Janeiro", state: "RJ", cep: "22070-001",
})

// ===========================================================================
// geocodeSearch — fallback local (geocodeSearchLocal)
// ===========================================================================

describe("geocodeSearch — fallback local DB (geocodeSearchLocal)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Nominatim offline"))
    // Reset DB mocks to prevent cross-test contamination
    mockDb.user.findMany.mockReset()
    mockDb.user.findFirst.mockReset()
  })

  it("returns DB providers when Nominatim is unavailable", async () => {
    mockDb.user.findMany.mockResolvedValue([MOCK_PROVIDER_SP])
    const { geocodeSearch } = await import("../geo")
    // Unique query — no cache collision risk
    const results = await geocodeSearch("Fallback Test SP Augusta")

    expect(results).toHaveLength(1)
    expect(results[0].street).toBe("Rua Augusta")
    expect(results[0].district).toBe("Consolação")
    expect(results[0].city).toBe("São Paulo")
    expect(results[0].state).toBe("SP")
    expect(results[0].cep).toBe("01310-100")
  })

  it("marks fallback results with type 'local_fallback'", async () => {
    mockDb.user.findMany.mockResolvedValue([MOCK_PROVIDER_SP])
    const { geocodeSearch } = await import("../geo")
    const results = await geocodeSearch("Fallback Type Check Query")

    expect(results[0].type).toBe("local_fallback")
    expect(results[0].category).toBe("place")
    expect(results[0].importance).toBe(0.5)
  })

  it("returns multiple providers", async () => {
    mockDb.user.findMany.mockResolvedValue([MOCK_PROVIDER_SP, MOCK_PROVIDER_RJ])
    const { geocodeSearch } = await import("../geo")
    const results = await geocodeSearch("Fallback Multiple Providers Query")

    expect(results).toHaveLength(2)
    expect(results[0].city).toBe("São Paulo")
    expect(results[1].city).toBe("Rio de Janeiro")
  })

  it("passes the query and limit to db.user.findMany", async () => {
    mockDb.user.findMany.mockResolvedValue([MOCK_PROVIDER_SP])
    const { geocodeSearch } = await import("../geo")
    await geocodeSearch("Fallback Limit Query Param", 3)

    expect(mockDb.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: "PROVIDER",
          active: true,
          OR: expect.arrayContaining([
            expect.objectContaining({ city: { contains: "Fallback Limit Query Param", mode: "insensitive" } }),
          ]),
        }),
        take: 3,
      }),
    )
  })

  it("returns empty array when Nominatim AND DB both fail", async () => {
    mockDb.user.findMany.mockRejectedValue(new Error("DB connection failed"))
    const { geocodeSearch } = await import("../geo")
    const results = await geocodeSearch("Fallback DB Failure Test")

    expect(results).toEqual([])
  })

  it("builds displayName from street, district, city, state", async () => {
    mockDb.user.findMany.mockResolvedValue([MOCK_PROVIDER_SP])
    const { geocodeSearch } = await import("../geo")
    const results = await geocodeSearch("Fallback Display Name Test")

    expect(results[0].displayName).toBe("Rua Augusta, Consolação, São Paulo, SP")
  })

  it("handles partial address data (only city and state)", async () => {
    mockDb.user.findMany.mockResolvedValue([
      makeProvider({ street: null, district: null, cep: null }),
    ])
    const { geocodeSearch } = await import("../geo")
    const results = await geocodeSearch("Fallback Partial Address Test")

    expect(results).toHaveLength(1)
    expect(results[0].displayName).toBe("São Paulo, SP")
    expect(results[0].street).toBeNull()
    expect(results[0].district).toBeNull()
    expect(results[0].cep).toBeNull()
  })

  it("passes limit to DB and returns up to limit results", async () => {
    const items = Array.from({ length: 3 }, (_, i) => makeProvider({
      lat: -23.55 + i * 0.01,
      lng: -46.63 + i * 0.01,
      street: `Rua Limit ${i}`,
      district: `Bairro ${i}`,
      cep: `88888-80${i}`,
    }))
    mockDb.user.findMany.mockResolvedValue(items)
    const { geocodeSearch } = await import("../geo")
    const results = await geocodeSearch("Fallback Limit Pass Test", 3)

    expect(results).toHaveLength(3)
    expect(results[0].street).toBe("Rua Limit 0")
    expect(mockDb.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    )
  })
})

// ===========================================================================
// geocodeCEP — fallback local (geocodeCEPLocal)
// ===========================================================================

describe("geocodeCEP — fallback local DB (geocodeCEPLocal)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ViaCEP offline"))
    mockDb.user.findMany.mockReset()
    mockDb.user.findFirst.mockReset()
  })

  it("returns address from DB when ViaCEP is unavailable", async () => {
    mockDb.user.findFirst.mockResolvedValue(MOCK_PROVIDER_SP)
    const { geocodeCEP } = await import("../geo")
    // Each CEP test uses a unique CEP to avoid cache collision
    const result = await geocodeCEP("11111111")

    expect(result.cep).toBe("01310-100")
    expect(result.street).toBe("Rua Augusta")
    expect(result.district).toBe("Consolação")
    expect(result.city).toBe("São Paulo")
    expect(result.state).toBe("SP")
  })

  it("throws 'CEP não encontrado' when DB has no matching CEP", async () => {
    mockDb.user.findFirst.mockResolvedValue(null)
    const { geocodeCEP } = await import("../geo")
    await expect(geocodeCEP("22222222")).rejects.toThrow("CEP não encontrado")
  })

  it("throws 'CEP não encontrado' when DB query also fails", async () => {
    mockDb.user.findFirst.mockRejectedValue(new Error("DB connection failed"))
    const { geocodeCEP } = await import("../geo")
    await expect(geocodeCEP("33333333")).rejects.toThrow("CEP não encontrado")
  })

  it("searches DB with and without hyphen in CEP", async () => {
    mockDb.user.findFirst.mockResolvedValue(MOCK_PROVIDER_SP)
    const { geocodeCEP } = await import("../geo")
    await geocodeCEP("44444444")

    expect(mockDb.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: "PROVIDER",
          active: true,
          OR: [{ cep: "44444444" }, { cep: "44444-444" }],
        }),
      }),
    )
  })

  it("cleans non-digit characters from CEP before searching", async () => {
    mockDb.user.findFirst.mockResolvedValue(MOCK_PROVIDER_SP)
    const { geocodeCEP } = await import("../geo")
    await geocodeCEP("55555-555")

    expect(mockDb.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ cep: "55555555" }, { cep: "55555-555" }],
        }),
      }),
    )
  })

  it("uses DB cep in result when provider has cep stored", async () => {
    mockDb.user.findFirst.mockResolvedValue(makeProvider({ cep: "66666-666" }))
    const { geocodeCEP } = await import("../geo")
    const result = await geocodeCEP("66666666")

    expect(result.cep).toBe("66666-666")
  })

  it("falls back to input CEP when provider has null cep", async () => {
    mockDb.user.findFirst.mockResolvedValue(makeProvider({ cep: null }))
    const { geocodeCEP } = await import("../geo")
    const result = await geocodeCEP("77777777")

    expect(result.cep).toBe("77777777")
  })

  it("orders DB results by avgRating descending", async () => {
    mockDb.user.findFirst.mockResolvedValue(MOCK_PROVIDER_SP)
    const { geocodeCEP } = await import("../geo")
    await geocodeCEP("88888888")

    expect(mockDb.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { avgRating: "desc" },
      }),
    )
  })
})

// ===========================================================================
// reverseGeocode — fallback local (reverseGeocodeLocal)
// ===========================================================================

describe("reverseGeocode — fallback local DB (reverseGeocodeLocal)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Nominatim offline"))
    mockDb.user.findMany.mockReset()
    mockDb.user.findFirst.mockReset()
  })

  it("returns nearest provider's address within 100km", async () => {
    mockDb.user.findMany.mockResolvedValue([MOCK_PROVIDER_SP, MOCK_PROVIDER_RJ])
    const { reverseGeocode } = await import("../geo")
    // User at SP coords — SP provider is nearest (~0km)
    const result = await reverseGeocode(-23.5505, -46.6333)

    expect(result.road).toBe("Rua Augusta")
    expect(result.neighbourhood).toBe("Consolação")
    expect(result.city).toBe("São Paulo")
    expect(result.state).toBe("SP")
    expect(result.postcode).toBe("01310-100")
  })

  it("returns raw coordinates when no provider is within 100km", async () => {
    mockDb.user.findMany.mockResolvedValue([MOCK_PROVIDER_SP, MOCK_PROVIDER_RJ])
    const { reverseGeocode } = await import("../geo")
    // User in Tokyo — no provider within 100km
    const result = await reverseGeocode(35.6762, 139.6503)

    // JS toFixed() always uses dot as decimal separator
    expect(result.displayName).toBe("35.6762, 139.6503")
    expect(result.road).toBeUndefined()
    expect(result.city).toBeUndefined()
    expect(result.state).toBeUndefined()
    expect(result.postcode).toBeUndefined()
  })

  it("returns raw coordinates when DB query also fails", async () => {
    mockDb.user.findMany.mockRejectedValue(new Error("DB connection failed"))
    const { reverseGeocode } = await import("../geo")
    // Unique coords to avoid cache collision with previous test
    const result = await reverseGeocode(48.8566, 2.3522)

    expect(result.displayName).toBe("48.8566, 2.3522")
    expect(result.road).toBeUndefined()
    expect(result.city).toBeUndefined()
  })

  it("returns raw coordinates when DB returns empty array", async () => {
    mockDb.user.findMany.mockResolvedValue([])
    const { reverseGeocode } = await import("../geo")
    // Unique coords to avoid cache collision
    const result = await reverseGeocode(51.5074, -0.1278)

    expect(result.displayName).toBe("51.5074, -0.1278")
  })

  it("selects nearest provider using Haversine distance", async () => {
    const NEAR = makeProvider({ lat: -23.55, lng: -46.63, street: "Perto", district: "Centro", cep: "01001-000" })
    const FAR = makeProvider({ lat: -23.56, lng: -46.64, street: "Longe", district: "Vila Mariana", cep: "04001-000" })
    mockDb.user.findMany.mockResolvedValue([FAR, NEAR])

    const { reverseGeocode } = await import("../geo")
    const result = await reverseGeocode(-23.55, -46.63)

    // Should pick NEAR (almost 0km) over FAR
    expect(result.road).toBe("Perto")
    expect(result.city).toBe("São Paulo")
  })

  it("builds displayName from nearest provider's address fields", async () => {
    mockDb.user.findMany.mockResolvedValue([MOCK_PROVIDER_SP])
    const { reverseGeocode } = await import("../geo")
    const result = await reverseGeocode(-23.5505, -46.6333)

    expect(result.displayName).toBe("Rua Augusta, Consolação, São Paulo, SP")
  })

  it("filters for active PROVIDERs with non-null lat/lng", async () => {
    mockDb.user.findMany.mockResolvedValue([MOCK_PROVIDER_SP])
    const { reverseGeocode } = await import("../geo")
    // Unique coords to avoid cache collision
    await reverseGeocode(41.9028, 12.4964)

    expect(mockDb.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: "PROVIDER",
          active: true,
          lat: { not: null },
          lng: { not: null },
        },
        take: 5,
        orderBy: { avgRating: "desc" },
      }),
    )
  })

  it("skips providers with null lat/lng when computing nearest", async () => {
    const PARTIAL = makeProvider({
      lat: null as unknown as number,
      lng: null as unknown as number,
      street: "Sem Coordenadas", city: "Nowhere", state: "XX", cep: null,
    })
    mockDb.user.findMany.mockResolvedValue([PARTIAL, MOCK_PROVIDER_SP])

    const { reverseGeocode } = await import("../geo")
    const result = await reverseGeocode(-23.5505, -46.6333)

    // Should skip PARTIAL (null lat/lng) and return SP provider
    expect(result.road).toBe("Rua Augusta")
    expect(result.city).toBe("São Paulo")
  })
})
