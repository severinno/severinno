import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../geo/reverse/route"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

vi.mock("@/lib/geo", () => ({
  reverseGeocode: vi.fn(),
}))

import { reverseGeocode } from "@/lib/geo"

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
})

describe("GET /api/geo/reverse", () => {
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
  })

  it("returns 400 when lat is missing", async () => {
    const req = createMockRequest({ searchParams: { lng: "-46.63" } })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(parsed.body).toHaveProperty("error")
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
  })

  it("returns 502 when Nominatim fails", async () => {
    vi.mocked(reverseGeocode).mockRejectedValue(new Error("Nominatim HTTP 500"))

    const req = createMockRequest({ searchParams: { lat: "-23.55", lng: "-46.63" } })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(502)
    expect(parsed.body).toHaveProperty("error")
  })
})
