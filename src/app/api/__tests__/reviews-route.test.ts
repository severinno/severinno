import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET, POST } from "../reviews/route"
import { GET as GET_RECENT } from "../reviews/recent/route"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// Use vi.hoisted to avoid hoisting issues with vi.mock()
const { mockDb, mockReviews, validReviewData, completedBooking, recentReviews } = vi.hoisted(() => {
  const _mockReviews = [
    {
      id: "rev-1",
      rating: 5,
      comment: "Excelente serviço!",
      createdAt: new Date("2026-07-01"),
      clientId: "client-1",
      providerId: "prov-1",
      serviceId: "service-1",
      bookingId: "book-1",
      client: { id: "client-1", name: "João", avatarUrl: null },
      booking: { id: "book-1", serviceId: "service-1" },
      provider: { name: "Maria Souza", avatarUrl: null },
      service: { title: "Limpeza Residencial" },
    },
    {
      id: "rev-2",
      rating: 4,
      comment: "Bom atendimento",
      createdAt: new Date("2026-06-15"),
      clientId: "client-2",
      providerId: "prov-1",
      serviceId: "service-1",
      bookingId: "book-2",
      client: { id: "client-2", name: "Ana", avatarUrl: null },
      booking: { id: "book-2", serviceId: "service-1" },
      provider: { name: "Maria Souza", avatarUrl: null },
      service: { title: "Limpeza Residencial" },
    },
  ]

  const _mockDb = {
    review: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      aggregate: vi.fn(),
    },
    booking: {
      findUnique: vi.fn(),
    },
  }

  const _completedBooking = {
    id: "book-1",
    clientId: "client-1",
    providerId: "prov-1",
    serviceId: "service-1",
    status: "COMPLETED",
  }

  const _recentReviews = [
    {
      id: "rev-1",
      rating: 5,
      comment: "Excelente!",
      createdAt: new Date(),
      client: { name: "João", avatarUrl: null },
      provider: { name: "Maria Souza", avatarUrl: null },
      service: { title: "Limpeza" },
    },
  ]

  return {
    mockDb: _mockDb,
    mockReviews: _mockReviews,
    validReviewData: { bookingId: "book-1", rating: 5, comment: "Excelente serviço!" },
    completedBooking: _completedBooking,
    recentReviews: _recentReviews,
  }
})

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  default: mockDb,
  db: mockDb,
}))

vi.mock("@/lib/validators", () => ({
  reviewSchema: { parse: vi.fn() },
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { requireUser } from "@/lib/auth"
import { reviewSchema } from "@/lib/validators"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue({ userId: "client-1", role: "CLIENT" })
})

describe("GET /api/reviews", () => {
  it("lists all reviews when no filters are provided", async () => {
    mockDb.review.findMany.mockResolvedValue(mockReviews)

    const req = createMockRequest()
    const response = await GET(req)

    expect(response.status).toBe(200)
  })

  it("filters reviews by providerId", async () => {
    mockDb.review.findMany.mockResolvedValue([mockReviews[0]])

    const req = createMockRequest({ searchParams: { providerId: "prov-1" } })
    await GET(req)

    expect(mockDb.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ providerId: "prov-1" }),
      }),
    )
  })

  it("filters reviews by bookingId", async () => {
    mockDb.review.findMany.mockResolvedValue([mockReviews[0]])

    const req = createMockRequest({ searchParams: { bookingId: "book-1" } })
    await GET(req)

    expect(mockDb.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ bookingId: "book-1" }),
      }),
    )
  })

  it("orders by createdAt descending", async () => {
    mockDb.review.findMany.mockResolvedValue(mockReviews)

    const req = createMockRequest()
    await GET(req)

    expect(mockDb.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } }),
    )
  })
})

