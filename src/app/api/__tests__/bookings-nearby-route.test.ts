// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/with-rate-limit", () => ({
  withRateLimit: (handler: (...args: unknown[]) => unknown) => handler,
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))

let _mockSession: { userId: string; role: "CLIENT" | "PROVIDER" | "ADMIN" } | null = null

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockImplementation(async () => {
    const s = _mockSession
    if (!s) throw new Error("UNAUTHORIZED")
    return s
  }),
}))

vi.mock("@/lib/redis", () => ({
  withCache: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
}))

vi.mock("@/lib/postgis", () => ({
  isPostGISAvailable: vi.fn(),
  findProvidersWithinRadius: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(),
    },
  },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET as nearbyProviders } from "../bookings/nearby/route"
import { isPostGISAvailable, findProvidersWithinRadius } from "@/lib/postgis"
import { db } from "@/lib/db"

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/bookings/nearby", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = { userId: "client-1", role: "CLIENT" }
  })

  const mockUsers = [
    {
      id: "prov-1",
      name: "Carlos Prestador",
      avatarUrl: null,
      lat: -23.55,
      lng: -46.633,
      avgRating: 4.8,
    },
  ]

  it("returns 400 when lat/lng are missing", async () => {
    const req = createMockRequest()
    const res = await nearbyProviders(req)

    expect(res.status).toBe(400)
  })

  it("returns 400 when lat/lng are not numbers", async () => {
    const req = createMockRequest({ searchParams: { lat: "abc", lng: "xyz" } })
    const res = await nearbyProviders(req)

    expect(res.status).toBe(400)
  })

  it("returns 400 when radius is not positive", async () => {
    const req = createMockRequest({
      searchParams: { lat: "-23.55", lng: "-46.63", radius: "0" },
    })
    const res = await nearbyProviders(req)

    expect(res.status).toBe(400)
  })

  it("uses PostGIS path when available and returns nearby providers", async () => {
    vi.mocked(isPostGISAvailable).mockResolvedValue(true)
    vi.mocked(findProvidersWithinRadius).mockResolvedValue([
      { id: "prov-1", distanceKm: 3.2 },
    ])
    vi.mocked(db.user.findMany).mockResolvedValue(mockUsers)

    const req = createMockRequest({
      searchParams: { lat: "-23.55", lng: "-46.63", radius: "10" },
    })
    const res = await nearbyProviders(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(findProvidersWithinRadius).toHaveBeenCalledWith(-23.55, -46.63, 10)
    expect((parsed.body as any).total).toBe(1)
    expect((parsed.body as any).items[0]).toMatchObject({
      id: "prov-1",
      name: "Carlos Prestador",
      distanceKm: 3.2,
    })
    expect((parsed.body as any).center).toEqual({ lat: -23.55, lng: -46.63 })
  })

  it("caps radius at 50 km", async () => {
    vi.mocked(isPostGISAvailable).mockResolvedValue(true)
    vi.mocked(findProvidersWithinRadius).mockResolvedValue([])
    vi.mocked(db.user.findMany).mockResolvedValue([])

    const req = createMockRequest({
      searchParams: { lat: "-23.55", lng: "-46.63", radius: "500" },
    })
    const res = await nearbyProviders(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).radiusKm).toBe(50)
  })

  it("falls back to Haversine when PostGIS is unavailable", async () => {
    vi.mocked(isPostGISAvailable).mockResolvedValue(false)
    vi.mocked(db.user.findMany).mockResolvedValue(mockUsers)

    const req = createMockRequest({
      searchParams: { lat: "-23.55", lng: "-46.6333", radius: "5" },
    })
    const res = await nearbyProviders(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(findProvidersWithinRadius).not.toHaveBeenCalled()
    expect((parsed.body as any).total).toBe(1)
    expect((parsed.body as any).items[0].distanceKm).toBeCloseTo(0, 1)
  })

  it("returns empty items when no providers are nearby", async () => {
    vi.mocked(isPostGISAvailable).mockResolvedValue(true)
    vi.mocked(findProvidersWithinRadius).mockResolvedValue([])
    vi.mocked(db.user.findMany).mockResolvedValue([])

    const req = createMockRequest({
      searchParams: { lat: "-23.55", lng: "-46.63", radius: "10" },
    })
    const res = await nearbyProviders(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).items).toEqual([])
    expect((parsed.body as any).total).toBe(0)
  })
})
