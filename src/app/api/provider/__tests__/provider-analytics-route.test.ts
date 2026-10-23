import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET as getAnalytics } from "@/app/api/provider/analytics/route"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
    },
    quoteRequest: {
      count: vi.fn(),
    },
    favorite: {
      count: vi.fn(),
    },
    review: {
      count: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}))

const USER_ID = "provider-1"

describe("GET /api/provider/analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: USER_ID, role: "PROVIDER" } as never)
  })

  it("retorna 403 se o usuário não for prestador", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "client-1", role: "CLIENT" } as never)

    const res = await getAnalytics(new Request("http://localhost:3000/api/provider/analytics"))
    expect(res.status).toBe(403)
  })

  it("calcula saldo retido em escrow, conversão de propostas e distribuição de demanda", async () => {
    // 1. Escrow bookings
    vi.mocked(db.booking.findMany)
      .mockResolvedValueOnce([
        { id: "b1", amount: 150, status: "CONFIRMED", scheduledAt: new Date() },
        { id: "b2", amount: 350, status: "IN_PROGRESS", scheduledAt: new Date() },
      ] as never) // escrow bookings
      .mockResolvedValueOnce([
        { createdAt: new Date("2026-10-10T09:15:00Z") },
        { createdAt: new Date("2026-10-10T09:45:00Z") },
        { createdAt: new Date("2026-10-10T14:30:00Z") },
      ] as never) // recent bookings for peak hours
      // 6 monthly trend calls
      .mockResolvedValue([{ amount: 500 }] as never)

    // 2. Quote counts
    vi.mocked(db.quoteRequest.count)
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(4) // accepted
      .mockResolvedValueOnce(3) // rejected
      .mockResolvedValueOnce(3) // pending

    // 3. Favorites and reviews
    vi.mocked(db.favorite.count).mockResolvedValue(12)
    vi.mocked(db.review.count).mockResolvedValue(8)
    vi.mocked(db.review.aggregate).mockResolvedValue({
      _avg: { rating: 4.8 },
    } as never)

    const res = await getAnalytics(new Request("http://localhost:3000/api/provider/analytics"))
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.escrow.retainedAmount).toBe(500)
    expect(data.escrow.heldBookingsCount).toBe(2)
    expect(data.quotes.conversionRate).toBe(40)
    expect(data.quotes.total).toBe(10)
    expect(data.quotes.accepted).toBe(4)
    expect(data.demand.hourlyDistribution.length).toBe(24)
    expect(data.engagement.favoriteCount).toBe(12)
    expect(data.engagement.avgRating).toBe(4.8)
  })
})
