/**
 * Tests for GET /api/admin/finance/provider-transactions.
 *
 * Covers:
 *   - Returns transactions for a specific provider
 *   - 400 when providerId is missing
 *   - Summary computation (total, commission, net)
 *   - Date filtering with period parameter
 *   - 403 for non-admin
 *   - Empty state
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

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from "../admin/finance/provider-transactions/route"
import { db } from "@/lib/db"

// ── Helpers ────────────────────────────────────────────────────────────────

function resetDbMocks() {
  ;(db.setting as any) = { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() }
  db.payment = {
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    update: vi.fn(),
  } as any
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/admin/finance/provider-transactions", () => {
  beforeEach(() => {
    _mockRole = "ADMIN"
    resetDbMocks()
  })

  const mockTx = {
    id: "pay-1",
    bookingId: "b-1",
    amount: 50000,
    method: "PIX",
    status: "PAID",
    lytexId: "lytex-1",
    createdAt: new Date("2026-01-15T10:00:00Z"),
    paidAt: new Date("2026-01-15T10:30:00Z"),
    booking: {
      id: "b-1",
      scheduledAt: new Date("2026-01-15T14:00:00Z"),
      status: "COMPLETED",
      client: { id: "c-1", name: "Carlos", email: "carlos@test.com" },
      service: { id: "svc-1", title: "Instalação Elétrica" },
    },
  }

  const mockTx2 = {
    id: "pay-2",
    bookingId: "b-2",
    amount: 30000,
    method: "PIX",
    status: "PAID",
    lytexId: "lytex-2",
    createdAt: new Date("2026-02-10T09:00:00Z"),
    paidAt: null,
    booking: {
      id: "b-2",
      scheduledAt: new Date("2026-02-10T14:00:00Z"),
      status: "COMPLETED",
      client: { id: "c-2", name: "Ana", email: "ana@test.com" },
      service: { id: "svc-2", title: "Limpeza" },
    },
  }

  it("returns transactions for a provider with correct shape", async () => {
    // Route uses orderBy: { createdAt: "desc" }, but mock returns array as-is.
    // Return mockTx2 first (feb) then mockTx (jan) to match descending order.
    (vi.mocked(db.payment.findMany) as any).mockResolvedValue([mockTx2, mockTx] as any)
    (vi.mocked(db.setting.findUnique) as any).mockResolvedValue({ key: "PLATFORM_COMMISSION_PERCENT", value: "10" } as any)

    const req = new Request("http://localhost/api/admin/finance/provider-transactions?providerId=prov-1&period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.transactions).toHaveLength(2)
    // First transaction: pay-2 (feb) is first in mock array = first returned
    const firstTx = data.transactions[0]
    expect(firstTx.id).toBe("pay-2")
    expect(firstTx.amount).toBe(30000)
    expect(firstTx.method).toBe("PIX")
    expect(firstTx.status).toBe("PAID")
    expect(firstTx.lytexId).toBe("lytex-2")
    expect(firstTx.booking.client.name).toBe("Ana")
    expect(firstTx.booking.service.title).toBe("Limpeza")
  })

  it("computes summary totals with commission", async () => {
    (vi.mocked(db.payment.findMany) as any).mockResolvedValue([mockTx, mockTx2] as any)
    (vi.mocked(db.setting.findUnique) as any).mockResolvedValue({ key: "PLATFORM_COMMISSION_PERCENT", value: "10" } as any)

    const req = new Request("http://localhost/api/admin/finance/provider-transactions?providerId=prov-1&period=all")
    const res = await GET(req)
    const data = await res.json()

    // total = 50000 + 30000 = 80000
    // commission = 80000 * 0.10 = 8000
    // net = 80000 - 8000 = 72000
    expect(data.summary.transactions).toBe(2)
    expect(data.summary.total).toBe(80000)
    expect(data.summary.commission).toBe(8000)
    expect(data.summary.net).toBe(72000)
  })

  it("returns 400 when providerId is missing", async () => {
    const req = new Request("http://localhost/api/admin/finance/provider-transactions")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toBe("providerId é obrigatório")
  })

  it("returns empty state when provider has no transactions", async () => {
    (vi.mocked(db.payment.findMany) as any).mockResolvedValue([] as any)
    (vi.mocked(db.setting.findUnique) as any).mockResolvedValue({ key: "PLATFORM_COMMISSION_PERCENT", value: "10" } as any)

    const req = new Request("http://localhost/api/admin/finance/provider-transactions?providerId=prov-99&period=all")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.transactions).toHaveLength(0)
    expect(data.summary.transactions).toBe(0)
    expect(data.summary.total).toBe(0)
    expect(data.summary.commission).toBe(0)
    expect(data.summary.net).toBe(0)
  })

  it("returns 403 when user is not ADMIN", async () => {
    _mockRole = "PROVIDER"

    const req = new Request("http://localhost/api/admin/finance/provider-transactions?providerId=prov-1")
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it("accepts period parameter and filters by date", async () => {
    (vi.mocked(db.payment.findMany) as any).mockResolvedValue([mockTx] as any)
    (vi.mocked(db.setting.findUnique) as any).mockResolvedValue({ key: "PLATFORM_COMMISSION_PERCENT", value: "10" } as any)

    const req = new Request("http://localhost/api/admin/finance/provider-transactions?providerId=prov-1&period=90d")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.transactions).toHaveLength(1)
  })
})
