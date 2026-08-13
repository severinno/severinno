/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/lib/redis", () => ({
  withCache: vi.fn((_key: string, fn: () => Promise<any>) => fn()),
  getCacheStats: vi.fn(() => ({ hits: 0, misses: 0, total: 0, hitRatio: null })),
}))

vi.mock("@/lib/geo", () => ({
  geocodeSearch: vi.fn(),
  geocodeSearchStructured: vi.fn(),
}))

vi.mock("@/lib/nominatim-rate-limit", () => ({
  rateLimitedNominatim: vi.fn((fn: () => Promise<any>) => fn()),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET as geoSearchHandler } from "../geo/search/route"
import { geocodeSearch, geocodeSearchStructured } from "@/lib/geo"

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/geo/search", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns search results for a free-form query", async () => {
    const mockResults = [{ lat: "-23.5505", lon: "-46.6333", display_name: "São Paulo, Brazil" }]
    vi.mocked(geocodeSearch).mockResolvedValue(mockResults as any)

    const req = createMockRequest({
      method: "GET",
      url: "http://localhost:3000/api/geo/search?q=S%C3%A3o+Paulo&limit=5",
    } as any)
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toEqual(mockResults)
    expect(geocodeSearch).toHaveBeenCalledWith("São Paulo", 5)
  })

  it("supports structured query with street/city/state", async () => {
    const mockResults = [
      { lat: "-23.5610", lon: "-46.6560", display_name: "Rua Augusta, São Paulo, Brazil" },
    ]
    vi.mocked(geocodeSearchStructured).mockResolvedValue(mockResults as any)

    const req = createMockRequest({
      method: "GET",
      url: "http://localhost:3000/api/geo/search?street=Rua+Augusta&city=S%C3%A3o+Paulo&state=SP&limit=3",
    } as any)
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toEqual(mockResults)
    expect(geocodeSearchStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        street: "Rua Augusta",
        city: "São Paulo",
        state: "SP",
      }),
    )
  })

  it("returns 400 when no query params are provided", async () => {
    const req = createMockRequest({
      method: "GET",
      url: "http://localhost:3000/api/geo/search",
    } as any)
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("obrigatório")
  })

  it("limits results to maximum 10", async () => {
    vi.mocked(geocodeSearch).mockResolvedValue([] as any)

    const req = createMockRequest({
      method: "GET",
      url: "http://localhost:3000/api/geo/search?q=test&limit=100",
    } as any)
    await geoSearchHandler(req)

    expect(geocodeSearch).toHaveBeenCalledWith("test", 10)
  })

  it("enforces minimum limit of 1", async () => {
    vi.mocked(geocodeSearch).mockResolvedValue([] as any)

    const req = createMockRequest({
      method: "GET",
      url: "http://localhost:3000/api/geo/search?q=test&limit=0",
    } as any)
    await geoSearchHandler(req)

    expect(geocodeSearch).toHaveBeenCalledWith("test", 1)
  })

  it("returns 502 when geocoding service fails", async () => {
    vi.mocked(geocodeSearch).mockRejectedValue(new Error("Nominatim unavailable"))

    const req = createMockRequest({
      method: "GET",
      url: "http://localhost:3000/api/geo/search?q=S%C3%A3o+Paulo",
    } as any)
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(502)
    expect((parsed.body as any).error).toBe("Nominatim unavailable")
  })

  it("supports structured query with postcode", async () => {
    const mockResults = [
      { lat: "-23.5505", lon: "-46.6333", display_name: "01310-100, São Paulo, Brazil" },
    ]
    vi.mocked(geocodeSearchStructured).mockResolvedValue(mockResults as any)

    const req = createMockRequest({
      method: "GET",
      url: "http://localhost:3000/api/geo/search?city=S%C3%A3o+Paulo&postcode=01310-100",
    } as any)
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(geocodeSearchStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        city: "São Paulo",
        postcode: "01310-100",
        country: "Brazil",
      }),
    )
  })
})
