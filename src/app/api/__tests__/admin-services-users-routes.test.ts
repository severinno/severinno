/**
 * Tests for ADMIN API routes:
 *   - GET  /api/admin/services                      (list with filters)
 *   - GET  /api/admin/stats                         (marketplace aggregation)
 *   - GET  /api/admin/users                         (paginated list + geo/radius)
 *   - PATCH/DELETE /api/admin/users/[id]            (update / soft-delete)
 *   - POST/DELETE /api/admin/users/[id]/lytex-account (link/unlink Lytex)
 *
 * NOTE: GET /api/admin/gateway/invoices is NOT covered here — it already has
 * full coverage in admin-gateway-invoices-route.test.ts (success, search and
 * pagination params, Lytex error, 403 non-admin, 401 unauthenticated).
 *
 * Verifies:
 *  - 401 auth guard on every handler
 *  - 403 non-admin on lytex-account handlers (role check)
 *  - Happy paths with realistic mocked data
 *  - Branch coverage: filters, geo/radius, invalid role, 404/400 paths
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// ---- Mocks ----------------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any),
  requireUser: vi.fn().mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any),
  invalidateUserCache: vi.fn().mockResolvedValue(undefined),
}))

// Keep the REAL helpers (badRequest/notFound/forbidden/parsePagination and the
// HttpError-aware handleError) so status codes are faithful; only spy on
// handleError so callers can assert it was used.
vi.mock("@/lib/api-server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, handleError: vi.fn((e: unknown) => (actual as any).handleError(e)) }
})

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/geo-server", () => ({
  haversineKm: vi.fn().mockReturnValue(12.34),
}))

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    service: { findMany: vi.fn(), count: vi.fn() },
    booking: { findMany: vi.fn(), groupBy: vi.fn() },
    quoteRequest: { groupBy: vi.fn() },
    payment: { aggregate: vi.fn() },
  },
}))

// ---- SUT imports ----------------------------------------------------------

import { requireRole, requireUser, invalidateUserCache } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { db } from "@/lib/db"
import { haversineKm } from "@/lib/geo-server"
import logger from "@/lib/logger"

import { GET as servicesGET } from "../admin/services/route"
import { GET as statsGET } from "../admin/stats/route"
import { GET as usersGET } from "../admin/users/route"
import { PATCH as userPATCH, DELETE as userDELETE } from "../admin/users/[id]/route"
import { POST as lytexPOST, DELETE as lytexDELETE } from "../admin/users/[id]/lytex-account/route"

// ---- Test helpers ---------------------------------------------------------

const MOCK_SESSION = { userId: "admin-1", role: "ADMIN" as const }

function buildRequest(url: string): NextRequest {
  return new NextRequest(new Request(url))
}

function buildJsonRequest(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" = "POST",
): NextRequest {
  return new NextRequest(
    new Request(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

function buildParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

afterEach(() => {
  vi.clearAllMocks()
})

// ===========================================================================
// GET /api/admin/services
// ===========================================================================

describe("GET /api/admin/services — auth guard", () => {
  it("returns 401 when auth fails", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await servicesGET(buildRequest("http://localhost:3000/api/admin/services"))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Não autorizado")
  })
})

describe("GET /api/admin/services — list", () => {
  const mockServices = [
    {
      id: "svc-1",
      title: "Limpeza Residencial",
      description: "Limpeza completa",
      active: true,
      providerId: "p-1",
      categoryId: "c-1",
      createdAt: "2026-01-10T10:00:00Z",
      category: { id: "c-1", name: "Limpeza" },
      provider: {
        id: "p-1",
        name: "Ana Souza",
        avatarUrl: null,
        city: "São Paulo",
        state: "SP",
        verified: true,
        active: true,
      },
      _count: { bookings: 3, reviews: 5 },
    },
    {
      id: "svc-2",
      title: "Instalação Elétrica",
      description: "Serviço de eletricista",
      active: false,
      providerId: "p-2",
      categoryId: "c-2",
      createdAt: "2026-02-01T09:00:00Z",
      category: { id: "c-2", name: "Elétrica" },
      provider: {
        id: "p-2",
        name: "Bruno Lima",
        avatarUrl: null,
        city: "Rio de Janeiro",
        state: "RJ",
        verified: false,
        active: true,
      },
      _count: { bookings: 0, reviews: 1 },
    },
  ]

  it("lists all services enriched with provider, category and counts", async () => {
    vi.mocked(db.service.findMany).mockResolvedValueOnce(mockServices as any)
    vi.mocked(db.service.count).mockResolvedValueOnce(2)

    const res = await servicesGET(buildRequest("http://localhost:3000/api/admin/services"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(2)
    expect(body.total).toBe(2)
    expect(body.items[0]).toMatchObject({ id: "svc-1", title: "Limpeza Residencial" })
    expect(body.items[0].provider.name).toBe("Ana Souza")
    expect(body.items[1]._count.reviews).toBe(1)

    expect(requireRole).toHaveBeenCalledWith("ADMIN")
    const args = vi.mocked(db.service.findMany).mock.calls[0][0]
    expect(args).toMatchObject({
      include: {
        category: true,
        provider: expect.any(Object),
        _count: { select: { bookings: true, reviews: true } },
      },
      orderBy: { createdAt: "desc" },
    })
  })

  it("builds where clause from q, providerId, categoryId and active=true filters", async () => {
    vi.mocked(db.service.findMany).mockResolvedValueOnce([] as any)
    vi.mocked(db.service.count).mockResolvedValueOnce(0)

    const req = buildRequest(
      "http://localhost:3000/api/admin/services?q=limpeza&providerId=p-1&categoryId=c-1&active=true",
    )
    await servicesGET(req)

    const where = vi.mocked(db.service.findMany).mock.calls[0][0]?.where
    expect(where).toMatchObject({
      OR: [{ title: { contains: "limpeza" } }, { description: { contains: "limpeza" } }],
      providerId: "p-1",
      categoryId: "c-1",
      active: true,
    })
    expect(vi.mocked(db.service.count).mock.calls[0][0]?.where).toEqual(where)
  })

  it("supports active=false filter", async () => {
    vi.mocked(db.service.findMany).mockResolvedValueOnce([] as any)
    vi.mocked(db.service.count).mockResolvedValueOnce(0)

    await servicesGET(buildRequest("http://localhost:3000/api/admin/services?active=false"))

    const where = vi.mocked(db.service.findMany).mock.calls[0][0]?.where
    expect(where).toEqual({ active: false })
  })
})

// ===========================================================================
// GET /api/admin/stats
// ===========================================================================

describe("GET /api/admin/stats — auth guard", () => {
  it("returns 401 when auth fails", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await statsGET()

    expect(res.status).toBe(401)
  })
})

describe("GET /api/admin/stats — aggregation", () => {
  const recentBookings = [
    {
      id: "b-1",
      status: "CONFIRMED",
      createdAt: "2026-03-01T12:00:00Z",
      service: { id: "svc-1", title: "Limpeza Residencial" },
      client: { id: "u-1", name: "João", avatarUrl: null },
      provider: { id: "p-1", name: "Ana Souza", avatarUrl: null },
    },
    {
      id: "b-2",
      status: "PENDING",
      createdAt: "2026-03-02T12:00:00Z",
      service: { id: "svc-2", title: "Instalação Elétrica" },
      client: { id: "u-2", name: "Maria", avatarUrl: null },
      provider: { id: "p-2", name: "Bruno Lima", avatarUrl: null },
    },
  ]

  const topProvidersRows = [
    {
      id: "p-1",
      name: "Ana Souza",
      role: "PROVIDER",
      reviewsReceived: [{ rating: 5 }, { rating: 4 }],
    },
    { id: "p-2", name: "Bruno Lima", role: "PROVIDER", reviewsReceived: [{ rating: 5 }] },
    { id: "p-3", name: "Carla Dias", role: "PROVIDER", reviewsReceived: [] },
  ]

  function mockQueries() {
    vi.mocked(db.user.groupBy).mockResolvedValueOnce([
      { role: "CLIENT", _count: { _all: 10 } },
      { role: "PROVIDER", _count: { _all: 5 } },
      { role: "ADMIN", _count: { _all: 1 } },
    ] as any)
    vi.mocked(db.user.count).mockResolvedValueOnce(3)
    vi.mocked(db.service.count).mockResolvedValueOnce(20)
    vi.mocked(db.booking.groupBy).mockResolvedValueOnce([
      { status: "CONFIRMED", _count: { _all: 4 } },
      { status: "PENDING", _count: { _all: 2 } },
    ] as any)
    vi.mocked(db.quoteRequest.groupBy).mockResolvedValueOnce([
      { status: "OPEN", _count: { _all: 7 } },
    ] as any)
    vi.mocked(db.payment.aggregate).mockResolvedValueOnce({
      _sum: { amount: 150000 },
      _count: 6,
    } as any)
    vi.mocked(db.booking.findMany).mockResolvedValueOnce(recentBookings as any)
    vi.mocked(db.user.findMany).mockResolvedValueOnce(topProvidersRows as any)
  }

  it("aggregates users, bookings, quotes, revenue and top providers", async () => {
    mockQueries()

    const res = await statsGET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.usersByRole).toEqual({ CLIENT: 10, PROVIDER: 5, ADMIN: 1 })
    expect(body.providers).toBe(3)
    expect(body.services).toBe(20)
    expect(body.bookingsByStatus).toEqual({ CONFIRMED: 4, PENDING: 2 })
    expect(body.quotesByStatus).toEqual({ OPEN: 7 })
    expect(body.revenue).toEqual({ total: 150000, paymentsPaid: 6 })
    expect(body.recentBookings).toHaveLength(2)
    expect(body.recentBookings[0].service.title).toBe("Limpeza Residencial")

    // Top providers: sorted by rating desc, then reviewCount desc
    expect(body.topProviders).toHaveLength(3)
    expect(body.topProviders[0]).toMatchObject({ id: "p-2", rating: 5, reviewCount: 1 })
    expect(body.topProviders[1]).toMatchObject({ id: "p-1", rating: 4.5, reviewCount: 2 })
    expect(body.topProviders[2]).toMatchObject({ id: "p-3", rating: 0, reviewCount: 0 })
    expect(body.topProviders[0]).not.toHaveProperty("reviewsReceived")

    expect(vi.mocked(db.user.findMany).mock.calls[0][0]).toMatchObject({
      where: { role: "PROVIDER", active: true, verified: true },
    })
  })

  it("returns zeros and empty collections when there is no data", async () => {
    vi.mocked(db.user.groupBy).mockResolvedValueOnce([] as any)
    vi.mocked(db.user.count).mockResolvedValueOnce(0)
    vi.mocked(db.service.count).mockResolvedValueOnce(0)
    vi.mocked(db.booking.groupBy).mockResolvedValueOnce([] as any)
    vi.mocked(db.quoteRequest.groupBy).mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.aggregate).mockResolvedValueOnce({
      _sum: { amount: null },
      _count: 0,
    } as any)
    vi.mocked(db.booking.findMany).mockResolvedValueOnce([] as any)
    vi.mocked(db.user.findMany).mockResolvedValueOnce([] as any)

    const res = await statsGET()
    const body = await res.json()

    expect(body.usersByRole).toEqual({})
    expect(body.bookingsByStatus).toEqual({})
    expect(body.quotesByStatus).toEqual({})
    expect(body.providers).toBe(0)
    expect(body.services).toBe(0)
    expect(body.revenue).toEqual({ total: 0, paymentsPaid: 0 })
    expect(body.topProviders).toEqual([])
  })
})

// ===========================================================================
// GET /api/admin/users
// ===========================================================================

describe("GET /api/admin/users — auth guard", () => {
  it("returns 401 when auth fails", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await usersGET(buildRequest("http://localhost:3000/api/admin/users"))

    expect(res.status).toBe(401)
  })
})

describe("GET /api/admin/users — list and pagination", () => {
  const mockUsers = [
    {
      id: "u-1",
      name: "João Silva",
      email: "joao@test.com",
      role: "CLIENT",
      verified: true,
      active: true,
      createdAt: "2026-01-05T10:00:00Z",
      lat: null,
      lng: null,
    },
    {
      id: "u-2",
      name: "Maria Santos",
      email: "maria@test.com",
      role: "PROVIDER",
      verified: true,
      active: true,
      createdAt: "2026-01-06T10:00:00Z",
      lat: null,
      lng: null,
    },
  ]

  it("returns paginated users without distance when no geo params are sent", async () => {
    vi.mocked(db.user.findMany).mockResolvedValueOnce(mockUsers as any)
    vi.mocked(db.user.count).mockResolvedValueOnce(5)

    const res = await usersGET(
      buildRequest("http://localhost:3000/api/admin/users?page=2&limit=10"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(2)
    expect(body.total).toBe(5)
    expect(body.page).toBe(2)
    expect(body.limit).toBe(10)
    expect(body.items[0]).not.toHaveProperty("distanceKm")
  })

  it("applies default pagination and builds where clause from filters", async () => {
    vi.mocked(db.user.findMany).mockResolvedValueOnce([] as any)
    vi.mocked(db.user.count).mockResolvedValueOnce(0)

    await usersGET(
      buildRequest(
        "http://localhost:3000/api/admin/users?role=PROVIDER&city=S%C3%A3o%20Paulo&state=SP&q=ana",
      ),
    )

    const args = vi.mocked(db.user.findMany).mock.calls[0][0]
    expect(args).toMatchObject({
      where: {
        role: "PROVIDER",
        city: { contains: "São Paulo" },
        state: "SP",
        OR: [
          { name: { contains: "ana" } },
          { email: { contains: "ana" } },
          { city: { contains: "ana" } },
        ],
      },
      select: expect.objectContaining({ lat: true, lng: true }),
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 20,
    })
  })

  it("delegates error handling to handleError on failure", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(MOCK_SESSION)
    vi.mocked(db.user.findMany).mockRejectedValueOnce(new Error("db exploded"))

    const res = await usersGET(buildRequest("http://localhost:3000/api/admin/users"))

    expect(res.status).toBe(500)
    expect(handleError).toHaveBeenCalledOnce()
  })
})

describe("GET /api/admin/users — geo distance and radius", () => {
  const mockUsers = [
    {
      id: "u-1",
      name: "João Silva",
      role: "CLIENT",
      verified: true,
      active: true,
      createdAt: "2026-01-05T10:00:00Z",
      lat: -23.55,
      lng: -46.63,
    },
    {
      id: "u-2",
      name: "Maria Santos",
      role: "CLIENT",
      verified: true,
      active: true,
      createdAt: "2026-01-06T10:00:00Z",
      lat: -23.6,
      lng: -46.7,
    },
    {
      id: "u-3",
      name: "Pedro Rocha",
      role: "CLIENT",
      verified: true,
      active: true,
      createdAt: "2026-01-07T10:00:00Z",
      lat: null,
      lng: null,
    },
  ]

  beforeEach(() => {
    vi.mocked(haversineKm).mockReturnValue(12.34)
  })

  it("computes distanceKm per user when lat/lng params are present", async () => {
    vi.mocked(db.user.findMany).mockResolvedValueOnce(mockUsers as any)
    vi.mocked(db.user.count).mockResolvedValueOnce(3)

    const res = await usersGET(
      buildRequest("http://localhost:3000/api/admin/users?lat=-23.55&lng=-46.63"),
    )
    const body = await res.json()

    expect(body.items[0].distanceKm).toBe(12.3) // rounded to 1 decimal
    expect(body.items[1].distanceKm).toBe(12.3)
    expect(body.items[2].distanceKm).toBeNull() // no coords -> null
    expect(haversineKm).toHaveBeenCalledWith(-23.55, -46.63, -23.55, -46.63)
  })

  it("filters out users beyond the requested radius", async () => {
    vi.mocked(db.user.findMany).mockResolvedValueOnce(mockUsers as any)
    vi.mocked(db.user.count).mockResolvedValueOnce(3)
    vi.mocked(haversineKm).mockImplementation((_lat, _lng, itemLat) =>
      itemLat === -23.55 ? 2 : 50,
    )

    const res = await usersGET(
      buildRequest("http://localhost:3000/api/admin/users?lat=-23.55&lng=-46.63&radius=10"),
    )
    const body = await res.json()

    // u-1 (2km) stays, u-3 (no coords) stays, u-2 (50km) is filtered out
    expect(body.items).toHaveLength(2)
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["u-1", "u-3"])
    expect(body.items[0].distanceKm).toBe(2)
  })
})

// ===========================================================================
// PATCH /api/admin/users/[id]
// ===========================================================================

describe("PATCH /api/admin/users/[id] — auth guard", () => {
  it("returns 401 when auth fails", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const req = buildJsonRequest(
      "http://localhost:3000/api/admin/users/u-1",
      { name: "X" },
      "PATCH",
    )
    const res = await userPATCH(req, buildParams("u-1"))

    expect(res.status).toBe(401)
  })
})

describe("PATCH /api/admin/users/[id] — update user", () => {
  it("updates profile fields and invalidates the user cache", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({ id: "u-1", role: "CLIENT" } as any)
    const updated = {
      id: "u-1",
      name: "João Novo",
      email: "joao@test.com",
      role: "PROVIDER",
      verified: true,
      active: true,
    }
    vi.mocked(db.user.update).mockResolvedValueOnce(updated as any)

    const req = buildJsonRequest(
      "http://localhost:3000/api/admin/users/u-1",
      {
        verified: true,
        active: true,
        role: "PROVIDER",
        name: "João Novo",
        email: "Joao@Test.com",
        avatarUrl: "https://cdn.test/avatar.png",
        bio: "Profissional",
        city: "São Paulo",
        state: "SP",
      },
      "PATCH",
    )
    const res = await userPATCH(req, buildParams("u-1"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.user).toMatchObject(updated)
    expect(vi.mocked(db.user.update).mock.calls[0][0]).toMatchObject({
      where: { id: "u-1" },
      data: {
        verified: true,
        active: true,
        role: "PROVIDER",
        name: "João Novo",
        email: "joao@test.com", // lowercased
        bio: "Profissional",
      },
      select: expect.any(Object),
    })
    expect(invalidateUserCache).toHaveBeenCalledWith("u-1")
  })

  it("returns 404 when the user does not exist", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null)

    const req = buildJsonRequest(
      "http://localhost:3000/api/admin/users/u-404",
      { name: "X" },
      "PATCH",
    )
    const res = await userPATCH(req, buildParams("u-404"))

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Usuário não encontrado")
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it("returns 400 for an invalid role", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({ id: "u-1", role: "CLIENT" } as any)

    const req = buildJsonRequest(
      "http://localhost:3000/api/admin/users/u-1",
      { role: "SUPERUSER" },
      "PATCH",
    )
    const res = await userPATCH(req, buildParams("u-1"))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Role inválido")
    expect(db.user.update).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// DELETE /api/admin/users/[id]
// ===========================================================================

describe("DELETE /api/admin/users/[id] — auth guard", () => {
  it("returns 401 when auth fails", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await userDELETE(
      buildRequest("http://localhost:3000/api/admin/users/u-1"),
      buildParams("u-1"),
    )

    expect(res.status).toBe(401)
  })
})

describe("DELETE /api/admin/users/[id] — soft delete", () => {
  it("soft-deletes the user and invalidates the cache", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({ id: "u-1", role: "CLIENT" } as any)
    vi.mocked(db.user.update).mockResolvedValueOnce({ id: "u-1", role: "CLIENT" } as any)

    const res = await userDELETE(
      buildRequest("http://localhost:3000/api/admin/users/u-1"),
      buildParams("u-1"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
    const updateArgs = vi.mocked(db.user.update).mock.calls[0][0]
    expect(updateArgs.where).toEqual({ id: "u-1" })
    expect(updateArgs.data.deletedAt).toBeInstanceOf(Date)
    expect(invalidateUserCache).toHaveBeenCalledWith("u-1")
  })

  it("returns 404 when the user does not exist", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null)

    const res = await userDELETE(
      buildRequest("http://localhost:3000/api/admin/users/u-404"),
      buildParams("u-404"),
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Usuário não encontrado")
  })
})

// ===========================================================================
// POST /api/admin/users/[id]/lytex-account
// ===========================================================================

describe("POST /api/admin/users/[id]/lytex-account — auth", () => {
  it("returns 401 when auth fails", async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const req = buildJsonRequest("http://localhost:3000/api/admin/users/u-1/lytex-account", {
      lytexRecipientId: "rec-1",
    })
    const res = await lytexPOST(req, buildParams("u-1"))

    expect(res.status).toBe(401)
  })

  it("returns 403 when the session user is not an admin", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({ userId: "u-1", role: "PROVIDER" } as any)

    const req = buildJsonRequest("http://localhost:3000/api/admin/users/u-1/lytex-account", {
      lytexRecipientId: "rec-1",
    })
    const res = await lytexPOST(req, buildParams("u-1"))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Acesso restrito a administradores")
  })
})

describe("POST /api/admin/users/[id]/lytex-account — link sub-account", () => {
  it("links the Lytex recipient and logs the event", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({ id: "u-1", name: "João Silva" } as any)
    const updated = { id: "u-1", name: "João Silva", lytexRecipientId: "rec-abc" }
    vi.mocked(db.user.update).mockResolvedValueOnce(updated as any)

    const req = buildJsonRequest("http://localhost:3000/api/admin/users/u-1/lytex-account", {
      lytexRecipientId: "rec-abc",
    })
    const res = await lytexPOST(req, buildParams("u-1"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.user).toEqual(updated)
    expect(vi.mocked(db.user.update).mock.calls[0][0]).toMatchObject({
      where: { id: "u-1" },
      data: { lytexRecipientId: "rec-abc" },
      select: { id: true, name: true, lytexRecipientId: true },
    })
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-1", lytexRecipientId: "rec-abc" }),
      "admin linked lytex sub-account",
    )
  })

  it("returns 400 when lytexRecipientId is missing", async () => {
    const req = buildJsonRequest("http://localhost:3000/api/admin/users/u-1/lytex-account", {})
    const res = await lytexPOST(req, buildParams("u-1"))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("lytexRecipientId é obrigatório")
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it("returns 404 when the user does not exist", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null)

    const req = buildJsonRequest("http://localhost:3000/api/admin/users/u-404/lytex-account", {
      lytexRecipientId: "rec-1",
    })
    const res = await lytexPOST(req, buildParams("u-404"))

    expect(res.status).toBe(404)
    expect(db.user.update).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// DELETE /api/admin/users/[id]/lytex-account
// ===========================================================================

describe("DELETE /api/admin/users/[id]/lytex-account — unlink sub-account", () => {
  it("returns 403 when the session user is not an admin", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({ userId: "u-1", role: "CLIENT" } as any)

    const res = await lytexDELETE(
      buildRequest("http://localhost:3000/api/admin/users/u-1/lytex-account"),
      buildParams("u-1"),
    )

    expect(res.status).toBe(403)
  })

  it("clears the Lytex recipient and logs the event", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      name: "João Silva",
      lytexRecipientId: "rec-abc",
    } as any)
    vi.mocked(db.user.update).mockResolvedValueOnce({ id: "u-1", name: "João Silva" } as any)

    const res = await lytexDELETE(
      buildRequest("http://localhost:3000/api/admin/users/u-1/lytex-account"),
      buildParams("u-1"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.user).toEqual({ id: "u-1", name: "João Silva" })
    expect(vi.mocked(db.user.update).mock.calls[0][0]).toMatchObject({
      where: { id: "u-1" },
      data: { lytexRecipientId: null },
    })
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-1" }),
      "admin unlinked lytex sub-account",
    )
  })

  it("returns 404 when the user does not exist", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null)

    const res = await lytexDELETE(
      buildRequest("http://localhost:3000/api/admin/users/u-404/lytex-account"),
      buildParams("u-404"),
    )

    expect(res.status).toBe(404)
    expect(db.user.update).not.toHaveBeenCalled()
  })
})
