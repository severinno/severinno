/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { haversineKm, formatDistance } from "../geo-shared"

// ---------------------------------------------------------------------------
// haversineKm
// ---------------------------------------------------------------------------

describe("haversineKm", () => {
  it("returns 0 for the same point", () => {
    const d = haversineKm(-23.5505, -46.6333, -23.5505, -46.6333)
    expect(d).toBe(0)
  })

  it("calculates approximate distance between São Paulo and Rio de Janeiro", () => {
    // São Paulo (approx)
    const spLat = -23.5505
    const spLng = -46.6333
    // Rio de Janeiro (approx)
    const rjLat = -22.9068
    const rjLng = -43.1729

    const d = haversineKm(spLat, spLng, rjLat, rjLng)
    // Real distance is ~360 km — allow 5% tolerance
    expect(d).toBeGreaterThan(340)
    expect(d).toBeLessThan(380)
  })

  it("calculates distance between São Paulo and New York", () => {
    const d = haversineKm(-23.5505, -46.6333, 40.7128, -74.006)
    // ~7700 km — allow 5% tolerance
    expect(d).toBeGreaterThan(7300)
    expect(d).toBeLessThan(8100)
  })

  it("handles equatorial points correctly", () => {
    // Equator, 0° and 1° longitude apart (~111km)
    const d = haversineKm(0, 0, 0, 1)
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(112)
  })

  it("handles prime meridian correctly", () => {
    // Same longitude, 1° latitude apart (~111km)
    const d = haversineKm(0, 0, 1, 0)
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(112)
  })

  it("is symmetric (A→B = B→A)", () => {
    const d1 = haversineKm(-23.55, -46.63, -22.91, -43.17)
    const d2 = haversineKm(-22.91, -43.17, -23.55, -46.63)
    expect(d1).toBeCloseTo(d2, 10)
  })

  it("handles small distances (< 1 km)", () => {
    // ~500m between two nearby points (~0.005° apart)
    const d = haversineKm(-23.5505, -46.6333, -23.5555, -46.6333)
    expect(d).toBeGreaterThan(0.4)
    expect(d).toBeLessThan(0.7)
  })

  it("handles antipodal points (opposite sides of earth)", () => {
    const d = haversineKm(0, 0, 0, 180)
    // Half the earth's circumference (~20015 km)
    expect(d).toBeGreaterThan(19000)
    expect(d).toBeLessThan(21000)
  })
})

// ---------------------------------------------------------------------------
// formatDistance
// ---------------------------------------------------------------------------

describe("formatDistance", () => {
  it("returns '—' for null", () => {
    expect(formatDistance(null)).toBe("—")
  })

  it("returns '—' for undefined", () => {
    expect(formatDistance(undefined)).toBe("—")
  })

  it("returns '—' for NaN", () => {
    expect(formatDistance(NaN)).toBe("—")
  })

  it("returns '—' for Infinity", () => {
    expect(formatDistance(Infinity)).toBe("—")
  })

  it("formats < 1 km in meters", () => {
    expect(formatDistance(0.5)).toBe("500 m")
  })

  it("formats 0 km as '0 m'", () => {
    expect(formatDistance(0)).toBe("0 m")
  })

  it("formats 0.85 km as '850 m'", () => {
    expect(formatDistance(0.85)).toBe("850 m")
  })

  it("formats 0.001 km as '1 m'", () => {
    expect(formatDistance(0.001)).toBe("1 m")
  })

  it("formats < 10 km with one decimal place (comma as separator)", () => {
    expect(formatDistance(1.2)).toBe("1,2 km")
  })

  it("formats 5.0 km as '5,0 km'", () => {
    expect(formatDistance(5.0)).toBe("5,0 km")
  })

  it("formats 9.9 km as '9,9 km'", () => {
    expect(formatDistance(9.9)).toBe("9,9 km")
  })

  it("formats >= 10 km as integer", () => {
    expect(formatDistance(10)).toBe("10 km")
  })

  it("formats 15.7 km as '16 km' (rounded)", () => {
    expect(formatDistance(15.7)).toBe("16 km")
  })

  it("formats 100 km as '100 km'", () => {
    expect(formatDistance(100)).toBe("100 km")
  })

  it("formats 1234.5 km as '1235 km' (rounded)", () => {
    expect(formatDistance(1234.5)).toBe("1235 km")
  })

  it("rounds correctly for 1.49 km → '1,5 km'", () => {
    expect(formatDistance(1.49)).toBe("1,5 km")
  })

  it("rounds correctly for 1.44 km → '1,4 km'", () => {
    expect(formatDistance(1.44)).toBe("1,4 km")
  })
})

