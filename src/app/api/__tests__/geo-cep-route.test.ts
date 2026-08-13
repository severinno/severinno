/* eslint-disable @typescript-eslint/no-explicit-any */
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

  it("returns 400 when ViaCEP is unavailable", async () => {
    vi.mocked(geocodeCEP).mockRejectedValue(new Error("ViaCEP HTTP 502"))

    const req = createMockRequest({ searchParams: { cep: "01310100" } })
    const response = await GET(req)
    const parsed = await parseResponse(response)

    // Route catch block always returns 400 for generic errors
    expect(parsed.status).toBe(400)
    expect(parsed.body).toHaveProperty("error")
  })
})
