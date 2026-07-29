// @ts-nocheck
/**
 * Tests for admin settlement routes.
 *
 * Covers:
 *   GET  /api/admin/settlements          — list periods
 *   POST /api/admin/settlements          — generate new period
 *   GET  /api/admin/settlements/[id]     — detail
 *   POST /api/admin/settlements/[id]     — not supported (400)
 *   POST /api/admin/settlements/[id]/finalize    — finalize
 *   POST /api/admin/settlements/[id]/pay/[providerId]  — mark paid
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

let _mockRole: string | null = null
let _mockSession: { userId: string } | null = null

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (role: string) => {
    if (_mockRole !== role) throw new Error("FORBIDDEN")
    return _mockSession ?? { userId: "admin-1" }
  }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET as listPeriods, POST as generatePeriod } from "../admin/settlements/route"
import { GET as getPeriod, POST as postPeriod } from "../admin/settlements/[id]/route"
import { POST as finalizePeriod } from "../admin/settlements/[id]/finalize/route"
import { POST as payProvider } from "../admin/settlements/[id]/pay/[providerId]/route"
import { db } from "@/lib/db"

// ── Helpers ────────────────────────────────────────────────────────────────

function resetDbMocks() {
  ;(db.settlementPeriod as any) = { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() }
  ;(db.providerSettlement as any) = { findUnique: vi.fn(), update: vi.fn() }
  ;(db.setting as any) = { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() }
  ;(db.payment as any) = { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() }
}

function mockRequest(body?: unknown, method = "POST"): Request {
  return new Request("http://localhost", {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
}

// ── Mock data ──────────────────────────────────────────────────────────────

const mockSettlementPeriod = {
  id: "sp-1",
  type: "MONTHLY",
  status: "PENDING",
  startDate: new Date("2026-01-01"),
  endDate: new Date("2026-02-01"),
  totalAmount: 100000,
  totalCommission: 10000,
  totalNet: 90000,
  providerCount: 2,
  transactionCount: 5,
  finalizedAt: null,
  finalizedBy: null,
  notes: null,
  createdAt: new Date(),
  providers: [
    {
      id: "ps-1",
      status: "PENDING",
      totalAmount: 60000,
      commission: 6000,
      netAmount: 54000,
      transactionCount: 3,
      paidAt: null,
      paidBy: null,
      provider: { id: "prov-1", name: "Paulo Prestador", email: "paulo@test.com" },
    },
    {
      id: "ps-2",
      status: "PAID",
      totalAmount: 40000,
      commission: 4000,
      netAmount: 36000,
      transactionCount: 2,
      paidAt: new Date("2026-02-15"),
      paidBy: "admin-1",
      provider: { id: "prov-2", name: "Maria Profissional", email: "maria@test.com" },
    },
  ],
  _count: { providers: 2 },
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/admin/settlements — list periods", () => {
  beforeEach(() => {
    _mockRole = "ADMIN"
    _mockSession = { userId: "admin-1" }
    resetDbMocks()
  })

  it("returns all settlement periods sorted by date descending", async () => {
    vi.mocked(db.settlementPeriod.findMany).mockResolvedValue([mockSettlementPeriod] as any)

    const res = await listPeriods()
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.items).toHaveLength(1)
    expect(data.total).toBe(1)
    expect(data.items[0].id).toBe("sp-1")
    expect(data.items[0].providers).toHaveLength(2)
  })

  it("returns 403 when user is not ADMIN", async () => {
    _mockRole = "PROVIDER"

    const res = await listPeriods()
    expect(res.status).toBe(403)
  })
})

describe("POST /api/admin/settlements — generate period", () => {
  beforeEach(() => {
    _mockRole = "ADMIN"
    _mockSession = { userId: "admin-1" }
    resetDbMocks()
  })

  it("generates monthly settlement from PAID payments", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue({ key: "PLATFORM_COMMISSION_PERCENT", value: "10" } as any)
    vi.mocked(db.settlementPeriod.findFirst).mockResolvedValue(null)
    vi.mocked(db.payment.findMany).mockResolvedValue([
      { amount: 50000, booking: { providerId: "prov-1", provider: { name: "Paulo", email: "paulo@test.com" } } },
      { amount: 30000, booking: { providerId: "prov-2", provider: { name: "Maria", email: "maria@test.com" } } },
      { amount: 15000, booking: { providerId: "prov-1", provider: { name: "Paulo", email: "paulo@test.com" } } },
    ] as any)
    vi.mocked(db.settlementPeriod.create).mockResolvedValue({
      id: "sp-new-1",
      type: "MONTHLY",
      status: "PENDING",
      totalAmount: 95000,
      totalCommission: 9500,
      totalNet: 85500,
      providerCount: 2,
      transactionCount: 3,
      providers: [
        { provider: { id: "prov-1", name: "Paulo", email: "paulo@test.com" }, totalAmount: 65000, commission: 6500, netAmount: 58500, status: "PENDING" },
        { provider: { id: "prov-2", name: "Maria", email: "maria@test.com" }, totalAmount: 30000, commission: 3000, netAmount: 27000, status: "PENDING" },
      ],
    } as any)

    const req = mockRequest({ type: "MONTHLY" })
    const res = await generatePeriod(req)
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.period.totalAmount).toBe(95000)
    expect(data.period.totalCommission).toBe(9500)
    expect(data.period.totalNet).toBe(85500)
    expect(db.settlementPeriod.create).toHaveBeenCalledTimes(1)
    // Verify nested create includes provider data
    const createCall = vi.mocked(db.settlementPeriod.create).mock.calls[0][0]
    const providerCreate = (createCall.data as any).providers.create as Array<any>
    expect(providerCreate).toHaveLength(2)
    expect(providerCreate[0].providerId).toBe("prov-1")
    expect(providerCreate[0].totalAmount).toBe(65000)
  })

  it("returns 409 when period already exists for dates", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
    vi.mocked(db.settlementPeriod.findFirst).mockResolvedValue({ id: "existing" } as any)

    const req = mockRequest({ type: "MONTHLY" })
    const res = await generatePeriod(req)
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.error).toContain("Já existe")
  })

  it("returns 404 when no payments found in period", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
    vi.mocked(db.settlementPeriod.findFirst).mockResolvedValue(null)
    vi.mocked(db.payment.findMany).mockResolvedValue([])

    const req = mockRequest({ type: "MONTHLY" })
    const res = await generatePeriod(req)
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.error).toContain("Nenhum pagamento")
  })

  it("returns 403 when user is not ADMIN", async () => {
    _mockRole = "PROVIDER"

    const res = await generatePeriod(mockRequest())
    expect(res.status).toBe(403)
  })
})

describe("GET /api/admin/settlements/[id] — detail", () => {
  beforeEach(() => {
    _mockRole = "ADMIN"
    _mockSession = { userId: "admin-1" }
    resetDbMocks()
  })

  it("returns period with providers", async () => {
    vi.mocked(db.settlementPeriod.findUnique).mockResolvedValue(mockSettlementPeriod as any)

    const req = new Request("http://localhost")
    const res = await getPeriod(req, { params: Promise.resolve({ id: "sp-1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.period.id).toBe("sp-1")
    expect(data.period.providers).toHaveLength(2)
  })

  it("returns 404 when period not found", async () => {
    vi.mocked(db.settlementPeriod.findUnique).mockResolvedValue(null)

    const req = new Request("http://localhost")
    const res = await getPeriod(req, { params: Promise.resolve({ id: "nonexistent" }) })
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.error).toContain("não encontrado")
  })

  it("returns 403 when user is not ADMIN", async () => {
    _mockRole = "PROVIDER"

    const req = new Request("http://localhost")
    const res = await getPeriod(req, { params: Promise.resolve({ id: "sp-1" }) })
    expect(res.status).toBe(403)
  })
})

describe("POST /api/admin/settlements/[id] — not supported", () => {
  it("returns 400 with error message", async () => {
    _mockRole = "ADMIN"
    const req = new Request("http://localhost", { method: "POST" })
    const res = await postPeriod(req, { params: Promise.resolve({ id: "sp-1" }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain("Ação inválida")
  })
})

describe("POST /api/admin/settlements/[id]/finalize", () => {
  beforeEach(() => {
    _mockRole = "ADMIN"
    _mockSession = { userId: "admin-1" }
    resetDbMocks()
  })

  it("finalizes a PENDING settlement period", async () => {
    vi.mocked(db.settlementPeriod.findUnique).mockResolvedValue({
      id: "sp-1",
      status: "PENDING",
      notes: null,
    } as any)
    vi.mocked(db.settlementPeriod.update).mockResolvedValue({
      id: "sp-1",
      status: "FINALIZED",
      finalizedAt: new Date(),
      finalizedBy: "admin-1",
      notes: "Fechamento mensal",
      providers: [],
    } as any)

    const req = mockRequest({ notes: "Fechamento mensal" })
    const res = await finalizePeriod(req, { params: Promise.resolve({ id: "sp-1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.period.status).toBe("FINALIZED")
    expect(vi.mocked(db.settlementPeriod.update).mock.calls[0][0].data.status).toBe("FINALIZED")
    expect(vi.mocked(db.settlementPeriod.update).mock.calls[0][0].data.finalizedBy).toBe("admin-1")
  })

  it("returns 404 when period not found", async () => {
    vi.mocked(db.settlementPeriod.findUnique).mockResolvedValue(null)

    const req = mockRequest()
    const res = await finalizePeriod(req, { params: Promise.resolve({ id: "nonexistent" }) })
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.error).toContain("não encontrado")
  })

  it("returns 409 when period already finalized", async () => {
    vi.mocked(db.settlementPeriod.findUnique).mockResolvedValue({
      id: "sp-1",
      status: "FINALIZED",
    } as any)

    const req = mockRequest()
    const res = await finalizePeriod(req, { params: Promise.resolve({ id: "sp-1" }) })
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.error).toContain("já finalizado")
  })

  it("returns 403 when user is not ADMIN", async () => {
    _mockRole = "PROVIDER"

    const req = mockRequest()
    const res = await finalizePeriod(req, { params: Promise.resolve({ id: "sp-1" }) })
    expect(res.status).toBe(403)
  })
})

describe("POST /api/admin/settlements/[id]/pay/[providerId]", () => {
  beforeEach(() => {
    _mockRole = "ADMIN"
    _mockSession = { userId: "admin-1" }
    resetDbMocks()
  })

  it("marks a provider settlement as PAID", async () => {
    vi.mocked(db.providerSettlement.findUnique).mockResolvedValue({
      id: "ps-1",
      status: "PENDING",
    } as any)
    vi.mocked(db.providerSettlement.update).mockResolvedValue({
      id: "ps-1",
      status: "PAID",
      paidAt: new Date(),
      paidBy: "admin-1",
      provider: { id: "prov-1", name: "Paulo", email: "paulo@test.com" },
    } as any)

    const req = new Request("http://localhost", { method: "POST" })
    const res = await payProvider(req, { params: Promise.resolve({ id: "sp-1", providerId: "prov-1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.settlement.status).toBe("PAID")
    expect(vi.mocked(db.providerSettlement.update).mock.calls[0][0].data.paidBy).toBe("admin-1")
  })

  it("finds settlement via compound key (periodId_providerId)", async () => {
    vi.mocked(db.providerSettlement.findUnique).mockResolvedValue({
      id: "ps-1",
      status: "PENDING",
    } as any)
    vi.mocked(db.providerSettlement.update).mockResolvedValue({} as any)

    const req = new Request("http://localhost", { method: "POST" })
    await payProvider(req, { params: Promise.resolve({ id: "sp-1", providerId: "prov-1" }) })

    expect(vi.mocked(db.providerSettlement.findUnique)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { periodId_providerId: { periodId: "sp-1", providerId: "prov-1" } },
      }),
    )
  })

  it("returns 404 when settlement not found", async () => {
    vi.mocked(db.providerSettlement.findUnique).mockResolvedValue(null)

    const req = new Request("http://localhost", { method: "POST" })
    const res = await payProvider(req, { params: Promise.resolve({ id: "sp-1", providerId: "prov-99" }) })
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.error).toContain("não encontrado")
  })

  it("returns 409 when settlement already paid", async () => {
    vi.mocked(db.providerSettlement.findUnique).mockResolvedValue({
      id: "ps-1",
      status: "PAID",
    } as any)

    const req = new Request("http://localhost", { method: "POST" })
    const res = await payProvider(req, { params: Promise.resolve({ id: "sp-1", providerId: "prov-1" }) })
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.error).toContain("já foi pago")
  })

  it("returns 403 when user is not ADMIN", async () => {
    _mockRole = "PROVIDER"

    const req = new Request("http://localhost", { method: "POST" })
    const res = await payProvider(req, { params: Promise.resolve({ id: "sp-1", providerId: "prov-1" }) })
    expect(res.status).toBe(403)
  })
})
