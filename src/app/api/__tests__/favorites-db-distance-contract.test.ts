import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../favorites/route"
import { createMockRequest } from "@/lib/__tests__/helpers/api-test-utils"

/**
 * favorites-db-distance-contract.test.ts
 *
 * Contract pin of the scale-risk #1 closing (melhorias-otimizacoes.md item 1)
 * applied to the favorites listing: distances are computed DB-FIRST via a
 * single PostGIS ST_Distance batch query (computeDistanceMap), never as a
 * per-item in-memory Haversine loop. Haversine remains ONLY as the fallback
 * when the PostGIS query fails (graceful degradation preserved).
 *
 * Contract surfaces:
 *   1. DB-first: with geo, the response distanceKm equals the DB-returned
 *      values (even when they differ from what Haversine would compute).
 *   2. Fallback: when the DB distance query fails, distances still resolve
 *      via Haversine (degradation, not breakage).
 *   3. No-geo: no DB distance query is issued and distances are null.
 */

const { mockFavorites, mockDb } = vi.hoisted(() => {
  const mockFavorites = [
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
        services: [
          { id: "svc-1", title: "Limpeza", active: true, category: { id: "cat-1", name: "Doméstico", slug: "domestico" } },
        ],
        reviewsReceived: [{ rating: 5 }, { rating: 4 }],
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
        services: [
          { id: "svc-2", title: "Pintura", active: true, category: { id: "cat-2", name: "Reforma", slug: "reforma" } },
        ],
        reviewsReceived: [{ rating: 5 }],
        _count: { bookingsAsProvider: 0 },
      },
    },
  ]
  return {
    mockFavorites,
    mockDb: {
      favorite: { findMany: vi.fn() },
      $queryRawUnsafe: vi.fn(),
    },
  }
})

vi.mock("@/lib/db", () => ({ default: mockDb, db: mockDb }))
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }))
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { requireUser } from "@/lib/auth"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue({ userId: "client-1", role: "CLIENT" })
  mockDb.favorite.findMany.mockResolvedValue(mockFavorites)
})

describe("GET /api/favorites — DB-first distance contract", () => {
  it("uses the DB ST_Distance values (DB-first, not in-memory Haversine)", async () => {
    // DB returns distances that DIFFER from what Haversine would compute for
    // these coordinates: prov-1 is at the user's own point (-23.5,-46.6), so
    // Haversine would say 0 — the response MUST carry the DB value instead.
    mockDb.$queryRawUnsafe.mockResolvedValue([
      { id: "prov-1", distance_km: 7.7 },
      { id: "prov-2", distance_km: 12.3 },
    ])

    const response = await GET(
      createMockRequest({ searchParams: { lat: "-23.5", lng: "-46.6" } }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data[0].distanceKm).toBe(7.7) // NOT 0 (Haversine would say 0)
    expect(data[1].distanceKm).toBe(12.3)

    // Exactly one batch distance query, carrying ST_Distance + all ids.
    // computeDistanceMap calls: queryRawUnsafe(sql, lng, lat, providerIds)
    expect(mockDb.$queryRawUnsafe).toHaveBeenCalledTimes(1)
    const sql = mockDb.$queryRawUnsafe.mock.calls[0]?.[0] as string
    expect(sql).toContain("ST_Distance")
    const args = mockDb.$queryRawUnsafe.mock.calls[0] as unknown[]
    expect(args[3]).toEqual(["prov-1", "prov-2"])
  })

  it("falls back to Haversine when the DB distance query fails (degradation preserved)", async () => {
    mockDb.$queryRawUnsafe.mockRejectedValue(new Error("PostGIS connection lost"))

    const response = await GET(
      createMockRequest({ searchParams: { lat: "-23.5", lng: "-46.6" } }),
    )
    const data = await response.json()

    // Graceful: still 200, distances resolved via the Haversine fallback
    expect(response.status).toBe(200)
    for (const item of data) {
      expect(typeof item.distanceKm).toBe("number")
    }
  })

  it("does not issue any DB distance query when no geo params (distances null)", async () => {
    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data[0].distanceKm).toBeNull()
    expect(data[1].distanceKm).toBeNull()
    expect(mockDb.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it("keeps the ProviderCard[] shape (no pagination envelope — by design)", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([])

    const response = await GET(
      createMockRequest({ searchParams: { lat: "-23.5", lng: "-46.6" } }),
    )
    const data = await response.json()

    // The client contract is a bare array (fetchFavorites -> ProviderCard[])
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(2)
    expect(data[0]).not.toHaveProperty("passwordHash")
    expect(data[0]).not.toHaveProperty("reviewsReceived")
  })
})
