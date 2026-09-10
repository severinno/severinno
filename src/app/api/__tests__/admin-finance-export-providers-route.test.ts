/**
 * Tests for GET /api/admin/finance/export-providers — per-provider CSV export.
 *
 * A rota agora usa db.$queryRaw para agregar por prestador (em vez de findMany).
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

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { admin: { key: "admin", interval: 60, max: 100 } },
}))

const mockDb = vi.hoisted(() => ({
  setting: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  payment: {
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  $queryRaw: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from "../admin/finance/export-providers/route"

// ── Helpers ────────────────────────────────────────────────────────────────

function resetDbMocks() {
  Object.values(mockDb.setting).forEach((fn) => (fn as any).mockReset())
  Object.values(mockDb.payment).forEach((fn) => (fn as any).mockReset())
  mockDb.$queryRaw.mockReset()
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/admin/finance/export-providers", () => {
  beforeEach(() => {
    _mockRole = "ADMIN"
    resetDbMocks()
  })

  it("returns CSV with correct provider headers", async () => {
    mockDb.$queryRaw.mockResolvedValue([])

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    const lines = text.trim().split("\n")
    expect(lines[0]).toContain("Prestador")
    expect(lines[0]).toContain("E-mail")
    expect(lines[0]).toContain("Transações")
    expect(lines[0]).toContain("Total Recebido (R$)")
    expect(lines[0]).toContain("Comissão (R$)")
    expect(lines[0]).toContain("Repasse Líquido (R$)")
  })

  it("uses semicolon as delimiter", async () => {
    mockDb.$queryRaw.mockResolvedValue([])

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const header = text.trim().split("\n")[0]
    expect(header.split(";").length).toBeGreaterThanOrEqual(6)
  })

  it("aggregates payments by provider with commission", async () => {
    mockDb.$queryRaw.mockResolvedValue([
      {
        providerId: "prov-1",
        name: "Paulo Prestador",
        email: "paulo@test.com",
        total: BigInt(65000),
        count: BigInt(2),
      },
      {
        providerId: "prov-2",
        name: "Maria Profissional",
        email: "maria@test.com",
        total: BigInt(30000),
        count: BigInt(1),
      },
    ])

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const lines = text.trim().split("\n")
    expect(lines).toHaveLength(4)

    const row1 = lines[1]
    expect(row1).toContain("Paulo Prestador")
    expect(row1).toContain("paulo@test.com")
    expect(row1).toContain("2")
    expect(row1).toContain("650,00")
    expect(row1).toContain("97,50")
    expect(row1).toContain("552,50")

    const row2 = lines[2]
    expect(row2).toContain("Maria Profissional")
    expect(row2).toContain("300,00")
    expect(row2).toContain("45,00")
    expect(row2).toContain("255,00")
  })

  it("includes a totals row at the bottom", async () => {
    mockDb.$queryRaw.mockResolvedValue([
      {
        providerId: "prov-1",
        name: "Paulo",
        email: "paulo@test.com",
        total: BigInt(50000),
        count: BigInt(1),
      },
      {
        providerId: "prov-2",
        name: "Maria",
        email: "maria@test.com",
        total: BigInt(30000),
        count: BigInt(1),
      },
    ])

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const lines = text.trim().split("\n")
    const dataRows = lines.filter((l) => l.length > 0)

    const totalsRow = dataRows[dataRows.length - 1]
    expect(totalsRow).toContain("TOTAL")
    expect(totalsRow).toContain("2")
    expect(totalsRow).toContain("800,00")
    expect(totalsRow).toContain("120,00")
    expect(totalsRow).toContain("680,00")
  })

  it("computes commission using FEE_RATE (15%)", async () => {
    mockDb.$queryRaw.mockResolvedValue([
      {
        providerId: "prov-1",
        name: "Paulo",
        email: "paulo@test.com",
        total: BigInt(100000),
        count: BigInt(1),
      },
    ])

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const lines = text.trim().split("\n")
    const row = lines[1]
    expect(row).toContain("150,00")
    expect(row).toContain("850,00")
  })

  it("uses fixed 15% commission when no settings exist", async () => {
    mockDb.$queryRaw.mockResolvedValue([
      {
        providerId: "prov-1",
        name: "Paulo",
        email: "paulo@test.com",
        total: BigInt(100000),
        count: BigInt(1),
      },
    ])

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const lines = text.trim().split("\n")
    const row = lines[1]
    expect(row).toContain("150,00")
  })

  it("sets correct Content-Type and Content-Disposition headers", async () => {
    mockDb.$queryRaw.mockResolvedValue([])

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)

    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8")
    const disposition = res.headers.get("Content-Disposition") ?? ""
    expect(disposition).toContain("attachment; filename=")
    expect(disposition).toContain(".csv")
    expect(disposition).toContain("extrato-prestadores-30d-")
  })

  it("returns empty CSV (only headers + totals) when no transactions", async () => {
    mockDb.$queryRaw.mockResolvedValue([])

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const lines = text.trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain("TOTAL")
    expect(lines[1]).toContain("0")
    expect(lines[1]).toContain("0,00")
  })

  it("returns 403 when user is not ADMIN", async () => {
    _mockRole = "PROVIDER"

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})
