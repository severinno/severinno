// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/routing", () => ({
  getRoute: vi.fn().mockResolvedValue({ distanceKm: 5.5, durationMin: 11 } as any),
  getMultiRoute: vi.fn().mockImplementation(async (origin, destinations) => {
    return destinations.map(() => ({ distanceKm: 5.5, durationMin: 11 }))
  }),
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
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    favorite: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    category: {
      findMany: vi.fn(),
    },
    service: {
      findMany: vi.fn(),
    },
    booking: {
      groupBy: vi.fn(),
    },
    $queryRawUnsafe: vi.fn(),
  },
}))

// Auth mock with mutable session
let _mockSession: { userId: string; role: "CLIENT" | "PROVIDER" | "ADMIN" } | null = null

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockImplementation(async () => {
    const s = _mockSession
    if (!s) throw new Error("UNAUTHORIZED")
    return s
  }),
  getOptionalSession: vi.fn().mockImplementation(async () => _mockSession),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET as listProviders } from "../providers/route"
import { GET as getProvider } from "../providers/[id]/route"
import { POST as toggleFavorite } from "../providers/[id]/favorite/route"
import { db } from "@/lib/db"

// ── Mock data ──────────────────────────────────────────────────────────────

const baseProvider = {
  id: "prov-1",
  email: "carlos@example.com",
  name: "Carlos Prestador",
  role: "PROVIDER",
  active: true,
  verified: true,
  avatarUrl: "https://i.pravatar.cc/150?u=prov-1",
  cpfCnpj: "123.456.789-00",
  whatsapp: "11999999999",
  phone: null,
  cep: "01310-100",
  street: "Av. Paulista",
  number: "1000",
  complement: null,
  district: "Bela Vista",
  city: "São Paulo",
  state: "SP",
  lat: -23.55,
  lng: -46.63,
  bio: "Profissional experiente",
  radiusKm: 30,
  passwordHash: "hash",
  coverUrl: null,
  createdAt: new Date("2024-06-01"),
  updatedAt: new Date("2025-01-01"),
  services: [
    {
      id: "svc-1",
      title: "Instalação Elétrica",
      active: true,
      categoryId: "cat-1",
      basePrice: 150,
      unit: "UNIDADE",
      category: { id: "cat-1", name: "Elétrica", slug: "eletrica" },
    },
  ],
  reviewsReceived: [
    { rating: 5, client: { id: "client-1", name: "Maria Souza", avatarUrl: null } },
    { rating: 4, client: { id: "client-2", name: "João Cliente", avatarUrl: null } },
  ],
  bookingsAsProvider: [
    { id: "book-1" },
    { id: "book-2" },
    { id: "book-3" },
  ],
  _count: { favoritedBy: 10, reviewsReceived: 2 },
  avgRating: 4.5,
  reviewCount: 2,
  favoriteCount: 10,
  slug: "carlos-prestador",
  deletedAt: null,
  availability: [
    { id: "avail-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00", active: true },
  ],
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/providers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mocks for the route handler's 2-phase query architecture
    vi.mocked(db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) return Promise.resolve([{ total: BigInt(1) }])
      if (sql.includes("ST_Distance")) return Promise.resolve([{ id: "prov-1", distance_km: 5.5 }])
      return Promise.resolve([{ id: "prov-1" }])
    })
    vi.mocked(db.service.findMany as any).mockResolvedValue(baseProvider.services)
    vi.mocked(db.booking.groupBy as any).mockResolvedValue([
      { providerId: "prov-1", _count: { id: 3 } },
    ])
    (vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider])
  })

  it("returns paginated list of active verified providers", async () => {
    const req = createMockRequest()
    const res = await listProviders(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.items).toHaveLength(1)
    expect((parsed.body as any)!.total).toBe(1)
    expect((parsed.body as any)!.page).toBe(1)
    expect((parsed.body as any)!.limit).toBe(20)
    expect((parsed.body as any)!.items[0].name).toBe("Carlos Prestador")
    expect((parsed.body as any)!.items[0]).not.toHaveProperty("passwordHash")
    expect((parsed.body as any)!.items[0].rating).toBe(4.5)
    expect((parsed.body as any)!.items[0].completedBookings).toBe(3)
    expect((parsed.body as any)!.items[0].favoriteCount).toBe(10)
  })

  it("returns empty array when no providers match", async () => {
    // Override COUNT mock to return 0
    vi.mocked(db.$queryRawUnsafe as any).mockReset()
    vi.mocked(db.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) return Promise.resolve([{ total: BigInt(0) }])
      return Promise.resolve([{ id: "prov-1" }])
    })

    const req = createMockRequest()
    const res = await listProviders(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.items).toEqual([])
    expect((parsed.body as any)!.total).toBe(0)
  })

  it("filters by search query (q)", async () => {
    const req = createMockRequest({ searchParams: { q: "Carlos" } })
    await listProviders(req)

    // Handler uses raw SQL with `search_vector @@ to_tsquery`, not Prisma `findMany`
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("to_tsquery"),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
  })

  it("filters by categoryId", async () => {
    vi.mocked(db.category.findMany as any).mockResolvedValue([
      { id: "cat-1", parentId: null, name: "Elétrica" },
    ])

    const req = createMockRequest({ searchParams: { categoryId: "cat-1" } })
    const res = await listProviders(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.items).toHaveLength(1)
  })

  it("returns 400 when sort=distance without lat/lng", async () => {
    const req = createMockRequest({ searchParams: { sort: "distance" } })
    const res = await listProviders(req)

    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.error).toContain("lat")
  })

  it("sorts by distance when lat/lng provided", async () => {
    // Override user.findMany with two providers
    (vi.mocked(db.user.findMany) as any).mockResolvedValue([
      { ...baseProvider, id: "prov-1", lat: -23.55, lng: -46.63 },
      { ...baseProvider, id: "prov-2", lat: -23.56, lng: -46.64 },
    ] as any)
    vi.mocked(db.booking.groupBy as any).mockResolvedValue([
      { providerId: "prov-1", _count: { id: 3 } },
      { providerId: "prov-2", _count: { id: 5 } },
    ])

    const req = createMockRequest({
      searchParams: { sort: "distance", lat: "-23.55", lng: "-46.63" },
    })
    const res = await listProviders(req)
    const body = (await res.json()) as { items: Array<{ id: string; distanceKm: number }> }

    expect(res.status).toBe(200)
    expect(body.items[0].id).toBe("prov-1") // closest first
  })
})

