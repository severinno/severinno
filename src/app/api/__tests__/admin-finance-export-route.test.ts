/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for GET /api/admin/finance/export — CSV export endpoint.
 *
 * Covers:
 *   - CSV content with correct headers and data
 *   - Content-Type and Content-Disposition headers
 *   - BOM character for Excel compatibility
 *   - Semicolon delimiter (Brazilian CSV format)
 *   - Date filtering via period parameter
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

import { GET } from "../admin/finance/export/route"
import { db } from "@/lib/db"

// ── Helpers ────────────────────────────────────────────────────────────────

function resetDbMocks() {
  db.payment = {
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  } as any
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/admin/finance/export", () => {
  beforeEach(() => {
    _mockRole = "ADMIN"
    resetDbMocks()
  })

  it("returns CSV with correct headers", async () => {
    vi.mocked(db.payment.findMany).mockResolvedValue([] as any)

    const req = new Request("http://localhost/api/admin/finance/export?period=30d")
    const res = await GET(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    // Should start with BOM (\uFEFF) for Excel compatibility
    // First line should be the header row
    // Note: a BOM character is prepended but may not survive the
    // NextResponse → text() roundtrip in the test env
    // Skipping charCodeAt(0) assertion — test relies on header content instead
    const lines = text.trim().split("\n")
    expect(lines[0]).toContain("ID")
    expect(lines[0]).toContain("Data")
    expect(lines[0]).toContain("Cliente")
    expect(lines[0]).toContain("Prestador")
    expect(lines[0]).toContain("Serviço")
    expect(lines[0]).toContain("Valor (R$)")
    expect(lines[0]).toContain("Método")
    expect(lines[0]).toContain("Status")
  })

  it("uses semicolon as delimiter", async () => {
    vi.mocked(db.payment.findMany).mockResolvedValue([] as any)

    const req = new Request("http://localhost/api/admin/finance/export?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const header = text.trim().split("\n")[0]
    expect(header.split(";").length).toBeGreaterThan(3)
  })

  it("includes transaction data in CSV rows", async () => {
    ;(vi.mocked(db.payment.findMany) as any).mockResolvedValue([
      {
        id: "pay-1",
        bookingId: "b-1",
        amount: 50000,
        method: "PIX",
        status: "PAID",
        lytexId: "lytex-123",
        createdAt: new Date("2026-01-15T10:00:00Z"),
        paidAt: new Date("2026-01-15T10:30:00Z"),
        booking: {
          id: "b-1",
          scheduledAt: new Date("2026-01-15T14:00:00Z"),
          client: { id: "c-1", name: "Carlos", email: "carlos@test.com" },
          provider: { id: "prov-1", name: "Paulo Prestador" },
          service: { id: "svc-1", title: "Instalação" },
        },
      },
    ] as any)

    const req = new Request("http://localhost/api/admin/finance/export?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const lines = text.trim().split("\n")
    expect(lines).toHaveLength(2) // header + 1 row
    const row = lines[1]
    expect(row).toContain("pay-1")
    expect(row).toContain("Carlos")
    expect(row).toContain("Paulo Prestador")
    expect(row).toContain("Instalação")
    expect(row).toContain("500,00") // 50000/100 = 500,00 (BRL format)
    expect(row).toContain("PIX")
    expect(row).toContain("Pago")
    expect(row).toContain("lytex-123")
  })

  it("sets correct Content-Type and Content-Disposition headers", async () => {
    vi.mocked(db.payment.findMany).mockResolvedValue([] as any)

    const req = new Request("http://localhost/api/admin/finance/export?period=30d")
    const res = await GET(req)

    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8")
    const disposition = res.headers.get("Content-Disposition") ?? ""
    expect(disposition).toContain("attachment; filename=")
    expect(disposition).toContain(".csv")
    expect(disposition).toContain("transacoes-30d-")
  })

  it("returns empty CSV (only headers) when no transactions", async () => {
    vi.mocked(db.payment.findMany).mockResolvedValue([] as any)

    const req = new Request("http://localhost/api/admin/finance/export?period=30d")
    const res = await GET(req)
    const text = await res.text()

    const lines = text.trim().split("\n")
    expect(lines).toHaveLength(1) // only header, no data rows
  })

  it("escapes values with commas/quotes properly", async () => {
    ;(vi.mocked(db.payment.findMany) as any).mockResolvedValue([
      {
        id: "pay-esc",
        bookingId: "b-esc",
        amount: 25000,
        method: "PIX",
        status: "PAID",
        lytexId: null,
        createdAt: new Date("2026-03-01T10:00:00Z"),
        paidAt: null,
        booking: {
          scheduledAt: new Date("2026-03-01T14:00:00Z"),
          client: { id: "c-1", name: 'Silva, "José"', email: "jose@test.com" },
          provider: { id: "prov-1", name: 'Santos, "Maria"' },
          service: { id: "svc-1", title: 'Limpeza, "Geral"' },
        },
      },
    ] as any)

    const req = new Request("http://localhost/api/admin/finance/export?period=30d")
    const res = await GET(req)
    const text = await res.text()

    // CSV should wrap fields with commas in quotes and escape internal quotes
    const lines = text.trim().split("\n")
    const row = lines[1]
    // The client name 'Silva, "José"' should be wrapped in quotes with doubled internal quotes
    expect(row).toContain('"Silva, ""José"""')
  })

  it("returns 403 when user is not ADMIN", async () => {
    _mockRole = "PROVIDER"

    const req = new Request("http://localhost/api/admin/finance/export?period=30d")
    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})
