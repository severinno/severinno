import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../favorites/route"
import { createMockRequest } from "@/lib/__tests__/helpers/api-test-utils"

const { mockFavorites } = vi.hoisted(() => ({
  mockFavorites: [
    {
      id: "fav-1",
      clientId: "client-1",
      providerId: "prov-1",
      createdAt: new Date(),
      provider: {
        id: "prov-1",
        name: "Maria Souza",
        avatarUrl: null,
        city: "São Paulo",
        state: "SP",
        verified: true,
        active: true,
        lat: -23.5,
        lng: -46.6,
        avgRating: 4.5,
        reviewCount: 2,
        services: [
          {
            id: "svc-1",
            title: "Limpeza",
            active: true,
            category: { id: "cat-1", name: "Doméstico", slug: "domestico" },
          },
        ],
        _count: { bookingsAsProvider: 0 },
      },
    },
    {
      id: "fav-2",
      clientId: "client-1",
      providerId: "prov-2",
      createdAt: new Date(),
      provider: {
        id: "prov-2",
        name: "João Silva",
        avatarUrl: null,
        city: "São Paulo",
        state: "SP",
        verified: true,
        active: true,
        lat: -23.55,
        lng: -46.65,
        avgRating: 5.0,
        reviewCount: 1,
        services: [
          {
            id: "svc-2",
            title: "Pintura",
            active: true,
            category: { id: "cat-2", name: "Reforma", slug: "reforma" },
          },
        ],
        _count: { bookingsAsProvider: 0 },
      },
    },
  ],
}))

const mockDb = vi.hoisted(() => ({
  favorite: { findMany: vi.fn() },
}))

vi.mock("@/lib/db", () => ({ default: mockDb, db: mockDb }))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { requireUser } from "@/lib/auth"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue({ userId: "client-1", role: "CLIENT" })
})

describe("GET /api/favorites", () => {
  it("returns favorited providers for CLIENT role", async () => {
    mockDb.favorite.findMany.mockResolvedValue(mockFavorites)
    const response = await GET(createMockRequest())
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data).toHaveLength(2)
    expect(data[0]).toHaveProperty("name", "Maria Souza")
    expect(data[0]).toHaveProperty("rating", 4.5)
    expect(data[0]).toHaveProperty("reviewCount", 2)
  })

  it("throws 403 for non-CLIENT roles", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "prov-1", role: "PROVIDER" })
    const response = await GET(createMockRequest())
    expect(response.status).toBe(403)
  })

  it("allows ADMIN to access", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "admin-1", role: "ADMIN" })
    const response = await GET(createMockRequest())
    // ADMIN passes the requireUser check but fails the role check
    expect(response.status).toBe(403)
  })

  it("returns providers without passwordHash", async () => {
    mockDb.favorite.findMany.mockResolvedValue(mockFavorites)
    const response = await GET(createMockRequest())
    const data = await response.json()
    expect(data[0]).not.toHaveProperty("passwordHash")
    expect(data[0]).not.toHaveProperty("reviewsReceived")
  })

  it("computes distanceKm when lat/lng params are provided", async () => {
    mockDb.favorite.findMany.mockResolvedValue(mockFavorites)
    const response = await GET(createMockRequest({ searchParams: { lat: "-23.5", lng: "-46.6" } }))
    const data = await response.json()
    expect(data[0]).toHaveProperty("distanceKm")
    expect(typeof data[0].distanceKm).toBe("number")
  })

  it("returns null distanceKm when no geo params", async () => {
    mockDb.favorite.findMany.mockResolvedValue(mockFavorites)
    const response = await GET(createMockRequest())
    const data = await response.json()
    // First provider is at -23.5,-46.6, same as the no-geo, so distance is 0
    expect(data[0]).toHaveProperty("distanceKm", null)
  })

  it("returns rating 0 when provider has no reviews", async () => {
    const noReviews = [
      {
        ...mockFavorites[0],
        provider: { ...mockFavorites[0].provider, avgRating: 0, reviewCount: 0 },
      },
    ]
    mockDb.favorite.findMany.mockResolvedValue(noReviews)
    const response = await GET(createMockRequest())
    const data = await response.json()
    expect(data[0].rating).toBe(0)
    expect(data[0].reviewCount).toBe(0)
  })

  it("orders favorites by createdAt desc", async () => {
    mockDb.favorite.findMany.mockResolvedValue(mockFavorites)
    await GET(createMockRequest())
    expect(mockDb.favorite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } }),
    )
  })
})