describe("GET /api/providers/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = null
  })

  it("returns provider detail with services, reviews, and availability", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.user.findFirst) as any).mockResolvedValue(baseProvider as any)
    (vi.mocked(db.favorite.findUnique) as any).mockResolvedValue(null)

    const req = createMockRequest({ searchParams: { lat: "-23.55", lng: "-46.63" } })
    const res = await getProvider(req, { params: Promise.resolve({ id: "prov-1" }) })
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.name).toBe("Carlos Prestador")
    expect((body.services as unknown[])).toHaveLength(1)
    expect((body.reviews as unknown[])).toHaveLength(2)
    expect((body.reviews as unknown[])[0]).toHaveProperty("author")
    expect(((body.reviews as unknown[])[0] as Record<string, unknown>).author).toHaveProperty("name", "Maria Souza")
    expect(body.favorited).toBe(false)
    expect(body.rating).toBe(4.5)
    expect(body.distanceKm).toBe(0)
  })

  it("returns 404 for non-existent provider", async () => {
    (vi.mocked(db.user.findFirst) as any).mockResolvedValue(null)

    const req = createMockRequest()
    const res = await getProvider(req, { params: Promise.resolve({ id: "nonexistent" }) })

    expect(res.status).toBe(404)
  })
})

describe("POST /api/providers/[id]/favorite", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = null
  })

  it("returns 403 when not a client", async () => {
    _mockSession = { userId: "prov-1", role: "PROVIDER" } as any

    const req = createMockRequest({ method: "POST" })
    const res = await toggleFavorite(req, { params: Promise.resolve({ id: "prov-2" }) })

    expect(res.status).toBe(403)
  })

  it("adds favorite and returns favorited: true", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.user.findFirst) as any).mockResolvedValue({ id: "prov-1" } as any)
    (vi.mocked(db.favorite.findUnique) as any).mockResolvedValue(null)
    (vi.mocked(db.favorite.create) as any).mockResolvedValue({ id: "fav-1", clientId: "client-1", providerId: "prov-1", createdAt: new Date() } as any)

    const req = createMockRequest({ method: "POST" })
    const res = await toggleFavorite(req, { params: Promise.resolve({ id: "prov-1" }) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(201)
    expect((parsed.body as any)!.favorited).toBe(true)
  })

  it("removes favorite and returns favorited: false", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.user.findFirst) as any).mockResolvedValue({ id: "prov-1" } as any)
    (vi.mocked(db.favorite.findUnique) as any).mockResolvedValue({ id: "fav-1" } as any)
    (vi.mocked(db.favorite.delete) as any).mockResolvedValue({ id: "fav-1", clientId: "client-1", providerId: "prov-1", createdAt: new Date() } as any)

    const req = createMockRequest({ method: "POST" })
    const res = await toggleFavorite(req, { params: Promise.resolve({ id: "prov-1" }) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any)!.favorited).toBe(false)
  })

  it("returns 404 for non-existent provider", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.user.findFirst) as any).mockResolvedValue(null)

    const req = createMockRequest({ method: "POST" })
    const res = await toggleFavorite(req, { params: Promise.resolve({ id: "nonexistent" }) })

    expect(res.status).toBe(404)
  })

  it("returns 400 when favoriting self", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.user.findFirst) as any).mockResolvedValue({ id: "client-1" } as any)

    const req = createMockRequest({ method: "POST" })
    const res = await toggleFavorite(req, { params: Promise.resolve({ id: "client-1" }) })

    expect(res.status).toBe(400)
  })
})