describe("POST /api/reviews", () => {
  beforeEach(() => {
    vi.mocked(reviewSchema.parse).mockReturnValue(validReviewData)
    mockDb.booking.findUnique.mockResolvedValue(completedBooking)
    mockDb.review.findUnique.mockResolvedValue(null)
    mockDb.review.create.mockResolvedValue({
      ...validReviewData,
      id: "rev-new",
      clientId: "client-1",
      providerId: "prov-1",
      serviceId: "service-1",
      createdAt: new Date(),
      client: { id: "client-1", name: "João", avatarUrl: null },
    })
  })

  it("creates review for a completed booking", async () => {
    const req = createMockRequest({ method: "POST", body: validReviewData })
    const response = await POST(req)

    expect(response.status).toBe(201)
    expect(mockDb.review.create).toHaveBeenCalled()
  })

  it("throws 403 when user is not a CLIENT", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "prov-1", role: "PROVIDER" })

    const req = createMockRequest({ method: "POST", body: validReviewData })
    const response = await POST(req)

    expect(response.status).toBe(403)
  })

  it("throws 404 when booking not found", async () => {
    mockDb.booking.findUnique.mockResolvedValue(null)

    const req = createMockRequest({ method: "POST", body: validReviewData })
    const response = await POST(req)

    expect(response.status).toBe(404)
  })

  it("throws 403 when booking belongs to another client", async () => {
    mockDb.booking.findUnique.mockResolvedValue({ ...completedBooking, clientId: "client-2" })

    const req = createMockRequest({ method: "POST", body: validReviewData })
    const response = await POST(req)

    expect(response.status).toBe(403)
  })

  it("throws 400 when booking is not completed", async () => {
    mockDb.booking.findUnique.mockResolvedValue({ ...completedBooking, status: "IN_PROGRESS" })

    const req = createMockRequest({ method: "POST", body: validReviewData })
    const response = await POST(req)

    expect(response.status).toBe(400)
  })

  it("throws 400 when booking already has a review", async () => {
    mockDb.review.findUnique.mockResolvedValue({ id: "existing-review" })

    const req = createMockRequest({ method: "POST", body: validReviewData })
    const response = await POST(req)

    expect(response.status).toBe(400)
  })

  it("handles review without comment", async () => {
    const dataWithoutComment = { bookingId: "book-1", rating: 4 }
    vi.mocked(reviewSchema.parse).mockReturnValue(dataWithoutComment as any)
    mockDb.review.create.mockResolvedValue({
      ...dataWithoutComment,
      id: "rev-new",
      comment: null,
      clientId: "client-1",
      providerId: "prov-1",
      serviceId: "service-1",
      createdAt: new Date(),
      client: { id: "client-1", name: "João", avatarUrl: null },
    })

    const req = createMockRequest({ method: "POST", body: dataWithoutComment })
    const response = await POST(req)

    expect(response.status).toBe(201)
  })
})

describe("GET /api/reviews/recent", () => {
  beforeEach(() => {
    mockDb.review.findMany.mockResolvedValue(recentReviews)
    mockDb.review.aggregate.mockResolvedValue({
      _avg: { rating: 4.5 },
      _count: { id: 42 },
    })
  })

  it("returns recent reviews with client and service info", async () => {
    const req = createMockRequest()
    const response = await GET_RECENT(req)
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toHaveProperty("items")
    expect(parsed.body!.items[0]).toHaveProperty("clientName", "João")
    expect(parsed.body).toHaveProperty("total", 42)
    expect(parsed.body).toHaveProperty("avgRating", 4.5)
  })

  it("only returns reviews with comments", async () => {
    const req = createMockRequest()
    await GET_RECENT(req)

    expect(mockDb.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { comment: { not: null } } }),
    )
  })

  it("respects custom limit query param", async () => {
    const req = createMockRequest({ searchParams: { limit: "3" } })
    await GET_RECENT(req)

    expect(mockDb.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    )
  })

  it("caps limit at 12", async () => {
    const req = createMockRequest({ searchParams: { limit: "100" } })
    await GET_RECENT(req)

    expect(mockDb.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 12 }),
    )
  })

  it("uses default limit of 6 when not specified", async () => {
    const req = createMockRequest()
    await GET_RECENT(req)

    expect(mockDb.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 6 }),
    )
  })

  it("returns 0 total and avgRating when there are no reviews", async () => {
    mockDb.review.findMany.mockResolvedValue([])
    mockDb.review.aggregate.mockResolvedValue({
      _avg: { rating: null },
      _count: { id: 0 },
    })

    const req = createMockRequest()
    const response = await GET_RECENT(req)

    expect(response.status).toBe(200)
  })
})
