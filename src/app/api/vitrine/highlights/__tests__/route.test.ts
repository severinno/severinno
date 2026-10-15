import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../route"
import { db } from "@/lib/db"

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      groupBy: vi.fn(),
      count: vi.fn(),
    },
    service: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    category: {
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    review: {
      aggregate: vi.fn(),
    },
  },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: {
    general: { key: "general", interval: 60, max: 100 },
  },
}))

vi.mock("@/lib/redis", () => ({
  withCache: vi.fn((_key, fn) => fn()),
}))

describe("GET /api/vitrine/highlights", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns enriched vitrine highlights with trending services, macro categories and top providers", async () => {
    vi.mocked(db.booking.groupBy).mockResolvedValue([
      { serviceId: "srv-1", _count: { id: 25 } },
    ] as any)

    vi.mocked(db.service.findMany).mockResolvedValue([
      {
        id: "srv-1",
        title: "Pintura Residencial",
        basePrice: "150",
        unit: "dia",
        category: { name: "Reforma e Construção", slug: "reforma-e-construcao" },
        provider: {
          id: "prov-1",
          name: "André Silva",
          avatarUrl: null,
          avgRating: 5.0,
          reviewCount: 14,
          district: "Centro",
        },
      },
    ] as any)

    vi.mocked(db.category.findMany).mockResolvedValue([
      {
        id: "cat-1",
        name: "Reforma e Construção",
        slug: "reforma-e-construcao",
        children: [{ id: "sub-1", name: "Obra", slug: "obra" }],
      },
    ] as any)

    vi.mocked(db.service.count).mockResolvedValue(45)
    vi.mocked(db.user.count).mockResolvedValue(520)
    vi.mocked(db.booking.count).mockResolvedValue(5011)
    vi.mocked(db.review.aggregate).mockResolvedValue({ _avg: { rating: 4.9 } } as any)

    vi.mocked(db.user.findMany).mockResolvedValue([
      {
        id: "prov-gv-1",
        name: "Camila Estofados",
        avatarUrl: null,
        city: "Governador Valadares",
        district: "Ilha dos Araújos",
        avgRating: 5.0,
        reviewCount: 39,
        verified: true,
        services: [{ title: "Higienização de Sofá", basePrice: "180" }],
        _count: { bookingsAsProvider: 42 },
      },
    ] as any)

    const req = new Request("http://localhost/api/vitrine/highlights?city=Governador%20Valadares")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.city).toBe("Governador Valadares")
    expect(json.trendingServices).toHaveLength(1)
    expect(json.trendingServices[0].title).toBe("Pintura Residencial")
    expect(json.trendingServices[0].bookingCount).toBe(25)
    expect(json.topCategories).toHaveLength(1)
    expect(json.topCategories[0].name).toBe("Reforma e Construção")
    expect(json.featuredProviders).toHaveLength(1)
    expect(json.featuredProviders[0].name).toBe("Camila Estofados")
    expect(json.stats.verifiedProviders).toBe(520)
    expect(json.stats.completedBookings).toBe(5011)
    expect(json.stats.avgRating).toBe(4.9)
  })
})
