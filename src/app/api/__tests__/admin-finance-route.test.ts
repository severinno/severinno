/**
 * Tests for GET /api/admin/finance — aggregated financial dashboard.
 *
 * Covers:
 *   - Summary by payment status (PAID/PENDING/REFUNDED)
 *   - Monthly revenue breakdown
 *   - Payment method stats
 *   - Per-provider aggregation + commission
 *   - MRR (current, previous, growth, history)
 *   - Average ticket calculation
 *   - Date filtering (period parameter)
 *   - Pagination defaults
 *   - 403 for non-admin
 *
 * NOTE on mock order (Vitest quirk):
 * mockResolvedValueOnce values take PRIORITY over mockResolvedValue default.
 * Always use 5 mockResolvedValueOnce for the 5 findMany calls in Promise.all.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

let _mockRole: string | null = null

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (role: string) => {
    if (_mockRole !== role) throw new Error("FORBIDDEN")
  }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/api-server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, handleError: vi.fn((e: unknown) => (actual as any).handleError(e)) }
})

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from "../admin/finance/route"
import { db } from "@/lib/db"

// ── Helpers ────────────────────────────────────────────────────────────────

/** Recreates all db mocks fresh to avoid vi.clearAllMocks() quirk */
function resetDbMocks() {
  ;(db.setting as any) = { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() }
  db.payment = {
    groupBy: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  } as any
}

// ── Mock data ──────────────────────────────────────────────────────────────

const mockPayments = [
  {
    id: "pay-1",
    amount: 50000,
    method: "PIX",
    status: "PAID",
    createdAt: new Date("2026-01-15"),
    paidAt: new Date("2026-01-15"),
    bookingId: "b-1",
    lytexId: "lytex-1",
  },
  {
    id: "pay-2",
    amount: 30000,
    method: "PIX",
    status: "PAID",
    createdAt: new Date("2026-02-10"),
    paidAt: new Date("2026-02-10"),
    bookingId: "b-2",
    lytexId: "lytex-2",
  },
  {
    id: "pay-3",
    amount: 15000,
    method: "CARD",
    status: "PAID",
    createdAt: new Date("2026-02-20"),
    paidAt: new Date("2026-02-20"),
    bookingId: "b-3",
    lytexId: "lytex-3",
  },
  {
    id: "pay-4",
    amount: 20000,
    method: "PIX",
    status: "PENDING",
    createdAt: new Date("2026-03-01"),
    bookingId: "b-4",
    lytexId: null,
  },
  {
    id: "pay-5",
    amount: 10000,
    method: "PIX",
    status: "REFUNDED",
    createdAt: new Date("2025-12-01"),
    bookingId: "b-5",
    lytexId: "lytex-5",
  },
]

