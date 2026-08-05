import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockDb = vi.hoisted(() => ({
  user: {
    groupBy: vi.fn(),
    count: vi.fn(),
  },
  booking: {
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  quoteRequest: {
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  review: {
    aggregate: vi.fn(),
  },
  payment: {
    aggregate: vi.fn(),
    count: vi.fn(),
  },
}))

vi.mock("../db", () => ({ default: mockDb, db: mockDb }))

vi.mock("server-only", () => ({}))

import { getBusinessMetrics } from "../metrics"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getBusinessMetrics", () => {
  it("returns complete metrics structure", async () => {
    mockDb.user.groupBy.mockResolvedValue([
      { role: "CLIENT", _count: { id: 80 } },
      { role: "PROVIDER", _count: { id: 20 } },
      { role: "ADMIN", _count: { id: 2 } },
    ])
    mockDb.user.count.mockResolvedValueOnce(5).mockResolvedValueOnce(15)

    mockDb.booking.count.mockResolvedValue(30)
    mockDb.booking.groupBy.mockResolvedValue([
      { status: "PENDING", _count: { id: 10 } },
      { status: "COMPLETED", _count: { id: 15 } },
      { status: "CANCELLED", _count: { id: 5 } },
    ])

    mockDb.quoteRequest.count.mockResolvedValue(40)
    mockDb.quoteRequest.groupBy.mockResolvedValue([
      { status: "PENDING", _count: { id: 20 } },
      { status: "RESPONDED", _count: { id: 12 } },
      { status: "APPROVED", _count: { id: 8 } },
    ])

    mockDb.review.aggregate.mockResolvedValue({
      _avg: { rating: 4.5 },
      _count: { id: 50 },
    })

    mockDb.payment.aggregate.mockResolvedValue({
      _sum: { amount: 500000 },
      _count: { id: 25 },
    })
    mockDb.payment.count.mockResolvedValue(5)

    const result = await getBusinessMetrics(30)

    expect(result.users.total).toBe(102)
    expect(result.users.clients).toBe(80)
    expect(result.users.providers).toBe(20)
    expect(result.users.verifiedProviders).toBe(15)
    expect(result.users.newLast30d).toBe(5)

    expect(result.bookings.total).toBe(30)
    expect(result.bookings.completed).toBe(15)
    expect(result.bookings.cancelled).toBe(5)
    expect(result.bookings.byStatus).toEqual({ PENDING: 10, COMPLETED: 15, CANCELLED: 5 })
    expect(result.bookings.conversionRate).toBe(0.75)

    expect(result.quotes.total).toBe(40)
    expect(result.quotes.responded).toBe(20)
    expect(result.quotes.byStatus).toEqual({ PENDING: 20, RESPONDED: 12, APPROVED: 8 })
    expect(result.quotes.conversionToBooking).toBe(0.75)

    expect(result.reviews.total).toBe(50)
    expect(result.reviews.avgRating).toBe(4.5)

    expect(result.revenue.total).toBe(500000)
    expect(result.revenue.paid).toBe(25)
    expect(result.revenue.pending).toBe(5)
    expect(result.revenue.avgBookingValue).toBeCloseTo(16666.67, 0)

    expect(result.periodStart).toBeDefined()
    expect(result.periodEnd).toBeDefined()
  })

  it("handles empty data gracefully", async () => {
    mockDb.user.groupBy.mockResolvedValue([])
    mockDb.user.count.mockResolvedValue(0)

    mockDb.booking.count.mockResolvedValue(0)
    mockDb.booking.groupBy.mockResolvedValue([])

    mockDb.quoteRequest.count.mockResolvedValue(0)
    mockDb.quoteRequest.groupBy.mockResolvedValue([])

    mockDb.review.aggregate.mockResolvedValue({
      _avg: { rating: null },
      _count: { id: 0 },
    })

    mockDb.payment.aggregate.mockResolvedValue({
      _sum: { amount: null },
      _count: { id: 0 },
    })
    mockDb.payment.count.mockResolvedValue(0)

    const result = await getBusinessMetrics(30)

    expect(result.users.total).toBe(0)
    expect(result.bookings.conversionRate).toBeNull()
    expect(result.quotes.conversionToBooking).toBeNull()
    expect(result.reviews.avgRating).toBeNull()
    expect(result.revenue.avgBookingValue).toBeNull()
  })

  it("handles no verified providers", async () => {
    mockDb.user.groupBy.mockResolvedValue([
      { role: "CLIENT", _count: { id: 1 } },
      { role: "PROVIDER", _count: { id: 1 } },
    ])
    mockDb.user.count.mockResolvedValue(0)
    mockDb.booking.count.mockResolvedValue(0)
    mockDb.booking.groupBy.mockResolvedValue([])
    mockDb.quoteRequest.count.mockResolvedValue(0)
    mockDb.quoteRequest.groupBy.mockResolvedValue([])
    mockDb.review.aggregate.mockResolvedValue({ _avg: { rating: null }, _count: { id: 0 } })
    mockDb.payment.aggregate.mockResolvedValue({ _sum: { amount: null }, _count: { id: 0 } })
    mockDb.payment.count.mockResolvedValue(0)

    const result = await getBusinessMetrics(30)

    expect(result.users.verifiedProviders).toBe(0)
    expect(result.users.providers).toBe(1)
  })

  it("throws on db error", async () => {
    mockDb.user.groupBy.mockRejectedValue(new Error("connection failed"))

    await expect(getBusinessMetrics(30)).rejects.toThrow("connection failed")
  })
})
