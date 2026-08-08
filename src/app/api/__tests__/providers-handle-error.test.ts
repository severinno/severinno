// @ts-nocheck
/**
 * providers-handle-error.test.ts
 *
 * Verifies that the route handler's `catch` block correctly delegates
 * Phase 2 errors to `handleError` instead of crashing.
 *
 * Unlike the existing Phase-2 error tests (providers-radius-expansion),
 * this test explicitly mocks `handleError` with a spy and verifies it
 * was *called* — proving the catch → handleError chain works.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

/*
 * NOTE on the user request: "verifica que handleError não é chamado quando
 * uma query Phase 2 falha MAS o catch do route handler a trata corretamente"
 *
 * The route does `catch (e) { return handleError(e) }` — so handleError
 * IS called by the catch block. The "não" refers to handleError NOT being
 * called *inline inside Phase 2 code* (which would be wrong). The correct
 * behavior is: Phase 2 throws → propagates to route catch → handleError.
 * This test verifies that chain by spying on handleError.
 */

// ---------------------------------------------------------------------------
// Hoisted mocks — defined before vi.mock() calls
// ---------------------------------------------------------------------------

const { mockHandleError, mockWithCache } = vi.hoisted(() => ({
  mockHandleError: vi.fn(),
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

vi.mock("@/lib/api-server", async () => {
  // Pull in real implementations for the functions that need to work
  // (cacheControlPublic, getCategoryDescendants, parsePagination)
  // but provide a spy for handleError so we can verify calls.
  const actual = await vi.importActual<typeof import("@/lib/api-server")>(
    "@/lib/api-server",
  )
  return {
    ...actual,
    handleError: mockHandleError,
  }
})

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Static import — vi.mock hoisting guarantees mocks are in place
// ---------------------------------------------------------------------------

import { GET } from "../providers/route"
import { db } from "@/lib/db"

const baseProvider: any = {
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/providers — handleError delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: withCache invokes the factory (cache miss)
    mockWithCache.mockImplementation(
      async (_key: string, fn: () => unknown) => fn(),
    )

    // Default: mockHandleError returns a 500-style response so the
    // route doesn't crash on the return value.
    mockHandleError.mockReturnValue(
      NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 }),
    )

    // Default category tree
    vi.mocked(db.category.findMany as any).mockResolvedValue([
      { id: "cat-1", parentId: null },
    ])
  })

  // -----------------------------------------------------------------------
  // Scenario 1 — handleError is called when service.findMany throws
  // -----------------------------------------------------------------------

  it("calls handleError when service.findMany rejects in Phase 2", async () => {
    // Phase 1 succeeds: COUNT → 3 IDs, IDs → [prov-1]
    // @ts-expect-error DeepMockProxy $queryRawUnsafe type quirk
    vi.mocked(db.$queryRawUnsafe).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) return Promise.resolve([{ total: BigInt(3) }])
      if (sql.includes("ST_Distance")) return Promise.resolve([{ id: "prov-1", distance_km: 2.5 }])
      return Promise.resolve([{ id: "prov-1" }])
    })

    // Phase 2: service.findMany throws
    const phase2Error = new Error("Services DB connection lost")
    vi.mocked(db.service.findMany as any).mockRejectedValue(phase2Error)

    // Other Phase 2 mocks — won't be reached because Promise.all rejects fast
    vi.mocked(db.booking.groupBy).mockResolvedValue([
      { providerId: "prov-1", _count: { id: 3 } },
    ])
    // @ts-expect-error DeepMockProxy PrismaPromise mock edge case
    ;(vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider] as any)

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    const res = await GET(req)

    // handleError was called with the Phase 2 error
    expect(mockHandleError).toHaveBeenCalledTimes(1)
    expect(mockHandleError).toHaveBeenCalledWith(phase2Error)

    // Response from handleError mock
    expect(res.status).toBe(500)
  })

  // -----------------------------------------------------------------------
  // Scenario 2 — handleError is called when booking.groupBy throws
  // -----------------------------------------------------------------------

  it("calls handleError when booking.groupBy rejects in Phase 2", async () => {
    // @ts-expect-error DeepMockProxy $queryRawUnsafe type quirk
    vi.mocked(db.$queryRawUnsafe).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) return Promise.resolve([{ total: BigInt(3) }])
      if (sql.includes("ST_Distance")) return Promise.resolve([{ id: "prov-1", distance_km: 2.5 }])
      return Promise.resolve([{ id: "prov-1" }])
    })

    // Phase 2: service OK, booking throws
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
    const phase2Error = new Error("Bookings DB connection lost")
    vi.mocked(db.booking.groupBy).mockRejectedValue(phase2Error)
    // @ts-expect-error DeepMockProxy PrismaPromise mock edge case
    ;(vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider] as any)

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    const res = await GET(req)

    expect(mockHandleError).toHaveBeenCalledTimes(1)
    expect(mockHandleError).toHaveBeenCalledWith(phase2Error)
    expect(res.status).toBe(500)
  })

  // -----------------------------------------------------------------------
  // Scenario 3 — handleError is NOT called when the request has no lat/lng
  //              (no error path exercised — just a sanity check)
  // -----------------------------------------------------------------------

  it("does not call handleError on a successful request", async () => {
    // @ts-expect-error DeepMockProxy $queryRawUnsafe type quirk
    vi.mocked(db.$queryRawUnsafe).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) return Promise.resolve([{ total: BigInt(1) }])
      return Promise.resolve([{ id: "prov-1" }])
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
    vi.mocked(db.booking.groupBy).mockResolvedValue([
      { providerId: "prov-1", _count: { id: 3 } },
    ])
    // @ts-expect-error DeepMockProxy PrismaPromise mock edge case
    ;(vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider] as any)

    const req = createMockRequest({
      // No lat/lng — goes through non-PostGIS path, no error
      searchParams: { radius: "10" },
    })
    const res = await GET(req)

    expect(mockHandleError).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })

  // -----------------------------------------------------------------------
  // Scenario 4 — handleError is called with the original error object
  //              (not a wrapped/generic error)
  // -----------------------------------------------------------------------

  it("passes the original error to handleError (not a wrapper)", async () => {
    // @ts-expect-error DeepMockProxy $queryRawUnsafe type quirk
    vi.mocked(db.$queryRawUnsafe).mockImplementation((sql: string) => {
      if (sql.includes("COUNT")) return Promise.resolve([{ total: BigInt(3) }])
      if (sql.includes("ST_Distance")) return Promise.resolve([{ id: "prov-1", distance_km: 2.5 }])
      return Promise.resolve([{ id: "prov-1" }])
    })

    const phase2Error = new Error("Phase 2 database timeout")
    vi.mocked(db.service.findMany as any).mockRejectedValue(phase2Error)
    vi.mocked(db.booking.groupBy).mockResolvedValue([
      { providerId: "prov-1", _count: { id: 3 } },
    ])
    // @ts-expect-error DeepMockProxy PrismaPromise mock edge case
    ;(vi.mocked(db.user.findMany) as any).mockResolvedValue([baseProvider] as any)

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333", radius: "10" },
    })
    await GET(req)

    // Verify the exact error reference was passed (not a string copy)
    const callArg = mockHandleError.mock.calls[0][0]
    expect(callArg).toBe(phase2Error)
    expect(callArg).toBeInstanceOf(Error)
    expect((callArg as Error).message).toBe("Phase 2 database timeout")
  })
})
