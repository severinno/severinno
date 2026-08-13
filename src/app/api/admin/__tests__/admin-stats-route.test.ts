import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "@/app/api/admin/stats/route"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      groupBy: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    service: {
      count: vi.fn(),
    },
    booking: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    quoteRequest: {
      groupBy: vi.fn(),
    },
    payment: {
      aggregate: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}))

describe("GET /api/admin/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any)
  })

  it("calculates and returns aggregate stats", async () => {
    vi.mocked(db.user.groupBy).mockResolvedValue([
      { role: "CLIENT", _count: { _all: 10 } },
      { role: "PROVIDER", _count: { _all: 5 } },
    ] as any)
    vi.mocked(db.user.count).mockResolvedValue(5)
    vi.mocked(db.service.count).mockResolvedValue(15)
    vi.mocked(db.booking.groupBy).mockResolvedValue([
      { status: "COMPLETED", _count: { _all: 8 } },
    ] as any)
    vi.mocked(db.quoteRequest.groupBy).mockResolvedValue([
      { status: "PENDING", _count: { _all: 3 } },
    ] as any)
    vi.mocked(db.payment.aggregate).mockResolvedValue({
      _sum: { amount: 5000 },
      _count: { _all: 8 },
    } as any)
    vi.mocked(db.booking.findMany).mockResolvedValue([])
    vi.mocked(db.user.findMany).mockResolvedValue([
      {
        id: "p1",
        name: "Top Provider",
        reviewsReceived: [{ rating: 5 }, { rating: 5 }],
      } as any,
    ])

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.usersByRole.CLIENT).toBe(10)
    expect(json.providers).toBe(5)
    expect(json.services).toBe(15)
    expect(json.revenue.total).toBe(5000)
    expect(json.topProviders[0].rating).toBe(5)
  })

  it("handles empty stats gracefully", async () => {
    vi.mocked(db.user.groupBy).mockResolvedValue([])
    vi.mocked(db.user.count).mockResolvedValue(0)
    vi.mocked(db.service.count).mockResolvedValue(0)
    vi.mocked(db.booking.groupBy).mockResolvedValue([])
    vi.mocked(db.quoteRequest.groupBy).mockResolvedValue([])
    vi.mocked(db.payment.aggregate).mockResolvedValue({
      _sum: { amount: null },
      _count: { _all: 0 },
    } as any)
    vi.mocked(db.booking.findMany).mockResolvedValue([])
    vi.mocked(db.user.findMany).mockResolvedValue([])

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.revenue.total).toBe(0)
    expect(json.topProviders).toEqual([])
  })
})
