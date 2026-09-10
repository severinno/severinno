/**
 * Tests for GET /api/admin/finance — aggregated financial dashboard.
 *
 * A rota agora usa:
 *   1. db.payment.groupBy (2x) — summary + method stats
 *   2. db.payment.findMany (1x) — transactions paginadas
 *   3. db.payment.count (1x)
 *   4. db.payment.aggregate (2x) — MRR current + previous
 *   5. db.$queryRaw (3x) — monthly revenue, provider aggregation, MRR history
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

let _mockRole: string | null = null

import { makeAuthError } from "@/lib/__tests__/helpers/auth-mock"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (role: string) => {
    if (_mockRole !== role) throw makeAuthError("FORBIDDEN")
  }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/api-server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, handleError: vi.fn((e: unknown) => (actual as any).handleError(e)) }
})

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { admin: { key: "admin", interval: 60, max: 100 } },
}))

const mockDb = vi.hoisted(() => ({
  setting: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  payment: {
    groupBy: vi.fn(),
    findMany: vi.fn(),
    aggregate: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  $queryRaw: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from "../admin/finance/route"
import { db } from "@/lib/db"

// ── Helpers ────────────────────────────────────────────────────────────────

function resetDbMocks() {
  Object.values(mockDb.setting).forEach((fn) => (fn as any).mockReset())
  Object.values(mockDb.payment).forEach((fn) => (fn as any).mockReset())
  mockDb.$queryRaw.mockReset()
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/admin/finance", () => {
  beforeEach(() => {
    _mockRole = "ADMIN"
    resetDbMocks()
  })

  function setupBasicMocks() {
    // 2x groupBy: summary + method stats
    vi.mocked(db.payment.groupBy)
      .mockResolvedValueOnce([
        { status: "PAID", _sum: { amount: 95000 }, _count: { _all: 3 } },
        { status: "PENDING", _sum: { amount: 20000 }, _count: { _all: 1 } },
        { status: "REFUNDED", _sum: { amount: 10000 }, _count: { _all: 1 } },
      ] as any)
      .mockResolvedValueOnce([
        { method: "PIX", _sum: { amount: 80000 }, _count: { _all: 2 } },
        { method: "CARD", _sum: { amount: 15000 }, _count: { _all: 1 } },
      ] as any)

    // 1x findMany: transactions paginadas
    vi.mocked(db.payment.findMany).mockResolvedValueOnce([
      {
        id: "pay-1",
        amount: 50000,
        method: "PIX",
        status: "PAID",
        createdAt: new Date("2026-01-15"),
        booking: {
          id: "b-1",
          scheduledAt: new Date("2026-01-15"),
          status: "COMPLETED",
          client: { id: "c-1", name: "Carlos", email: "carlos@test.com" },
          provider: { id: "prov-1", name: "Paulo Prestador" },
          service: { id: "svc-1", title: "Instalação" },
        },
      },
    ] as any)

    // count
    vi.mocked(db.payment.count).mockResolvedValue(5)

    // 2x aggregate: MRR current + previous
    vi.mocked(db.payment.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { _all: 0 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { _all: 0 } } as any)

    // 3x $queryRaw: monthly revenue, provider aggregation, MRR history
    mockDb.$queryRaw
      .mockResolvedValueOnce([]) // monthly revenue
      .mockResolvedValueOnce([]) // provider aggregation
      .mockResolvedValueOnce([]) // MRR history
  }

  it("returns summary by payment status (PAID/PENDING/REFUNDED)", async () => {
    setupBasicMocks()

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.summary.PAID).toEqual({ total: 95000, count: 3 })
    expect(data.summary.PENDING).toEqual({ total: 20000, count: 1 })
    expect(data.summary.REFUNDED).toEqual({ total: 10000, count: 1 })
  })

  it("calculates average ticket from paid payments", async () => {
    vi.mocked(db.payment.groupBy)
      .mockResolvedValueOnce([
        { status: "PAID", _sum: { amount: 90000 }, _count: { _all: 3 } },
      ] as any)
      .mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.findMany).mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.count).mockResolvedValue(3)
    vi.mocked(db.payment.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { _all: 0 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { _all: 0 } } as any)
    mockDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(data.averageTicket).toBe(30000)
  })

  it("returns per-provider aggregation with commission", async () => {
    vi.mocked(db.payment.groupBy)
      .mockResolvedValueOnce([
        { status: "PAID", _sum: { amount: 95000 }, _count: { _all: 3 } },
      ] as any)
      .mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.findMany).mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.count).mockResolvedValue(3)
    vi.mocked(db.payment.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { _all: 0 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { _all: 0 } } as any)
    // $queryRaw: monthly, providers, MRR history
    mockDb.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          providerId: "prov-1",
          name: "Paulo Prestador",
          email: "paulo@test.com",
          avatarUrl: null,
          total: BigInt(65000),
          count: BigInt(2),
        },
        {
          providerId: "prov-2",
          name: "Maria Profissional",
          email: "maria@test.com",
          avatarUrl: "avatar.jpg",
          total: BigInt(30000),
          count: BigInt(1),
        },
      ])
      .mockResolvedValueOnce([])

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(data.providerStats).toHaveLength(2)
    expect(data.providerStats[0].name).toBe("Paulo Prestador")
    expect(data.providerStats[0].total).toBe(65000)
    expect(data.providerStats[0].commission).toBe(9750)
    expect(data.providerStats[0].net).toBe(55250)
    expect(data.providerStats[1].name).toBe("Maria Profissional")
    expect(data.providerStats[1].total).toBe(30000)
    expect(data.providerStats[1].commission).toBe(4500)
    expect(data.providerStats[1].net).toBe(25500)
  })

  it("returns payment method stats", async () => {
    setupBasicMocks()

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(data.paymentMethods).toHaveLength(2)
    const pix = data.paymentMethods.find((m: any) => m.method === "PIX")
    expect(pix.total).toBe(80000)
    expect(pix.count).toBe(2)
  })

  it("returns fixed commission percent (FEE_RATE)", async () => {
    setupBasicMocks()

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(data.commissionPercent).toBe(15)
  })

  it("returns fixed 15% commission when no settings exist", async () => {
    vi.mocked(db.payment.groupBy)
      .mockResolvedValueOnce([
        { status: "PAID", _sum: { amount: 100000 }, _count: { _all: 2 } },
      ] as any)
      .mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.findMany).mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.count).mockResolvedValue(2)
    vi.mocked(db.payment.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { _all: 0 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { _all: 0 } } as any)
    mockDb.$queryRaw.mockResolvedValue([])

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(data.commissionPercent).toBe(15)
  })

  it("returns 403 when user is not ADMIN", async () => {
    _mockRole = "PROVIDER"

    const req = new Request("http://localhost/api/admin/finance")
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it("handles empty result set gracefully", async () => {
    vi.mocked(db.payment.groupBy)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.findMany).mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.count).mockResolvedValue(0)
    vi.mocked(db.payment.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { _all: 0 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { _all: 0 } } as any)
    mockDb.$queryRaw.mockResolvedValue([])

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.summary.PAID.total).toBe(0)
    expect(data.summary.PAID.count).toBe(0)
    expect(data.paymentMethods).toHaveLength(0)
    expect(data.providerStats).toHaveLength(0)
    expect(data.mrr.current).toBe(0)
    expect(data.mrr.previous).toBe(0)
    expect(data.mrr.growth).toBe(0)
    expect(data.transactions).toHaveLength(0)
    expect(data.total).toBe(0)
  })

  it("paginates transactions with default page/limit", async () => {
    vi.mocked(db.payment.groupBy)
      .mockResolvedValueOnce([
        { status: "PAID", _sum: { amount: 95000 }, _count: { _all: 3 } },
      ] as any)
      .mockResolvedValueOnce([] as any)
    const txData = Array.from({ length: 25 }, (_, i) => ({
      id: `pay-tx-${i}`,
      amount: 10000,
      method: "PIX",
      status: "PAID",
      createdAt: new Date(),
      bookingId: `b-${i}`,
      lytexId: null,
      booking: null,
    }))
    vi.mocked(db.payment.findMany).mockResolvedValueOnce(txData as any)
    vi.mocked(db.payment.count).mockResolvedValue(25)
    vi.mocked(db.payment.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { _all: 0 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { _all: 0 } } as any)
    mockDb.$queryRaw.mockResolvedValue([])

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(data.page).toBe(1)
    expect(data.limit).toBe(20)
    expect(data.total).toBe(25)
  })

  it("respects period parameter (7d vs 30d vs all)", async () => {
    vi.mocked(db.payment.groupBy)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.findMany).mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.count).mockResolvedValue(0)
    vi.mocked(db.payment.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { _all: 0 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { _all: 0 } } as any)
    mockDb.$queryRaw.mockResolvedValue([])

    const req = new Request("http://localhost/api/admin/finance?period=7d")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.period).toBe("7d")
  })
})
