/**
 * geo-search-structured.test.ts
 *
 * Additional coverage for the STRUCTURED mode of GET /api/geo/search —
 * complements geo-search-route.test.ts (free-form + basic structured).
 *
 * Coverage:
 *   ✅ Structured with street only
 *   ✅ Structured with state only
 *   ✅ Country override forwarded to the geocoder
 *   ✅ Country defaults to "Brazil" when omitted
 *   ✅ postcode-only input does NOT trigger structured mode (400)
 *   ✅ Whitespace-only structured params don't trigger structured mode
 *   ✅ Structured service failure → 500
 *   ✅ Structured with invalid limit → 400 (Zod)
 *   ✅ Cache-Control header present (public, max-age)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/lib/redis", () => ({
  withCache: vi.fn((_key: string, fn: () => Promise<any>) => fn()),
  getCacheStats: vi.fn(() => ({ hits: 0, misses: 0, total: 0, hitRatio: null })),
  isRedisAvailable: vi.fn(() => false),
  getClient: vi.fn(() => null),
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
import { geocodeSearchStructured, geocodeSearch } from "@/lib/geo"

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/geo/search — structured mode edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("supports structured query with street only", async () => {
    const mockResults = [
      { lat: "-23.5610", lon: "-46.6560", display_name: "Rua Augusta, São Paulo, Brazil" },
    ]
    vi.mocked(geocodeSearchStructured).mockResolvedValue(mockResults as any)

    const req = createMockRequest({
      method: "GET",
      searchParams: { street: "Rua Augusta" },
    })
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(geocodeSearchStructured).toHaveBeenCalledWith(
      expect.objectContaining({ street: "Rua Augusta", country: "Brazil" }),
    )
  })

  it("supports structured query with state only", async () => {
    const mockResults = [{ lat: "-19.9167", lon: "-43.9345", display_name: "Minas Gerais, Brazil" }]
    vi.mocked(geocodeSearchStructured).mockResolvedValue(mockResults as any)

    const req = createMockRequest({
      method: "GET",
      searchParams: { state: "MG" },
    })
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(geocodeSearchStructured).toHaveBeenCalledWith(
      expect.objectContaining({ state: "MG", country: "Brazil" }),
    )
  })

  it("forwards an explicit country override", async () => {
    vi.mocked(geocodeSearchStructured).mockResolvedValue([] as any)

    const req = createMockRequest({
      method: "GET",
      searchParams: { street: "Rua das Flores", city: "Lisboa", country: "Portugal" },
    })
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(geocodeSearchStructured).toHaveBeenCalledWith(
      expect.objectContaining({ country: "Portugal" }),
    )
  })

  it("defaults country to Brazil when omitted", async () => {
    vi.mocked(geocodeSearchStructured).mockResolvedValue([] as any)

    const req = createMockRequest({
      method: "GET",
      searchParams: { city: "Recife" },
    })
    await geoSearchHandler(req)

    expect(geocodeSearchStructured).toHaveBeenCalledWith(
      expect.objectContaining({ city: "Recife", country: "Brazil" }),
    )
  })

  it("does NOT trigger structured mode with postcode alone (400)", async () => {
    // hasStructured = street/city/state — postcode alone falls through to
    // the free-form path, which requires q
    const req = createMockRequest({
      method: "GET",
      searchParams: { postcode: "01310-100" },
    })
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("obrigatório")
    expect(geocodeSearchStructured).not.toHaveBeenCalled()
    expect(geocodeSearch).not.toHaveBeenCalled()
  })

  it("ignores whitespace-only structured params (400, not structured mode)", async () => {
    const req = createMockRequest({
      method: "GET",
      searchParams: { street: "   ", city: "  " },
    })
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    // street/city are whitespace-only → hasStructured = false → free-form (no q) → 400
    expect(parsed.status).toBe(400)
    expect(geocodeSearchStructured).not.toHaveBeenCalled()
  })

  it("returns 500 when the structured geocoder fails", async () => {
    vi.mocked(geocodeSearchStructured).mockRejectedValue(
      new Error("Nominatim structured unavailable"),
    )

    const req = createMockRequest({
      method: "GET",
      searchParams: { city: "Curitiba", state: "PR" },
    })
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(500)
    expect((parsed.body as any).error).toBe("Erro interno do servidor")
  })

  it("rejects an out-of-range limit in structured mode with 400", async () => {
    vi.mocked(geocodeSearchStructured).mockResolvedValue([] as any)

    const req = createMockRequest({
      method: "GET",
      searchParams: { city: "São Paulo", limit: "50" },
    })
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(geocodeSearchStructured).not.toHaveBeenCalled()
  })

  it("sets a public cache-control header with max-age", async () => {
    vi.mocked(geocodeSearchStructured).mockResolvedValue([] as any)

    const req = createMockRequest({
      method: "GET",
      searchParams: { city: "Belo Horizonte", state: "MG" },
    })
    const res = await geoSearchHandler(req)

    const cacheControl = res.headers.get("cache-control")
    expect(cacheControl).toContain("public")
    expect(cacheControl).toContain("max-age")
  })
})