// ---------------------------------------------------------------------------
// geocodeSearch — mocks global fetch
// ---------------------------------------------------------------------------

describe("geocodeSearch", () => {
  const NOMINATIM_MOCK_RESPONSE = [
    {
      lat: "-23.5505",
      lon: "-46.6333",
      display_name:
        "Avenida Paulista, Bela Vista, São Paulo, Região Imediata de São Paulo, Região Metropolitana de São Paulo, São Paulo, Região Sudeste, 01310-100, Brasil",
      category: "highway",
      type: "secondary",
      importance: "0.654",
      address: {
        road: "Avenida Paulista",
        neighbourhood: "Bela Vista",
        city: "São Paulo",
        state: "São Paulo",
        postcode: "01310-100",
      },
    },
    {
      lat: "-23.5515",
      lon: "-46.6343",
      display_name:
        "Rua Augusta, Consolação, São Paulo, Região Imediata de São Paulo, Região Metropolitana de São Paulo, São Paulo, Região Sudeste, 01310-100, Brasil",
      category: "highway",
      type: "residential",
      importance: "0.502",
      address: {
        road: "Rua Augusta",
        suburb: "Consolação",
        city: "São Paulo",
        state: "São Paulo",
        postcode: "01310-100",
      },
    },
  ]

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("returns parsed results for a valid query", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(NOMINATIM_MOCK_RESPONSE),
    } as Response)

    const { geocodeSearch } = await import("../geo")
    const results = await geocodeSearch("Avenida Paulista, São Paulo")

    expect(results).toHaveLength(2)

    // First result: full address, high importance
    expect(results[0].lat).toBeCloseTo(-23.5505, 4)
    expect(results[0].lng).toBeCloseTo(-46.6333, 4)
    expect(results[0].displayName).toContain("Avenida Paulista")
    expect(results[0].street).toBe("Avenida Paulista")
    expect(results[0].district).toBe("Bela Vista")
    expect(results[0].city).toBe("São Paulo")
    expect(results[0].state).toBe("São Paulo")
    expect(results[0].cep).toBe("01310-100")
    expect(results[0].importance).toBeCloseTo(0.654, 3)
  })

  it("returns empty array for empty query", async () => {
    const { geocodeSearch } = await import("../geo")
    const results = await geocodeSearch("")
    expect(results).toEqual([])
  })

  it("returns empty array for whitespace-only query", async () => {
    const { geocodeSearch } = await import("../geo")
    const results = await geocodeSearch("   ")
    expect(results).toEqual([])
  })

  it("returns empty array on HTTP error (falls back to local DB)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: () => Promise.resolve({ error: "Rate limited" }),
    } as Response)

    const { geocodeSearch } = await import("../geo")
    const results = await geocodeSearch("São Paulo")
    // Now gracefully falls back to local DB (which also fails) → returns []
    expect(results).toEqual([])
  })

  it("returns empty array on network error (falls back to local DB)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network failure"))

    const { geocodeSearch } = await import("../geo")
    const results = await geocodeSearch("São Paulo")
    // Now gracefully falls back to local DB (which also fails) → returns []
    expect(results).toEqual([])
  })

  it("clamps limit to minimum 1", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url
      // Should contain limit=1, not limit=0 or limit=-5
      expect(href).toMatch(/limit=1(&|$)/)
      return {
        ok: true,
        json: () => Promise.resolve([]),
      } as Response
    })

    const { geocodeSearch } = await import("../geo")
    const results = await geocodeSearch("Av Paulista", 0)
    expect(results).toEqual([])
  })

  it("clamps limit to maximum 10", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url
      // Should contain limit=10, not limit=15
      expect(href).toMatch(/limit=10(&|$)/)
      return {
        ok: true,
        json: () => Promise.resolve([]),
      } as Response
    })

    const { geocodeSearch } = await import("../geo")
    const results = await geocodeSearch("São Paulo", 15)
    expect(results).toEqual([])
  })

  it("passes limit=3 when asked for 3", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url
      expect(href).toMatch(/limit=3(&|$)/)
      return {
        ok: true,
        json: () => Promise.resolve([]),
      } as Response
    })

    const { geocodeSearch } = await import("../geo")
    await geocodeSearch("São Paulo", 3)
  })

  it("encodes special characters in query", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url
      // encodeURIComponent uses %20 for spaces, not +
      expect(href).toContain("q=Rua%20Augusta%2C%20S%C3%A3o%20Paulo")
      return {
        ok: true,
        json: () => Promise.resolve([]),
      } as Response
    })

    const { geocodeSearch } = await import("../geo")
    await geocodeSearch("Rua Augusta, São Paulo")
  })
})

