/**
 * Tests for GET /api/cron/settlements — auto-generate settlement period via cron.
 *
 * Covers:
 *   - Auto-generates settlement from PAID payments
 *   - Returns existing period ID when already generated (idempotent)
 *   - Returns empty message when no payments in period
 *   - 401 when CRON_SECRET is set and key is missing/wrong
 *   - 500 on internal error (caught, not thrown)
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockDb = vi.hoisted(() => ({
  setting: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  settlementPeriod: {
    findFirst: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  payment: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from "../cron/settlements/route"
import { db } from "@/lib/db"

// ── Helpers ────────────────────────────────────────────────────────────────

function resetDbMocks() {
  Object.values(mockDb.setting).forEach((fn) => (fn as any).mockReset())
  Object.values(mockDb.settlementPeriod).forEach((fn) => (fn as any).mockReset())
  Object.values(mockDb.payment).forEach((fn) => (fn as any).mockReset())
}

const _origCronSecret = process.env.CRON_SECRET

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/cron/settlements", () => {
  beforeEach(() => {
    resetDbMocks()
    process.env.CRON_SECRET = "my-cron-secret"
  })

  afterAll(() => {
    process.env.CRON_SECRET = _origCronSecret
  })

  it("generates monthly settlement from PAID payments", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
    vi.mocked(db.settlementPeriod.findFirst).mockResolvedValue(null)
    vi.mocked(db.payment.findMany).mockResolvedValue([
      {
        amount: 50000,
        booking: { providerId: "prov-1", provider: { name: "Paulo", email: "paulo@test.com" } },
      },
      {
        amount: 30000,
        booking: { providerId: "prov-2", provider: { name: "Maria", email: "maria@test.com" } },
      },
    ] as any)
    vi.mocked(db.settlementPeriod.create).mockResolvedValue({
      id: "cron-sp-1",
      totalAmount: 80000,
      totalCommission: 8000,
      totalNet: 72000,
      providerCount: 2,
    } as any)

    const req = new Request("http://localhost/api/cron/settlements?type=MONTHLY", {
      headers: { Authorization: "Bearer my-cron-secret" },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.periodId).toBe("cron-sp-1")
    expect(data.totalAmount).toBe(80000)
    expect(data.totalCommission).toBe(8000)
    expect(data.totalNet).toBe(72000)
    expect(data.providerCount).toBe(2)
  })

  it("returns existing period when already generated (idempotent)", async () => {
    vi.mocked(db.settlementPeriod.findFirst).mockResolvedValue({ id: "existing-sp-1" } as any)

    const req = new Request("http://localhost/api/cron/settlements?type=MONTHLY", {
      headers: { Authorization: "Bearer my-cron-secret" },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.periodId).toBe("existing-sp-1")
    expect(data.message).toBe("Período já existe.")
    // Should not create a new period
    expect(db.settlementPeriod.create).not.toHaveBeenCalled()
  })

  it("returns message when no payments found in period", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
    vi.mocked(db.settlementPeriod.findFirst).mockResolvedValue(null)
    vi.mocked(db.payment.findMany).mockResolvedValue([])

    const req = new Request("http://localhost/api/cron/settlements?type=MONTHLY", {
      headers: { Authorization: "Bearer my-cron-secret" },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.message).toContain("Nenhum pagamento")
    expect(db.settlementPeriod.create).not.toHaveBeenCalled()
  })

  it("returns 401 when CRON_SECRET is set but key is missing", async () => {
    const req = new Request("http://localhost/api/cron/settlements?type=MONTHLY")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.error).toBe("Unauthorized")
  })

  it("returns 401 when CRON_SECRET is set but key is wrong", async () => {
    const req = new Request("http://localhost/api/cron/settlements?type=MONTHLY", {
      headers: { Authorization: "Bearer wrong-key" },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.error).toBe("Unauthorized")
  })

  it("rejects access when CRON_SECRET is empty (fail-closed)", async () => {
    process.env.CRON_SECRET = ""

    const req = new Request("http://localhost/api/cron/settlements?type=MONTHLY")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.error).toMatch(/Unauthorized/i)
  })

  it("catches errors and returns 500 with message", async () => {
    vi.mocked(db.settlementPeriod.findFirst).mockRejectedValue(new Error("DB connection failed"))

    const req = new Request("http://localhost/api/cron/settlements?type=MONTHLY", {
      headers: { Authorization: "Bearer my-cron-secret" },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(500)
    expect(data.error).toContain("DB connection failed")
  })
})
