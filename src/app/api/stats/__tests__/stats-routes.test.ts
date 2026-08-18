import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET as getPublicStats } from "@/app/api/stats/public/route"
import { GET as getActivityStats } from "@/app/api/stats/activity/route"
import { db } from "@/lib/db"

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    service: {
      count: vi.fn(),
    },
    review: {
      count: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    booking: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    quoteRequest: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

describe("GET /api/stats/public & /api/stats/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns public stats summary", async () => {
    vi.mocked(db.user.count).mockResolvedValue(100)
    vi.mocked(db.service.count).mockResolvedValue(50)
    vi.mocked(db.review.count).mockResolvedValue(30)
    vi.mocked(db.booking.count).mockResolvedValue(40)
    vi.mocked(db.review.aggregate).mockResolvedValue({ _avg: { rating: 4.8 } } as any)

    const res = await getPublicStats()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.providers).toBe(100)
    expect(json.avgRating).toBe(4.8)
  })

  it("returns recent platform activity feed", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      {
        id: "b1",
        createdAt: new Date(),
        client: { name: "Maria Silva", avatarUrl: null, city: "Curitiba" },
        service: { title: "Limpeza", category: { name: "Diarista" } },
      } as any,
    ])
    vi.mocked(db.review.findMany).mockResolvedValue([])
    vi.mocked(db.user.findMany).mockResolvedValue([])
    vi.mocked(db.quoteRequest.findMany).mockResolvedValue([])
    vi.mocked(db.quoteRequest.count).mockResolvedValue(5)

    const res = await getActivityStats()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.activities).toHaveLength(1)
    expect(json.activities[0].action).toBe("agendou")
    expect(json.quotesToday).toBe(5)
  })
})
