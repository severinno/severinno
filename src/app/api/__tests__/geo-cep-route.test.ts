import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../geo/cep/route"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// Mock the geo module (server-side ViaCEP call)
vi.mock("@/lib/geo", () => ({
  geocodeCEP: vi.fn(),
}))

import { geocodeCEP } from "@/lib/geo"

const validAddress = {
  cep: "01310-100",
  street: "Avenida Paulista",
  district: "Bela Vista",
  city: "São Paulo",
  state: "SP",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/geo/cep", () => {
  it("returns address data for valid CEP", async () => {
    vi.mocked(geocodeCEP).mockResolvedValue(validAddress)

    const req = createMockRequest({ searchParams: { cep: "01310100" } })
    const response = await GET(req)
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toEqual(validAddress)
  })

  it("returns 400 when geocodeCEP throws (missing CEP)", async () => {
    // The route passes the raw cep to geocodeCEP; empty string should reject
    vi.mocked(geocodeCEP).mockRejectedValue(new Error("CEP inválido"))

    const req = createMockRequest()
    const response = await GET(req)
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(400)
    expect(parsed.body).toHaveProperty("error")
  })

  it("returns 400 when geocodeCEP throws (invalid CEP)", async () => {
    vi.mocked(geocodeCEP).mockRejectedValue(new Error("CEP inválido"))

    const req = createMockRequest({ searchParams: { cep: "123" } })
    const response = await GET(req)
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(400)
    expect(parsed.body).toHaveProperty("error")
  })

  it("normalizes CEP with mask", async () => {
    vi.mocked(geocodeCEP).mockResolvedValue(validAddress)

    const req = createMockRequest({ searchParams: { cep: "01310-100" } })
    const response = await GET(req)
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toHaveProperty("street", "Avenida Paulista")
  })

  it("returns 400 with upstream message when ViaCEP is unavailable", async () => {
    vi.mocked(geocodeCEP).mockRejectedValue(new Error("ViaCEP HTTP 502"))

    const req = createMockRequest({ searchParams: { cep: "01310100" } })
    const response = await GET(req)
    const parsed = await parseResponse(response)

    // A release mapeia qualquer Error do geocodeCEP para 400 com a mensagem
    // do provider (a main usava handleError → 500 com mensagem neutra).
    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("ViaCEP")
  })

  // ── Cache contract (withGeoMiddleware → cacheControlPublic) ────────────

  it("sets house cache headers on 200 (max-age=60, s-maxage=60 + full Vary)", async () => {
    vi.mocked(geocodeCEP).mockResolvedValue(validAddress)

    const req = createMockRequest({ searchParams: { cep: "01310100" } })
    const response = await GET(req)

    expect(response.status).toBe(200)
    // Same contract as routes that call cacheControlPublic directly —
    // asserted here to lock the alignment (see docs/CACHE_STRATEGY.md).
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=60")
    expect(response.headers.get("Vary")).toBe("Accept-Encoding, Accept, Origin")
    expect(response.headers.get("Content-Type")).toBe("application/json")
  })

  it("never caches errors — 400 responses carry no-store", async () => {
    vi.mocked(geocodeCEP).mockRejectedValue(new Error("CEP inválido"))

    const req = createMockRequest({ searchParams: { cep: "123" } })
    const response = await GET(req)

    expect(response.status).toBe(400)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })
})
