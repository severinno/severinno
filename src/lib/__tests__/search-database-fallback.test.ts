import { describe, it, expect, vi, beforeEach } from "vitest"
import { searchServicesDatabase } from "../search-database-fallback"
import { db } from "../db"

vi.mock("@/lib/db", () => ({
  db: {
    service: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

describe("searchServicesDatabase (src/lib/search-database-fallback.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns empty result on empty or whitespace query", async () => {
    const res = await searchServicesDatabase("   ")
    expect(res.items).toEqual([])
    expect(res.total).toBe(0)
    expect(db.service.findMany).not.toHaveBeenCalled()
  })

  it("expands query with category synonyms and finds matching services", async () => {
    const mockServices = [
      {
        id: "srv-1",
        providerId: "prov-1",
        title: "Encanador Residencial e Conserto de Torneira",
        description: "Reparo de vazamento em pia, cano e esgoto",
        basePrice: 150.0,
        unit: "serviço",
        active: true,
        createdAt: new Date("2026-01-01T12:00:00Z"),
        category: { name: "Encanador / Desentupidor" },
        provider: {
          id: "prov-1",
          name: "Carlos Encanador",
        },
      },
    ]

    vi.mocked(db.service.findMany).mockResolvedValue(mockServices as any)
    vi.mocked(db.service.count).mockResolvedValue(1)

    // User searches for "torneira pingando", which should match via synonyms
    const result = await searchServicesDatabase("torneira pingando", 1, 10)

    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe("srv-1")
    expect(result.items[0].providerName).toBe("Carlos Encanador")
    expect(result.items[0]._score).toBeGreaterThan(0.5)
    expect(result.total).toBe(1)
    expect(db.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          OR: expect.arrayContaining([
            expect.objectContaining({
              title: { contains: "torneira pingando", mode: "insensitive" },
            }),
          ]),
        }),
      }),
    )
  })
})