// ---------------------------------------------------------------------------
// geocodeSearchStructured — mocks global fetch
// ---------------------------------------------------------------------------

describe("geocodeSearchStructured", () => {
  const MOCK_RESULT = [
    {
      lat: "-23.5505",
      lon: "-46.6333",
      display_name: "Avenida Paulista, São Paulo, Brasil",
      category: "highway",
      type: "secondary",
      importance: "0.701",
      address: {
        road: "Avenida Paulista",
        city: "São Paulo",
        state: "São Paulo",
        postcode: "01310-100",
      },
    },
  ]

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("returns results when street and city are provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(MOCK_RESULT),
    } as Response)

    const { geocodeSearchStructured } = await import("../geo")
    const results = await geocodeSearchStructured({
      street: "Av. Paulista",
      city: "São Paulo",
      state: "SP",
    })

    expect(results).toHaveLength(1)
    expect(results[0].street).toBe("Avenida Paulista")
    expect(results[0].city).toBe("São Paulo")
  })

  it("returns empty array when all fields are empty", async () => {
    const { geocodeSearchStructured } = await import("../geo")
    const results = await geocodeSearchStructured({})
    expect(results).toEqual([])
  })

  it("builds URL with structured=1 and individual params", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url
      expect(href).toContain("structured=1")
      expect(href).toContain("street=Av.+Paulista")
      expect(href).toContain("city=S%C3%A3o+Paulo")
      expect(href).toContain("state=SP")
      expect(href).not.toContain("country")
      expect(href).not.toContain("postcode")
      return {
        ok: true,
        json: () => Promise.resolve([]),
      } as Response
    })

    const { geocodeSearchStructured } = await import("../geo")
    await geocodeSearchStructured({ street: "Av. Paulista", city: "São Paulo", state: "SP" })
  })

  it("includes country and postcode when provided", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url
      expect(href).toContain("country=Brazil")
      expect(href).toContain("postcode=01310-100")
      return {
        ok: true,
        json: () => Promise.resolve([]),
      } as Response
    })

    const { geocodeSearchStructured } = await import("../geo")
    await geocodeSearchStructured({
      city: "São Paulo",
      country: "Brazil",
      postcode: "01310-100",
    })
  })

  it("clamps limit to minimum 1", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url
      expect(href).toMatch(/limit=1(&|$)/)
      return {
        ok: true,
        json: () => Promise.resolve([]),
      } as Response
    })

    const { geocodeSearchStructured } = await import("../geo")
    await geocodeSearchStructured({ city: "São Paulo", limit: 0 })
  })

  it("returns empty array on Nominatim HTTP error (falls back to local DB)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.resolve({}),
    } as Response)

    const { geocodeSearchStructured } = await import("../geo")
    const results = await geocodeSearchStructured({ city: "São Paulo" })
    // Now gracefully falls back to local DB (which also fails) → returns []
    expect(results).toEqual([])
  })

  it("trims whitespace from all fields", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url
      // URLSearchParams encodes spaces as +, but if whitespace wasn't trimmed
      // before set(), we'd see %20%20 (double-encoded leading space). The
      // trimmed values should NOT contain leading/trailing encoded whitespace.
      expect(href).not.toContain("%20%20")
      // After trimming, "  Av. Paulista  " becomes "Av. Paulista" which
      // URLSearchParams encodes as "Av.+Paulista"
      expect(href).toContain("street=Av.+Paulista")
      expect(href).toContain("city=S%C3%A3o+Paulo")
      expect(href).toContain("state=SP")
      return {
        ok: true,
        json: () => Promise.resolve([]),
      } as Response
    })

    const { geocodeSearchStructured } = await import("../geo")
    await geocodeSearchStructured({
      street: "  Av. Paulista  ",
      city: "  São Paulo  ",
      state: "  SP  ",
    })
  })
})
