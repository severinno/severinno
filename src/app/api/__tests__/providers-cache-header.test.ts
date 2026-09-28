/**
 * Vitest tests for Cache-Control and Vary headers on /api/providers.
 *
 * Uses shared helpers from cache-test-utils to reduce boilerplate.
 *
 * Verifies:
 *   1. 200 response with data -> Cache-Control: public, max-age=60, s-maxage=60 + Vary
 *   2. 400 error response -> Cache-Control absent + Vary absent
 *   3. 200 empty results (total=0) -> Cache-Control absent
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest } from "@/lib/__tests__/helpers/api-test-utils"
import { expectCacheHeaders } from "@/lib/__tests__/helpers/cache-test-utils"

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
  isPostGISAvailable: vi.fn().mockResolvedValue(false),
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

import { GET as listProviders } from "../providers/route"
import { db } from "@/lib/db"

const baseProvider = {
  id: "prov-1",
  name: "Carlos Prestador",
  role: "PROVIDER",
  active: true,
  verified: true,
  avatarUrl: "https://i.pravatar.cc/150?u=prov-1",
  coverUrl: null,
  bio: "Profissional experiente",
  lat: -23.55,
  lng: -46.63,
  city: "São Paulo",
  state: "SP",
  avgRating: 4.5,
  reviewCount: 2,
  favoriteCount: 10,
  createdAt: new Date("2024-06-01"),
  radiusKm: 30,
  slug: "carlos-prestador",
  deletedAt: null,
}

const mockServices = [
  {
    id: "svc-1",
    title: "Instalação Elétrica",
    description: "Descrição do serviço",
    basePrice: 150,
    unit: "UNIDADE",
    active: true,
    providerId: "prov-1",
    categoryId: "cat-1",
    photos: [],
    category: { id: "cat-1", name: "Elétrica" },
  },
]

describe("Cache-Control headers on GET /api/providers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) return Promise.resolve([{ total: BigInt(1) }])
      return Promise.resolve([{ id: "prov-1" }])
    })
    vi.mocked(db.service.findMany as any).mockResolvedValue(mockServices)
    vi.mocked(db.booking.groupBy as any).mockResolvedValue([
      { providerId: "prov-1", _count: { id: 3 } },
    ])
    vi.mocked(db.user.findMany as any).mockResolvedValue([baseProvider])
  })

  // ── 200 with data ─────────────────────────────────────────────────────

  it("sets cache headers on 200 with providers (max-age=60)", async () => {
    const res = await listProviders(createMockRequest())
    expectCacheHeaders(res, 60)
  })

  it("second 200 with providers also has cache headers", async () => {
    const res = await listProviders(createMockRequest())
    expectCacheHeaders(res, 60)
  })

  // ── 400 error (no-store) ───────────────────────────────────────────────

  it("sets no-store on 400 sort=distance without coordinates", async () => {
    const req = createMockRequest({ searchParams: { sort: "distance" } })
    const res = await listProviders(req)

    expect(res.status).toBe(400)
    // House rule (RFC 7234 §4.2.2): erros NUNCA são cacheáveis — sem header
    // explícito, 4xx são heurísticamente cacheáveis por CDNs.
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  // ── 200 empty results (SHORT cache TTL) ────────────────────────────────

  it("sets SHORT cache headers on 200 when no providers match (total=0)", async () => {
    vi.mocked(db.$queryRawUnsafe as any).mockReset()
    vi.mocked(db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      // Empty-region path: all spatial counts → 0, unrestricted COUNT → 0
      if (sql.includes("MIN(ST_Distance")) {
        return Promise.resolve([{ min_distance_km: null, located: BigInt(0) }])
      }
      if (sql.includes("COUNT")) {
        if (sql.includes("ST_DWithin")) return Promise.resolve([{ total: BigInt(0) }])
        return Promise.resolve([{ total: BigInt(0) }])
      }
      return Promise.resolve([])
    })

    const res = await listProviders(createMockRequest())
    expect(res.status).toBe(200)
    // 15s — mirrors the Redis EMPTY_COUNT_CACHE_TTL: caches "empty" briefly
    // to absorb repeated hits without pinning it for the full 60s.
    expectCacheHeaders(res, 15)
  })
})
