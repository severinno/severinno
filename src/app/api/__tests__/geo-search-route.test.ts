import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/lib/redis", () => ({
  withCache: vi.fn((_key: string, fn: () => Promise<any>) => fn()),
  getCacheStats: vi.fn(() => ({ hits: 0, misses: 0, total: 0, hitRatio: null })),
  // geo-rate-limit.ts importa isRedisAvailable/getClient — sem estas chaves
  // o `isRedisAvailable()` vira 'undefined is not a function' → 500 em tudo.
  isRedisAvailable: vi.fn(() => false), // cai no fallback in-memory (ok p/ teste)
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
      searchParams: { q: "São Paulo", limit: "5" },
    })
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
      searchParams: { street: "Rua Augusta", city: "São Paulo", state: "SP", limit: "3" },
    })
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
    const req = createMockRequest({ method: "GET" })
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("obrigatório")
    // Regra da casa: erros nunca são cacheáveis
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("rejects limit above maximum (10) with 400", async () => {
    vi.mocked(geocodeSearch).mockResolvedValue([] as any)

    const req = createMockRequest({
      method: "GET",
      searchParams: { q: "test", limit: "100" },
    })
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    // geocodeSearchSchema valida limit com min(1)/max(10) — fora de range é
    // rejeitado pelo Zod (400), não clampado pela rota.
    expect(parsed.status).toBe(400)
    expect(geocodeSearch).not.toHaveBeenCalled()
    // Regra da casa: erros nunca são cacheáveis (Zod path)
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("rejects limit below minimum (1) with 400", async () => {
    vi.mocked(geocodeSearch).mockResolvedValue([] as any)

    const req = createMockRequest({
      method: "GET",
      searchParams: { q: "test", limit: "0" },
    })
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(geocodeSearch).not.toHaveBeenCalled()
  })

  it("returns 500 when geocoding service fails", async () => {
    vi.mocked(geocodeSearch).mockRejectedValue(new Error("Nominatim unavailable"))

    const req = createMockRequest({
      method: "GET",
      searchParams: { q: "São Paulo" },
    })
    const res = await geoSearchHandler(req)
    const parsed = await parseResponse(res)

    // handleError mapeia erro genérico (não-HttpError) para 500 com mensagem
    // neutra — não vaza a mensagem interna do provider upstream.
    expect(parsed.status).toBe(500)
    expect((parsed.body as any).error).toBe("Erro interno do servidor")
  })

  it("supports structured query with postcode", async () => {
    const mockResults = [
      { lat: "-23.5505", lon: "-46.6333", display_name: "01310-100, São Paulo, Brazil" },
    ]
    vi.mocked(geocodeSearchStructured).mockResolvedValue(mockResults as any)

    const req = createMockRequest({
      method: "GET",
      searchParams: { city: "São Paulo", postcode: "01310-100" },
    })
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
