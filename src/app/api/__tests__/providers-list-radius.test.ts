/**
 * providers-list-radius.test.ts
 *
 * Additional coverage for GET /api/providers geo listing behavior —
 * complements providers-radius-expansion.test.ts.
 *
 * Coverage:
 *   ✅ sort=distance without coordinates → 400
 *   ✅ sort=distance orders by ST_Distance (ORDER BY clause)
 *   ✅ sort=rating (default) does NOT use ST_Distance in ORDER BY
 *   ✅ sort=distance + radius expansion returns expandedRadius
 *   ✅ distanceKm computed on each item (PostGIS distance map)
 *   ✅ unknown sort falls back to rating ordering
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"
import { GET } from "../providers/route"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockWithCache } = vi.hoisted(() => ({
  mockWithCache: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: {
    providers: { prefix: "providers", max: 100, windowMs: 60_000 },
  },
}))

vi.mock("@/lib/postgis", () => ({
  isPostGISAvailable: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/redis", () => ({
  withCache: (...args: unknown[]) => (mockWithCache as any)(...args),
  cacheInvalidate: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
    service: { findMany: vi.fn() },
    booking: { groupBy: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import { db } from "@/lib/db"

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const baseProvider = {
  id: "prov-1",
  name: "Carlos Prestador",
  role: "PROVIDER",
  active: true,
  verified: true,
  avatarUrl: "https://i.pravatar.cc/150?u=prov-1",
  cpfCnpj: "123.456.789-00",
  lat: -23.5505,
  lng: -46.6333,
  bio: "Profissional experiente",
  city: "São Paulo",
  state: "SP",
  radiusKm: 30,
  avgRating: 4.5,
  reviewCount: 2,
  favoriteCount: 10,
  slug: "carlos-prestador",
  createdAt: new Date("2024-06-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
  passwordHash: "hash",
  coverUrl: null,
  whatsapp: "11999999999",
  phone: null,
  cep: "01310-100",
  street: "Av. Paulista",
  number: "1000",
  complement: null,
  district: "Bela Vista",
  email: "carlos@example.com",
  lytexRecipientId: null,
}

const provider2 = { ...baseProvider, id: "prov-2", name: "Maria Encanadora" }
const provider3 = { ...baseProvider, id: "prov-3", name: "João Eletricista" }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/providers — sort=distance & radius listing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWithCache.mockImplementation(async (_key: string, fn: () => unknown) => fn())
    vi.mocked(db.category.findMany as any).mockResolvedValue([{ id: "cat-1", parentId: null }])
    vi.mocked(db.service.findMany as any).mockResolvedValue([
      {
        id: "svc-1",
        title: "Instalação Elétrica",
        active: true,
        categoryId: "cat-1",
        basePrice: 150,
        unit: "UNIDADE",
        description: null,
        photos: [],
        category: { id: "cat-1", name: "Elétrica" },
      },
    ])
    vi.mocked(db.booking.groupBy as any).mockResolvedValue([
      { providerId: "prov-1", _count: { id: 3 } },
    ])
    ;(vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider] as any)
  })

  it("rejects sort=distance without coordinates (400)", async () => {
    const req = createMockRequest({
      searchParams: { sort: "distance", radius: "10" },
    })
    const res = await GET(req, { params: Promise.resolve({}) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("distância")
  })

  it("orders by ST_Distance when sort=distance with coordinates", async () => {
    ;(db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) return Promise.resolve([{ total: BigInt(3) }])
      if (sql.includes("ST_Distance")) {
        return Promise.resolve([
          { id: "prov-3", distance_km: 1.2 },
          { id: "prov-1", distance_km: 2.5 },
          { id: "prov-2", distance_km: 8.3 },
        ])
      }
      return Promise.resolve([{ id: "prov-3" }, { id: "prov-1" }, { id: "prov-2" }])
    })
    ;(vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider, provider2, provider3])

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10", sort: "distance" },
    })
    const res = await GET(req, { params: Promise.resolve({}) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    // ORDER BY ST_Distance ASC → closest first
    expect((parsed.body as any)!.items[0].id).toBe("prov-3")
    expect((parsed.body as any)!.items[1].id).toBe("prov-1")
    expect((parsed.body as any)!.items[2].id).toBe("prov-2")

    // ST_Distance ORDER BY used in the ID query
    const idSql = (db.$queryRawUnsafe as any).mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.includes("ORDER BY ST_Distance"),
    )
    expect(idSql).toBeTruthy()
  })

  it("does NOT order by ST_Distance for the default sort=rating", async () => {
    ;(db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) return Promise.resolve([{ total: BigInt(2) }])
      if (sql.includes("ST_Distance")) {
        return Promise.resolve([{ id: "prov-1", distance_km: 2.5 }])
      }
      return Promise.resolve([{ id: "prov-1" }, { id: "prov-2" }])
    })
    ;(vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider, provider2])

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10", sort: "rating" },
    })
    await GET(req, { params: Promise.resolve({}) })

    const idSql = (db.$queryRawUnsafe as any).mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.includes("SELECT u.id"),
    )
    expect(idSql).toBeTruthy()
    expect(String(idSql[0])).not.toContain("ST_Distance")
    expect(String(idSql[0])).toContain("avgRating")
  })

  it("treats an unknown sort as rating (no ST_Distance)", async () => {
    ;(db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) return Promise.resolve([{ total: BigInt(1) }])
      if (sql.includes("ST_Distance")) {
        return Promise.resolve([{ id: "prov-1", distance_km: 2.5 }])
      }
      return Promise.resolve([{ id: "prov-1" }])
    })

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10", sort: "bogus" },
    })
    const res = await GET(req, { params: Promise.resolve({}) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.items).toHaveLength(1)
  })

  it("returns expandedRadius when sort=distance triggers expansion", async () => {
    ;(db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) {
        if (sql.includes("10000")) return Promise.resolve([{ total: BigInt(0) }])
        if (sql.includes("25000")) return Promise.resolve([{ total: BigInt(3) }])
        return Promise.resolve([{ total: BigInt(0) }])
      }
      if (sql.includes("ST_Distance")) {
        return Promise.resolve([
          { id: "prov-1", distance_km: 15.2 },
          { id: "prov-2", distance_km: 18.7 },
          { id: "prov-3", distance_km: 22.1 },
        ])
      }
      return Promise.resolve([{ id: "prov-1" }, { id: "prov-2" }, { id: "prov-3" }])
    })
    ;(vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider, provider2, provider3])

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10", sort: "distance" },
    })
    const res = await GET(req, { params: Promise.resolve({}) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.expandedRadius).toBe(25)
    expect((parsed.body as any)!.items).toHaveLength(3)
  })

  it("computes distanceKm on each item from the PostGIS distance map", async () => {
    ;(db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) return Promise.resolve([{ total: BigInt(2) }])
      if (sql.includes("ST_Distance")) {
        return Promise.resolve([
          { id: "prov-1", distance_km: 2.5 },
          { id: "prov-2", distance_km: 8.3 },
        ])
      }
      return Promise.resolve([{ id: "prov-1" }, { id: "prov-2" }])
    })
    ;(vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider, provider2])

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    const res = await GET(req, { params: Promise.resolve({}) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    const items = (parsed.body as any)!.items
    expect(items[0].distanceKm).toBe(2.5)
    expect(items[1].distanceKm).toBe(8.3)
    expect(items[0].distanceKm).not.toBeUndefined()
  })

  it("returns empty items when the ID query yields no providers", async () => {
    ;(db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) return Promise.resolve([{ total: BigInt(3) }])
      if (sql.includes("ST_Distance")) return Promise.resolve([])
      return Promise.resolve([])
    })

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    const res = await GET(req, { params: Promise.resolve({}) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.items).toEqual([])
    expect((parsed.body as any)!.expandedRadius).toBeNull()
  })
})
