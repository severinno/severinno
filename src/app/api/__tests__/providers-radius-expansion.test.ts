// @ts-nocheck
/**
 * Integration tests for progressive radius expansion in GET /api/providers.
 *
 * Mocks PostGIS as available and simulates different COUNT results per radius
 * to verify that:
 *   1. expandedRadius = null  → providers found at user's requested radius
 *   2. expandedRadius = 25    → needed to expand to 25km to find providers
 *   3. expandedRadius = -1    → no providers within 100km, unrestricted returned
 *   4. expandedRadius = null  → no providers at all in the database (empty result)
 *   5. Cache keys are correctly formed for each radius level
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"
import { GET } from "../providers/route"

// ---------------------------------------------------------------------------
// Hoisted mocks — defined before vi.mock() calls
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
import { isPostGISAvailable } from "@/lib/postgis"

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

const provider2 = {
  ...baseProvider,
  id: "prov-2",
  name: "Maria Encanadora",
  lat: -23.5605,
  lng: -46.6433,
}

const provider3 = {
  ...baseProvider,
  id: "prov-3",
  name: "João Eletricista",
  lat: -23.5705,
  lng: -46.6533,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/providers — Progressive Radius Expansion", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: withCache invokes the factory function (cache miss)
    mockWithCache.mockImplementation(
      async (_key: string, fn: () => unknown) => fn(),
    )

    // Default category tree: single root category, no children
    vi.mocked(db.category.findMany as any).mockResolvedValue([
      { id: "cat-1", parentId: null },
    ])

    // Default Phase 2 mocks
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
    (vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider] as any)
  })

  // -----------------------------------------------------------------------
  // Scenario 1 — Radius finds providers immediately (no expansion)
  // -----------------------------------------------------------------------

  it("returns providers within user's requested radius (expandedRadius = null)", async () => {
    // Phase 1a: COUNT with 10km → 3 providers found
    // Phase 1b: IDs with 10km → 3 IDs
    // Phase 2: full data for 3 providers
    (db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) {
        return Promise.resolve([{ total: BigInt(3) }])
      }
      if (sql.includes("ST_Distance")) {
        return Promise.resolve([
          { id: "prov-1", distance_km: 2.5 },
          { id: "prov-2", distance_km: 5.1 },
          { id: "prov-3", distance_km: 8.3 },
        ])
      }
      return Promise.resolve([
        { id: "prov-1" },
        { id: "prov-2" },
        { id: "prov-3" },
      ])
    })
    (vi.mocked(db.user.findMany) as any).mockResolvedValue([
      baseProvider,
      provider2,
      provider3,
    ])

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.items).toHaveLength(3)
    expect((parsed.body as any)!.total).toBe(3)
    // No expansion needed — user's radius found providers
    expect((parsed.body as any)!.expandedRadius).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Scenario 2 — Radius expands to 25km
  // -----------------------------------------------------------------------

  it("expands to 25km when 10km finds no providers (expandedRadius = 25)", async () => {
    // Phase 1a: COUNT with 10km → 0, with 25km → 3
    // Phase 1b: IDs with 25km
    // Phase 2: full data
    (db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) {
        // 10 000m = 10km → 0 providers
        if (sql.includes("10000")) {
          return Promise.resolve([{ total: BigInt(0) }])
        }
        // 25 000m = 25km → 3 providers
        if (sql.includes("25000")) {
          return Promise.resolve([{ total: BigInt(3) }])
        }
        // Any other radius → 0 (shouldn't be reached after 25km match)
        return Promise.resolve([{ total: BigInt(0) }])
      }
      if (sql.includes("ST_Distance")) {
        return Promise.resolve([
          { id: "prov-1", distance_km: 15.2 },
          { id: "prov-2", distance_km: 18.7 },
          { id: "prov-3", distance_km: 22.1 },
        ])
      }
      return Promise.resolve([
        { id: "prov-1" },
        { id: "prov-2" },
        { id: "prov-3" },
      ])
    })
    (vi.mocked(db.user.findMany) as any).mockResolvedValue([
      baseProvider,
      provider2,
      provider3,
    ])

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.items).toHaveLength(3)
    // Expanded to 25km
    expect((parsed.body as any)!.expandedRadius).toBe(25)
  })

  // -----------------------------------------------------------------------
  // Scenario 3 — No providers within 100km (expandedRadius = -1)
  // -----------------------------------------------------------------------

  it("sets expandedRadius = -1 when no providers within 100km but unrestricted exists", async () => {
    // Phase 1a: all radius COUNT queries (10, 25, 50, 100km) → 0
    // Then: unrestricted COUNT → 1, unrestricted IDs → 1
    (db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) {
        // All expansion radii → 0
        if (
          sql.includes("10000") ||
          sql.includes("25000") ||
          sql.includes("50000") ||
          sql.includes("100000")
        ) {
          return Promise.resolve([{ total: BigInt(0) }])
        }
        // Unrestricted COUNT (no ST_DWithin) → 1
        return Promise.resolve([{ total: BigInt(1) }])
      }
      // ID query (unrestricted, no radius filter)
      return Promise.resolve([{ id: "prov-1" }])
    })

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.expandedRadius).toBe(-1)
    expect((parsed.body as any)!.items).toHaveLength(1)
  })

  // -----------------------------------------------------------------------
  // Scenario 4 — No providers at all in the database
  // -----------------------------------------------------------------------

  it("returns empty result when no providers exist at all", async () => {
    (db.$queryRawUnsafe as any).mockImplementation(() =>
      Promise.resolve([{ total: BigInt(0) }]),
    )

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.items).toEqual([])
    expect((parsed.body as any)!.total).toBe(0)
    expect((parsed.body as any)!.expandedRadius).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Scenario 5 — radius=0 expands to 5km
  // -----------------------------------------------------------------------

  it("expands from radius=0 to 5km when no providers at exact location", async () => {
    // radiiToTry: [0, 5, 10, 25, 50, 100]
    // Phase 1a: COUNT with 0km (ST_DWithin 0m) → 0, with 5km → 3
    // Phase 1b: IDs with 5km
    // Phase 2: full data
    (db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) {
        // ST_DWithin with 0 meters (radius=0km) → no matches
        if (sql.includes(", 0)")) {
          return Promise.resolve([{ total: BigInt(0) }])
        }
        // ST_DWithin with 5000 meters (5km) → 3 providers
        if (sql.includes("5000")) {
          return Promise.resolve([{ total: BigInt(3) }])
        }
        // Any other radius → 0 (shouldn't be reached)
        return Promise.resolve([{ total: BigInt(0) }])
      }
      if (sql.includes("ST_Distance")) {
        return Promise.resolve([
          { id: "prov-1", distance_km: 2.5 },
          { id: "prov-2", distance_km: 4.1 },
          { id: "prov-3", distance_km: 4.8 },
        ])
      }
      return Promise.resolve([
        { id: "prov-1" },
        { id: "prov-2" },
        { id: "prov-3" },
      ])
    })
    (vi.mocked(db.user.findMany) as any).mockResolvedValue([
      baseProvider,
      provider2,
      provider3,
    ])

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "0" },
    })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.items).toHaveLength(3)
    // Expanded from 0km to 5km
    expect((parsed.body as any)!.expandedRadius).toBe(5)
  })

  // -----------------------------------------------------------------------
  // Scenario 7 — PostGIS available but distance query fails in Phase 2
  // -----------------------------------------------------------------------

  it("falls back to Haversine when PostGIS distance query throws in Phase 2 (catch block)", async () => {
    // PostGIS IS available (default mock). Phase 1 uses spatial filter and
    // finds providers at 10km. Phase 2 distance query ($queryRawUnsafe with
    // ST_Distance) throws → catch block → empty distanceMap → Haversine fallback.
    (db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) {
        return Promise.resolve([{ total: BigInt(3) }])
      }
      // Phase 2 distance query — simulate PostGIS failure
      if (sql.includes("ST_Distance")) {
        return Promise.reject(new Error("PostGIS ST_Distance query failed"))
      }
      // Phase 1b ID query (sort=rating, no ST_Distance in ORDER BY)
      return Promise.resolve([{ id: "prov-1" }, { id: "prov-2" }])
    })

    // Phase 2 mocks: services + bookings for both providers
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
      { providerId: "prov-2", _count: { id: 7 } },
    ])
    (vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider, provider2])

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.items).toHaveLength(2)
    // Found at user's 10km radius — no expansion needed
    expect((parsed.body as any)!.expandedRadius).toBeNull()

    // Haversine fallback distances (PostGIS distance query was skipped):
    // prov-1 = same coords as user (-23.5505, -46.6333) → 0 km
    expect((parsed.body as any)!.items[0].distanceKm).toBe(0)
    // prov-2 = (-23.5605, -46.6433) → Haversine ≈ 1.508 km, rounded → 1.5 km
    expect((parsed.body as any)!.items[1].distanceKm).toBe(1.5)

    // Verify that isPostGISAvailable returned true (Phase 1 used spatial filter)
    expect(vi.mocked(isPostGISAvailable)).toHaveBeenCalled()

    // Verify the ST_Distance mock was actually called and rejected
    const rawCalls = vi.mocked(db.$queryRawUnsafe).mock.calls
    const distanceCalls = rawCalls.filter(
      ([sql]) => typeof sql === "string" && sql.includes("ST_Distance"),
    )
    expect(distanceCalls.length).toBeGreaterThan(0)
  })

  // -----------------------------------------------------------------------
  // Scenario 8 — Non-distance Phase 2 errors propagate (not swallowed)
  // -----------------------------------------------------------------------

  it("does not swallow errors from service.findMany in Phase 2", async () => {
    // Phase 1 succeeds: 3 providers found at 10km
    (db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) {
        return Promise.resolve([{ total: BigInt(3) }])
      }
      if (sql.includes("ST_Distance")) {
        return Promise.resolve([{ id: "prov-1", distance_km: 2.5 }])
      }
      return Promise.resolve([{ id: "prov-1" }])
    })

    // Phase 2: service.findMany throws — this is NOT inside any try/catch
    vi.mocked(db.service.findMany as any).mockRejectedValue(
      new Error("Services DB connection lost"),
    )
    // Other Phase 2 queries are fine
    vi.mocked(db.booking.groupBy as any).mockResolvedValue([
      { providerId: "prov-1", _count: { id: 3 } },
    ])
    (vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider] as any)

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    const res = await GET(req)

    // Error propagated to route handler's catch → handleError → NOT 200
    expect(res.status).not.toBe(200)
  })

  it("does not swallow errors from booking.groupBy in Phase 2", async () => {
    // Phase 1 succeeds
    (db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) {
        return Promise.resolve([{ total: BigInt(3) }])
      }
      if (sql.includes("ST_Distance")) {
        return Promise.resolve([{ id: "prov-1", distance_km: 2.5 }]
        )
      }
      return Promise.resolve([{ id: "prov-1" }])
    })

    // Phase 2: booking.groupBy throws
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
    (vi.mocked(db.booking.groupBy) as any).mockRejectedValue(
      new Error("Bookings DB connection lost"),
    )
    (vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider] as any)

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    const res = await GET(req)

    // Error propagated — NOT silently caught
    expect(res.status).not.toBe(200)
  })

  // -----------------------------------------------------------------------
  // Scenario 10 — Unrestricted path: distance query would throw but is
  //                never called (no centerGeo in fetchUnrestrictedResults)
  // -----------------------------------------------------------------------

  it("falls back to Haversine in unrestricted path — ST_Distance not called when centerGeo is null", async () => {
    // Phase 1a: all expansion radii → 0
    // Unrestricted COUNT → 1, unrestricted IDs → [prov-1]
    // fetchUnrestrictedResults calls fetchProvidersData WITHOUT centerGeo
    // computeDistanceMap skips PostGIS → Haversine fallback
    (db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) {
        if (
          sql.includes("10000") ||
          sql.includes("25000") ||
          sql.includes("50000") ||
          sql.includes("100000")
        ) {
          return Promise.resolve([{ total: BigInt(0) }])
        }
        // Unrestricted COUNT → 1
        return Promise.resolve([{ total: BigInt(1) }])
      }
      // ST_Distance mock REJECTS — but should NOT be called in this path
      if (sql.includes("ST_Distance")) {
        return Promise.reject(new Error("ST_Distance should not be called in unrestricted path"))
      }
      // ID query
      return Promise.resolve([{ id: "prov-1" }])
    })

    // Phase 2 mocks for fetchProvidersData
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
    // Provider with user's own coordinates → Haversine distance = 0 km
    (vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider] as any)

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.expandedRadius).toBe(-1)
    expect((parsed.body as any)!.items).toHaveLength(1)

    // Haversine fallback (no ST_Distance attempted because centerGeo is null)
    expect((parsed.body as any)!.items[0].distanceKm).toBe(0)

    // Prove ST_Distance was NEVER called (not even attempted)
    const rawCalls = vi.mocked(db.$queryRawUnsafe).mock.calls
    const distanceCalls = rawCalls.filter(
      ([sql]) => typeof sql === "string" && sql.includes("ST_Distance"),
    )
    expect(distanceCalls).toHaveLength(0)
  })

  // -----------------------------------------------------------------------
  // Cache behavior
  // -----------------------------------------------------------------------

  it("calls withCache for each radius level attempted", async () => {
    // Expansion: 10km → 0, 25km → 3
    (db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) {
        if (sql.includes("10000")) return Promise.resolve([{ total: BigInt(0) }])
        if (sql.includes("25000")) return Promise.resolve([{ total: BigInt(3) }])
        return Promise.resolve([{ total: BigInt(0) }])
      }
      if (sql.includes("ST_Distance")) {
        return Promise.resolve([{ id: "prov-1", distance_km: 15.2 }])
      }
      return Promise.resolve([{ id: "prov-1" }])
    })

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    await GET(req)

    // Verify withCache was called with provider count cache keys
    const cacheKeys = mockWithCache.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    )
    const countCacheKeys = cacheKeys.filter((k: string) =>
      k.startsWith("providers:count:"),
    )

    // At least the 10km and 25km levels were cached
    expect(countCacheKeys.some((k: string) => k.includes(":10:"))).toBe(true)
    expect(countCacheKeys.some((k: string) => k.includes(":25:"))).toBe(true)
  })

  // -----------------------------------------------------------------------
  // Scenario 6 — Haversine fallback when PostGIS is unavailable
  // -----------------------------------------------------------------------

  it("falls back to Haversine distance when PostGIS is unavailable and radius is specified", async () => {
    // Use mockResolvedValueOnce so the default true is restored after this test
    vi.mocked(isPostGISAvailable).mockResolvedValueOnce(false)

    // Phase 1: Count + IDs without spatial filter (non-PostGIS path)
    // @ts-expect-error DeepMockProxy $queryRawUnsafe type resolution edge case
    ((db as any).$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) {
        return Promise.resolve([{ total: BigInt(2) }])
      }
      return Promise.resolve([{ id: "prov-1" }, { id: "prov-2" }])
    })

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
      { providerId: "prov-2", _count: { id: 7 } },
    ])
    (vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider, provider2])

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    const res = await GET(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.items).toHaveLength(2)

    // Without PostGIS, no expansion is performed — expandedRadius stays null
    expect((parsed.body as any)!.expandedRadius).toBeNull()

    // Verify Haversine fallback distances:
    // prov-1 has the same coords as the user (-23.5505, -46.6333) → 0 km
    expect((parsed.body as any)!.items[0].distanceKm).toBe(0)
    // prov-2 coords: (-23.5605, -46.6433)
    // Haversine ≈ 1.508 km, rounded to 1 decimal → 1.5 km
    expect((parsed.body as any)!.items[1].distanceKm).toBe(1.5)

    // Verify isPostGISAvailable was actually called
    expect(vi.mocked(isPostGISAvailable)).toHaveBeenCalled()
  })

  it("includes rounded coordinates and search params in cache key", async () => {
    (db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) return Promise.resolve([{ total: BigInt(3) }])
      if (sql.includes("ST_Distance")) return Promise.resolve([{ id: "prov-1", distance_km: 2.5 }])
      return Promise.resolve([{ id: "prov-1" }])
    })

    const req = createMockRequest({
      searchParams: {
        lat: "-23.5505123",
        lng: "-46.6333789",
        radius: "10",
        q: "eletricista",
        categoryId: "cat-1",
      },
    })
    await GET(req)

    const cacheKeys = mockWithCache.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    )
    const countKey = cacheKeys.find((k: string) =>
      k.startsWith("providers:count:"),
    )

    // Key should contain rounded coords (3 decimal places)
    expect(countKey).toContain("-23.551")
    expect(countKey).toContain("-46.633")
    // Should contain the search query
    expect(countKey).toContain("eletricista")
    // Should contain the category
    expect(countKey).toContain("cat-1")
  })
})
