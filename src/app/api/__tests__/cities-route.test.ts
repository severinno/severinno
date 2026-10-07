import { describe, it, expect, vi, beforeEach } from "vitest"
import { parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockFindMany = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({
  db: { city: { findMany: mockFindMany } },
}))

import { GET } from "../cities/route"

describe("GET /api/cities", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns mapped cities with provider counts", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "c1",
        name: "São Paulo",
        slug: "sao-paulo",
        state: "SP",
        lat: -23.55,
        lng: -46.63,
        _count: { providers: 42 },
      },
      {
        id: "c2",
        name: "Rio de Janeiro",
        slug: "rio-de-janeiro",
        state: "RJ",
        lat: -22.91,
        lng: -43.17,
        _count: { providers: 10 },
      },
    ])

    const res = await GET(new Request("http://localhost/test"), { params: Promise.resolve({}) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    const cities = (parsed.body as any).cities
    expect(cities).toHaveLength(2)
    expect(cities[0].name).toBe("São Paulo")
    expect(cities[0].providerCount).toBe(42)
    expect(cities[1].providerCount).toBe(10)
    expect(mockFindMany).toHaveBeenCalledOnce()
  })

  it("returns empty array when no active cities", async () => {
    mockFindMany.mockResolvedValue([])
    const res = await GET(new Request("http://localhost/test"), { params: Promise.resolve({}) })
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(200)
    expect((parsed.body as any).cities).toEqual([])
  })

  it("returns 500 on db error", async () => {
    mockFindMany.mockRejectedValue(new Error("DB connection failed"))
    const res = await GET(new Request("http://localhost/test"), { params: Promise.resolve({}) })
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(500)
  })
})
