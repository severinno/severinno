/**
 * Tests for GET /api/admin/finance/export-providers — per-provider CSV export.
 *
 * Covers:
 *   - CSV headers (Prestador, E-mail, Transações, Total, Comissão, Repasse)
 *   - Per-provider aggregation with commission calculation
 *   - Totals row at bottom
 *   - Sorted by total descending
 *   - Content-Type and Content-Disposition headers
 *   - Commission percent from settings
 *   - Empty state
 *   - 403 for non-admin
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

import { GET } from "../admin/finance/export-providers/route"
import { db } from "@/lib/db"

// ── Helpers ────────────────────────────────────────────────────────────────

function resetDbMocks() {
  ;(db.setting as any) = { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() }
  db.payment = {
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  } as any
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/admin/finance/export-providers", () => {
  beforeEach(() => {
    _mockRole = "ADMIN"
    resetDbMocks()
  })

  it("returns CSV with correct provider headers", async () => {
    (vi.mocked(db.setting.findUnique) as any).mockResolvedValue({ key: "PLATFORM_COMMISSION_PERCENT", value: "10" } as any)
    vi.mocked(db.payment.findMany).mockResolvedValue([] as any)

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
    vi.mocked(db.setting.findUnique).mockResolvedValue({ key: "PLATFORM_COMMISSION_PERCENT", value: "10" } as any)
    vi.mocked(db.payment.findMany).mockResolvedValue([] as any)

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const header = text.trim().split("\n")[0]
    expect(header.split(";").length).toBeGreaterThanOrEqual(6)
  })

  it("aggregates payments by provider with commission", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue({ key: "PLATFORM_COMMISSION_PERCENT", value: "10" } as any)
    vi.mocked(db.payment.findMany).mockResolvedValue([
      { amount: 50000, booking: { provider: { id: "prov-1", name: "Paulo Prestador", email: "paulo@test.com" } } },
      { amount: 30000, booking: { provider: { id: "prov-2", name: "Maria Profissional", email: "maria@test.com" } } },
      { amount: 15000, booking: { provider: { id: "prov-1", name: "Paulo Prestador", email: "paulo@test.com" } } },
    ] as any)

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const lines = text.trim().split("\n")
    // Header + 2 providers + 1 totals = 4 lines
    expect(lines).toHaveLength(4)

    // First row (sorted by total descending): Paulo (65000) > Maria (30000)
    const row1 = lines[1]
    expect(row1).toContain("Paulo Prestador")
    expect(row1).toContain("paulo@test.com")
    expect(row1).toContain("2") // 2 transactions
    expect(row1).toContain("650,00") // 65000/100 = R$ 650,00
    expect(row1).toContain("65,00") // 10% commission = R$ 65,00
    expect(row1).toContain("585,00") // net = R$ 585,00

    const row2 = lines[2]
    expect(row2).toContain("Maria Profissional")
    expect(row2).toContain("300,00") // 30000/100 = R$ 300,00
    expect(row2).toContain("30,00") // commission
    expect(row2).toContain("270,00") // net
  })

  it("includes a totals row at the bottom", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue({ key: "PLATFORM_COMMISSION_PERCENT", value: "10" } as any)
    vi.mocked(db.payment.findMany).mockResolvedValue([
      { amount: 50000, booking: { provider: { id: "prov-1", name: "Paulo", email: "paulo@test.com" } } },
      { amount: 30000, booking: { provider: { id: "prov-2", name: "Maria", email: "maria@test.com" } } },
    ] as any)

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const lines = text.trim().split("\n")
    // Header + 2 providers + 1 totals + empty trailing = exactly 4 non-empty
    const dataRows = lines.filter(l => l.length > 0)

    const totalsRow = dataRows[dataRows.length - 1]
    expect(totalsRow).toContain("TOTAL")
    expect(totalsRow).toContain("2") // total transactions
    // total = (50000 + 30000) / 100 = 800,00
    expect(totalsRow).toContain("800,00")
    // commission = 8000 / 100 = 80,00
    expect(totalsRow).toContain("80,00")
    // net = 72000 / 100 = 720,00
    expect(totalsRow).toContain("720,00")
  })

  it("reads commission from settings", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue({ key: "PLATFORM_COMMISSION_PERCENT", value: "15" } as any)
    vi.mocked(db.payment.findMany).mockResolvedValue([
      { amount: 100000, booking: { provider: { id: "prov-1", name: "Paulo", email: "paulo@test.com" } } },
    ] as any)

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const lines = text.trim().split("\n")
    const row = lines[1]
    // 15% commission on 100000 = 15000 → R$ 150,00
    expect(row).toContain("150,00")
    // net = 100000 - 15000 = 85000 → R$ 850,00
    expect(row).toContain("850,00")
  })

  it("uses default 10% commission when setting not found", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
    vi.mocked(db.payment.findMany).mockResolvedValue([
      { amount: 100000, booking: { provider: { id: "prov-1", name: "Paulo", email: "paulo@test.com" } } },
    ] as any)

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const lines = text.trim().split("\n")
    const row = lines[1]
    // 10% default → R$ 100,00 commission
    expect(row).toContain("100,00")
  })

  it("sets correct Content-Type and Content-Disposition headers", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
    vi.mocked(db.payment.findMany).mockResolvedValue([] as any)

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)

    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8")
    const disposition = res.headers.get("Content-Disposition") ?? ""
    expect(disposition).toContain("attachment; filename=")
    expect(disposition).toContain(".csv")
    expect(disposition).toContain("extrato-prestadores-30d-")
  })

  it("returns empty CSV (only headers + totals) when no transactions", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
    vi.mocked(db.payment.findMany).mockResolvedValue([] as any)

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const lines = text.trim().split("\n")
    // Header + totals row = 2 lines (even with empty data)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain("TOTAL")
    expect(lines[1]).toContain("0") // 0 transactions
    expect(lines[1]).toContain("0,00") // 0 total
  })

  it("returns 403 when user is not ADMIN", async () => {
    _mockRole = "PROVIDER"

    const req = new Request("http://localhost/api/admin/finance/export-providers?period=30d")
    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})
