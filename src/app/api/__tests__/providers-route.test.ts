import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/routing", () => ({
  getRoute: vi.fn().mockResolvedValue({ distanceKm: 5.5, durationMin: 11 }),
  getMultiRoute: vi.fn().mockImplementation(async (origin, destinations) => {
    return destinations.map(() => ({ distanceKm: 5.5, durationMin: 11 }))
  }),
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
import { getMultiRoute } from "@/lib/routing"

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
  availability: [
    { id: "avail-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00", active: true },
  ],
}

const baseProviderOutput = {
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
  createdAt: new Date("2024-06-01"),
  updatedAt: new Date("2025-01-01"),
  services: baseProvider.services,
  rating: 4.5,
  reviewCount: 2,
  completedBookings: 3,
  memberSince: new Date("2024-06-01"),
  favoriteCount: 10,
  distanceKm: 5.5,
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/providers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns paginated list of active verified providers", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([baseProvider])

    const req = createMockRequest()
    const res = await listProviders(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.items).toHaveLength(1)
    expect(parsed.body!.total).toBe(1)
    expect(parsed.body!.page).toBe(1)
    expect(parsed.body!.limit).toBe(20)
    expect(parsed.body!.items[0].name).toBe("Carlos Prestador")
    expect(parsed.body!.items[0]).not.toHaveProperty("passwordHash")
    expect(parsed.body!.items[0].rating).toBe(4.5)
    expect(parsed.body!.items[0].completedBookings).toBe(3)
    expect(parsed.body!.items[0].favoriteCount).toBe(10)
  })

  it("returns empty array when no providers match", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([])

    const req = createMockRequest()
    const res = await listProviders(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.items).toEqual([])
    expect(parsed.body!.total).toBe(0)
  })

  it("filters by search query (q)", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([baseProvider])

    const req = createMockRequest({ searchParams: { q: "Carlos" } })
    await listProviders(req)

    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ name: { contains: "Carlos" } }),
          ]),
        }),
      }),
    )
  })

  it("filters by categoryId", async () => {
    vi.mocked(db.category.findMany).mockResolvedValue([
      { id: "cat-1", parentId: null, name: "Elétrica" } as any,
    ])
    vi.mocked(db.user.findMany).mockResolvedValue([baseProvider])

    const req = createMockRequest({ searchParams: { categoryId: "cat-1" } })
    const res = await listProviders(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.items).toHaveLength(1)
  })

  it("returns 400 when sorting by distance without lat/lng", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([baseProvider])

    const req = createMockRequest({ searchParams: { sort: "distance" } })
    const res = await listProviders(req)

    expect(res.status).toBe(400)
  })

  it("sorts by distance when lat/lng provided", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([
      { ...baseProvider, id: "prov-1", lat: -23.55, lng: -46.63 },
      { ...baseProvider, id: "prov-2", lat: -23.56, lng: -46.64 },
    ])
    vi.mocked(getMultiRoute).mockResolvedValueOnce([
      { distanceKm: 1, durationMin: 2 },
      { distanceKm: 5, durationMin: 10 },
    ])

    const req = createMockRequest({
      searchParams: { sort: "distance", lat: "-23.55", lng: "-46.63" },
    })
    const res = await listProviders(req)
    const parsed = await parseResponse<{ items: Array<{ id: string; distanceKm: number }> }>(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.items[0].id).toBe("prov-1") // closest first
  })
})

describe("GET /api/providers/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = null
  })

  it("returns provider detail with services, reviews, and availability", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" }
    vi.mocked(db.user.findFirst).mockResolvedValue(baseProvider)
    vi.mocked(db.favorite.findUnique).mockResolvedValue(null)

    const req = createMockRequest({ searchParams: { lat: "-23.55", lng: "-46.63" } })
    const res = await getProvider(req, { params: Promise.resolve({ id: "prov-1" }) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.name).toBe("Carlos Prestador")
    expect(parsed.body!.services).toHaveLength(1)
    expect(parsed.body!.reviews).toHaveLength(2)
    expect(parsed.body!.reviews[0]).toHaveProperty("author")
    expect(parsed.body!.reviews[0].author.name).toBe("Maria Souza") // from client mapping in provider data
    expect(parsed.body!.favorited).toBe(false)
    expect(parsed.body!.rating).toBe(4.5)
    expect(parsed.body!.distanceKm).toBe(0)
  })

  it("returns 404 for non-existent provider", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(null)

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
    _mockSession = { userId: "prov-1", role: "PROVIDER" }

    const req = createMockRequest({ method: "POST" })
    const res = await toggleFavorite(req, { params: Promise.resolve({ id: "prov-2" }) })

    expect(res.status).toBe(403)
  })

  it("adds favorite and returns favorited: true", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" }
    vi.mocked(db.user.findFirst).mockResolvedValue({ id: "prov-1" })
    vi.mocked(db.favorite.findUnique).mockResolvedValue(null)
    vi.mocked(db.favorite.create).mockResolvedValue({ id: "fav-1", clientId: "client-1", providerId: "prov-1", createdAt: new Date() })

    const req = createMockRequest({ method: "POST" })
    const res = await toggleFavorite(req, { params: Promise.resolve({ id: "prov-1" }) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(201)
    expect(parsed.body!.favorited).toBe(true)
  })

  it("removes favorite and returns favorited: false", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" }
    vi.mocked(db.user.findFirst).mockResolvedValue({ id: "prov-1" })
    vi.mocked(db.favorite.findUnique).mockResolvedValue({ id: "fav-1" })
    vi.mocked(db.favorite.delete).mockResolvedValue({ id: "fav-1", clientId: "client-1", providerId: "prov-1", createdAt: new Date() })

    const req = createMockRequest({ method: "POST" })
    const res = await toggleFavorite(req, { params: Promise.resolve({ id: "prov-1" }) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.favorited).toBe(false)
  })

  it("returns 404 for non-existent provider", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" }
    vi.mocked(db.user.findFirst).mockResolvedValue(null)

    const req = createMockRequest({ method: "POST" })
    const res = await toggleFavorite(req, { params: Promise.resolve({ id: "nonexistent" }) })

    expect(res.status).toBe(404)
  })

  it("returns 400 when favoriting self", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" }
    vi.mocked(db.user.findFirst).mockResolvedValue({ id: "client-1" }) // user IS a provider

    const req = createMockRequest({ method: "POST" })
    const res = await toggleFavorite(req, { params: Promise.resolve({ id: "client-1" }) })

    expect(res.status).toBe(400)
  })
})