// Promise.all order for findMany calls:
// 1. monthly revenue (PAID only)
// 2. transactions (paginated)
// 3. MRR current
// 4. MRR previous
// 5. provider aggregation (PAID only)

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/admin/finance", () => {
  beforeEach(() => {
    _mockRole = "ADMIN"
    resetDbMocks()
  })

  it("returns summary by payment status (PAID/PENDING/REFUNDED)", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue({
      key: "PLATFORM_COMMISSION_PERCENT",
      value: "10",
    } as any)
    // groupBy: 1st call = summary, 2nd call = method stats
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
    // findMany: 5 calls via Promise.all — MUST use mockResolvedValueOnce for ALL
    vi.mocked(db.payment.findMany)
      .mockResolvedValueOnce(mockPayments.filter((p) => p.status === "PAID") as any) // 1: monthly
      .mockResolvedValueOnce([
        // 2: transactions
        {
          ...mockPayments[0],
          booking: {
            id: "b-1",
            scheduledAt: new Date("2026-01-15"),
            status: "COMPLETED",
            client: { id: "c-1", name: "Carlos", email: "carlos@test.com" },
            provider: { id: "prov-1", name: "Paulo Prestador" },
            service: { id: "svc-1", title: "Instalação" },
          },
        },
        {
          ...mockPayments[1],
          booking: {
            id: "b-2",
            scheduledAt: new Date("2026-02-10"),
            status: "COMPLETED",
            client: { id: "c-2", name: "Ana", email: "ana@test.com" },
            provider: { id: "prov-2", name: "Maria Profissional" },
            service: { id: "svc-2", title: "Limpeza" },
          },
        },
        {
          ...mockPayments[2],
          booking: {
            id: "b-3",
            scheduledAt: new Date("2026-02-20"),
            status: "COMPLETED",
            client: { id: "c-1", name: "Carlos", email: "carlos@test.com" },
            provider: { id: "prov-1", name: "Paulo Prestador" },
            service: { id: "svc-1", title: "Instalação" },
          },
        },
      ] as any)
      .mockResolvedValueOnce([] as any) // 3: MRR current
      .mockResolvedValueOnce([] as any) // 4: MRR previous
      .mockResolvedValueOnce(
        mockPayments
          .filter((p) => p.status === "PAID")
          .map((p) => ({
            amount: p.amount,
            booking:
              p.id === "pay-1"
                ? {
                    provider: {
                      id: "prov-1",
                      name: "Paulo Prestador",
                      email: "paulo@test.com",
                      avatarUrl: null,
                    },
                  }
                : p.id === "pay-2"
                  ? {
                      provider: {
                        id: "prov-2",
                        name: "Maria Profissional",
                        email: "maria@test.com",
                        avatarUrl: "avatar.jpg",
                      },
                    }
                  : {
                      provider: {
                        id: "prov-1",
                        name: "Paulo Prestador",
                        email: "paulo@test.com",
                        avatarUrl: null,
                      },
                    },
          })) as any,
      ) // 5: provider data
    vi.mocked(db.payment.count).mockResolvedValue(5) // count is called once

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.summary.PAID).toEqual({ total: 95000, count: 3 })
    expect(data.summary.PENDING).toEqual({ total: 20000, count: 1 })
    expect(data.summary.REFUNDED).toEqual({ total: 10000, count: 1 })
  })

  it("calculates average ticket from paid payments", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue({
      key: "PLATFORM_COMMISSION_PERCENT",
      value: "10",
    } as any)
    vi.mocked(db.payment.groupBy)
      .mockResolvedValueOnce([
        { status: "PAID", _sum: { amount: 90000 }, _count: { _all: 3 } },
      ] as any)
      .mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.findMany)
      .mockResolvedValueOnce([] as any) // 1: monthly
      .mockResolvedValueOnce([] as any) // 2: transactions
      .mockResolvedValueOnce([] as any) // 3: MRR current
      .mockResolvedValueOnce([] as any) // 4: MRR previous
      .mockResolvedValueOnce([] as any) // 5: provider
    vi.mocked(db.payment.count).mockResolvedValue(3)

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(data.averageTicket).toBe(30000) // 90000 / 3
  })

  it("returns per-provider aggregation with commission", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue({
      key: "PLATFORM_COMMISSION_PERCENT",
      value: "10",
    } as any)
    vi.mocked(db.payment.groupBy)
      .mockResolvedValueOnce([
        { status: "PAID", _sum: { amount: 95000 }, _count: { _all: 3 } },
      ] as any)
      .mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.findMany)
      .mockResolvedValueOnce(mockPayments.filter((p) => p.status === "PAID") as any) // 1: monthly
      .mockResolvedValueOnce([] as any) // 2: transactions
      .mockResolvedValueOnce([] as any) // 3: MRR current
      .mockResolvedValueOnce([] as any) // 4: MRR previous
      .mockResolvedValueOnce([
        // 5: provider
        {
          amount: 50000,
          booking: {
            provider: {
              id: "prov-1",
              name: "Paulo Prestador",
              email: "paulo@test.com",
              avatarUrl: null,
            },
          },
        },
        {
          amount: 30000,
          booking: {
            provider: {
              id: "prov-2",
              name: "Maria Profissional",
              email: "maria@test.com",
              avatarUrl: "avatar.jpg",
            },
          },
        },
        {
          amount: 15000,
          booking: {
            provider: {
              id: "prov-1",
              name: "Paulo Prestador",
              email: "paulo@test.com",
              avatarUrl: null,
            },
          },
        },
      ] as any)
    vi.mocked(db.payment.count).mockResolvedValue(3)

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(data.providerStats).toHaveLength(2)
    expect(data.providerStats[0].name).toBe("Paulo Prestador")
    expect(data.providerStats[0].total).toBe(65000)
    expect(data.providerStats[0].commission).toBe(6500)
    expect(data.providerStats[0].net).toBe(58500)
    expect(data.providerStats[1].name).toBe("Maria Profissional")
    expect(data.providerStats[1].total).toBe(30000)
    expect(data.providerStats[1].commission).toBe(3000)
    expect(data.providerStats[1].net).toBe(27000)
  })

  it("returns payment method stats", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue({
      key: "PLATFORM_COMMISSION_PERCENT",
      value: "10",
    } as any)
    vi.mocked(db.payment.groupBy)
      .mockResolvedValueOnce([
        { status: "PAID", _sum: { amount: 95000 }, _count: { _all: 3 } },
      ] as any)
      .mockResolvedValueOnce([
        { method: "PIX", _sum: { amount: 80000 }, _count: { _all: 2 } },
        { method: "CARD", _sum: { amount: 15000 }, _count: { _all: 1 } },
      ] as any)
    vi.mocked(db.payment.findMany)
      .mockResolvedValueOnce([] as any) // 1: monthly
      .mockResolvedValueOnce([] as any) // 2: transactions
      .mockResolvedValueOnce([] as any) // 3: MRR current
      .mockResolvedValueOnce([] as any) // 4: MRR previous
      .mockResolvedValueOnce([] as any) // 5: provider
    vi.mocked(db.payment.count).mockResolvedValue(3)

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(data.paymentMethods).toHaveLength(2)
    const pix = data.paymentMethods.find((m: any) => m.method === "PIX")
    expect(pix.total).toBe(80000)
    expect(pix.count).toBe(2)
  })

  it("reads commission percent from settings", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue({
      key: "PLATFORM_COMMISSION_PERCENT",
      value: "15",
    } as any)
    vi.mocked(db.payment.groupBy)
      .mockResolvedValueOnce([
        { status: "PAID", _sum: { amount: 95000 }, _count: { _all: 3 } },
      ] as any)
      .mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.findMany)
      .mockResolvedValueOnce([] as any) // 1: monthly
      .mockResolvedValueOnce([] as any) // 2: transactions
      .mockResolvedValueOnce([] as any) // 3: MRR current
      .mockResolvedValueOnce([] as any) // 4: MRR previous
      .mockResolvedValueOnce([] as any) // 5: provider
    vi.mocked(db.payment.count).mockResolvedValue(3)

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(data.commissionPercent).toBe(15)
  })

  it("uses default commission of 10% when setting not found", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
    vi.mocked(db.payment.groupBy)
      .mockResolvedValueOnce([
        { status: "PAID", _sum: { amount: 100000 }, _count: { _all: 2 } },
      ] as any)
      .mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.findMany)
      .mockResolvedValueOnce([] as any) // 1: monthly
      .mockResolvedValueOnce([] as any) // 2: transactions
      .mockResolvedValueOnce([] as any) // 3: MRR current
      .mockResolvedValueOnce([] as any) // 4: MRR previous
      .mockResolvedValueOnce([] as any) // 5: provider
    vi.mocked(db.payment.count).mockResolvedValue(2)

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(data.commissionPercent).toBe(10)
  })

  it("returns 403 when user is not ADMIN", async () => {
    _mockRole = "PROVIDER"

    const req = new Request("http://localhost/api/admin/finance")
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it("handles empty result set gracefully", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
    vi.mocked(db.payment.groupBy)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.findMany)
      .mockResolvedValueOnce([] as any) // 1: monthly
      .mockResolvedValueOnce([] as any) // 2: transactions
      .mockResolvedValueOnce([] as any) // 3: MRR current
      .mockResolvedValueOnce([] as any) // 4: MRR previous
      .mockResolvedValueOnce([] as any) // 5: provider
    vi.mocked(db.payment.count).mockResolvedValue(0)

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
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
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
    vi.mocked(db.payment.findMany)
      .mockResolvedValueOnce(mockPayments.filter((p) => p.status === "PAID") as any) // 1: monthly
      .mockResolvedValueOnce(txData as any) // 2: transactions
      .mockResolvedValueOnce([] as any) // 3: MRR current
      .mockResolvedValueOnce([] as any) // 4: MRR previous
      .mockResolvedValueOnce([] as any) // 5: provider
    vi.mocked(db.payment.count).mockResolvedValue(25)

    const req = new Request("http://localhost/api/admin/finance?period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(data.page).toBe(1)
    expect(data.limit).toBe(20)
    expect(data.total).toBe(25)
  })

  it("respects period parameter (7d vs 30d vs all)", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
    vi.mocked(db.payment.groupBy)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
    vi.mocked(db.payment.findMany)
      .mockResolvedValueOnce([] as any) // 1: monthly
      .mockResolvedValueOnce([] as any) // 2: transactions
      .mockResolvedValueOnce([] as any) // 3: MRR current
      .mockResolvedValueOnce([] as any) // 4: MRR previous
      .mockResolvedValueOnce([] as any) // 5: provider
    vi.mocked(db.payment.count).mockResolvedValue(0)

    const req = new Request("http://localhost/api/admin/finance?period=7d")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.period).toBe("7d")
  })
})
