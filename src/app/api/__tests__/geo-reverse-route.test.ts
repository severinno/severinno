import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../geo/reverse/route"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

vi.mock("@/lib/geo", () => ({
  reverseGeocode: vi.fn(),
}))

// Geo rate limit: mockado para evitar depender do Redis e permitir assert de
// chamada + simulação de 429.
vi.mock("@/lib/geo-rate-limit", () => ({
  assertGeoRateLimit: vi.fn(),
  isGeoRateLimitError: (e: unknown) =>
    e instanceof Error && (e as { status?: number }).status === 429,
}))

import { reverseGeocode } from "@/lib/geo"
import { assertGeoRateLimit } from "@/lib/geo-rate-limit"

const validAddress = {
  displayName: "Av. Paulista, 1000, São Paulo, SP, Brasil",
  road: "Avenida Paulista",
  neighbourhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
  postcode: "01310-100",
}

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks não limpa implementações setadas via mockRejectedValue —
  // garante que o assertGeoRateLimit sempre RESOLVE no início de cada teste.
  vi.mocked(assertGeoRateLimit).mockResolvedValue(undefined)
})

describe("GET /api/geo/reverse", () => {
  it("aplica o rate limit antes de geocodificar", async () => {
    vi.mocked(reverseGeocode).mockResolvedValue(validAddress)

    const req = createMockRequest({ searchParams: { lat: "-23.55", lng: "-46.63" } })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(vi.mocked(assertGeoRateLimit)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(assertGeoRateLimit).mock.calls[0]![0]).toBe(req)
    expect(vi.mocked(assertGeoRateLimit).mock.calls[0]![1]).toBe("reverse")
  })

  it("retorna 429 com headers quando o rate limit é excedido", async () => {
    vi.mocked(assertGeoRateLimit).mockRejectedValue(
      Object.assign(new Error("Muitas requisições. Tente novamente em alguns segundos."), {
        status: 429,
        headers: { "X-RateLimit-Limit": "30", "Retry-After": "10" },
      }),
    )

    const req = createMockRequest({ searchParams: { lat: "-23.55", lng: "-46.63" } })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(429)
    expect(parsed.body).toHaveProperty("error")
    expect(vi.mocked(reverseGeocode)).not.toHaveBeenCalled()
    // Headers de rate limit preservados (não caindo no 502 genérico)
    expect(res.headers.get("x-ratelimit-limit")).toBe("30")
    expect(res.headers.get("retry-after")).toBe("10")
    // Regra da casa: erros nunca são cacheáveis
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("returns address for valid lat/lng", async () => {
    vi.mocked(reverseGeocode).mockResolvedValue(validAddress)

    const req = createMockRequest({ searchParams: { lat: "-23.55", lng: "-46.63" } })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toMatchObject({
      street: "Avenida Paulista",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      cep: "01310-100",
    })
    // Contrato da casa nos 200 (via cacheControlPublic)
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60")
  })

  it("returns 400 when lat is missing", async () => {
    const req = createMockRequest({ searchParams: { lng: "-46.63" } })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(parsed.body).toHaveProperty("error")
    // Regra da casa: erros nunca são cacheáveis
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("returns 400 when lng is missing", async () => {
    const req = createMockRequest({ searchParams: { lat: "-23.55" } })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(parsed.body).toHaveProperty("error")
  })

  it("returns 400 when lat/lng are not finite", async () => {
    const req = createMockRequest({ searchParams: { lat: "abc", lng: "def" } })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(parsed.body).toHaveProperty("error")
    // Regra da casa: erros nunca são cacheáveis
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("returns 502 when Nominatim fails", async () => {
    vi.mocked(reverseGeocode).mockRejectedValue(new Error("Nominatim HTTP 500"))

    const req = createMockRequest({ searchParams: { lat: "-23.55", lng: "-46.63" } })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(502)
    expect(parsed.body).toHaveProperty("error")
    // Regra da casa: erros nunca são cacheáveis
    expect(res.headers.get("cache-control")).toBe("no-store")
  })
})
