import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET as searchGeneral } from "@/app/api/search/route"
import { GET as searchProvidersRoute } from "@/app/api/search/providers/route"
import { GET as searchServicesRoute } from "@/app/api/search/services/route"
import { fullTextSearch, searchProviders, searchServices } from "@/lib/search"

vi.mock("@/lib/search", () => ({
  fullTextSearch: vi.fn(),
  searchProviders: vi.fn(),
  searchServices: vi.fn(),
}))

describe("Search API Routes (/api/search, /api/search/providers, /api/search/services)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("handles general search queries", async () => {
    vi.mocked(fullTextSearch).mockResolvedValue([
      { id: "p1", title: "Carlos Pintor", type: "provider" } as any,
    ])

    const req = new Request("http://localhost:3000/api/search?q=pintor")
    const res = await searchGeneral(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.items).toHaveLength(1)
    expect(json.q).toBe("pintor")
  })

  it("returns empty array for short search queries", async () => {
    const req = new Request("http://localhost:3000/api/search?q=a")
    const res = await searchGeneral(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.items).toEqual([])
  })

  it("searches providers with geo parameters and sorting", async () => {
    vi.mocked(searchProviders).mockResolvedValue({
      items: [{ id: "p1", name: "Eletricista Pro" } as any],
      total: 1,
      page: 1,
      limit: 20,
      took: 5,
    })

    const req = new Request(
      "http://localhost:3000/api/search/providers?q=eletricista&lat=-23.55&lng=-46.63&sort=distance",
    )
    const res = await searchProvidersRoute(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.items).toHaveLength(1)
    expect(json.engine).toBe("opensearch")
    expect(searchProviders).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "eletricista",
        lat: -23.55,
        lng: -46.63,
        sort: "distance",
      }),
    )
  })

  it("searches services by term", async () => {
    vi.mocked(searchServices).mockResolvedValue({
      items: [{ id: "s1", title: "Pintura Residencial" } as any],
      total: 1,
      page: 1,
      limit: 20,
      took: 3,
    })

    const req = new Request("http://localhost:3000/api/search/services?q=pintura")
    const res = await searchServicesRoute(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.items).toHaveLength(1)
  })

  it("returns 400 when service search term is missing", async () => {
    const req = new Request("http://localhost:3000/api/search/services")
    const res = await searchServicesRoute(req)

    expect(res.status).toBe(400)
  })
})
