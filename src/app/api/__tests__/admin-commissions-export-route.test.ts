import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  booking: {
    findMany: vi.fn(),
  },
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

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

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from "../admin/commissions/export/route"

// ── Mock data ──────────────────────────────────────────────────────────────

const mockBookings = [
  {
    id: "b-1",
    amount: 1000,
    status: "COMPLETED",
    createdAt: new Date("2025-01-15"),
    provider: { id: "prov-1", name: "João Prestador" },
  },
  {
    id: "b-2",
    amount: 500,
    status: "COMPLETED",
    createdAt: new Date("2025-02-10"),
    provider: { id: "prov-1", name: "João Prestador" },
  },
  {
    id: "b-3",
    amount: 2000,
    status: "COMPLETED",
    createdAt: new Date("2025-02-20"),
    provider: { id: "prov-2", name: "Maria Profissional" },
  },
  {
    id: "b-4",
    amount: 300,
    status: "CONFIRMED",
    createdAt: new Date("2025-03-01"),
    provider: { id: "prov-1", name: "João Prestador" },
  },
]

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/admin/commissions/export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockRole = "ADMIN"
  })

  it("returns CSV with correct Content-Type and Content-Disposition", async () => {
    mockDb.booking.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/admin/commissions/export?year=2025")
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8")
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="comissoes-2025.csv"')
  })

  it("includes summary section with correct totals", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)

    const req = new Request("http://localhost/api/admin/commissions/export?year=2025")
    const res = await GET(req, { params: Promise.resolve({}) })
    const csv = await res.text()

    expect(csv).toContain("=== RESUMO ===")
    expect(csv).toContain("Ano,2025")
    // BRL values are CSV-quoted because they contain commas
    expect(csv).toContain('Receita Bruta,"R$ 3.800,00"')
    expect(csv).toContain('Comissão da Plataforma (15%),"R$ 570,00"')
    expect(csv).toContain('Repassado aos Prestadores (85%),"R$ 3.230,00"')
    expect(csv).toContain("Bookings PAID,4")
    expect(csv).toContain("Bookings Completos,3")
  })

  it("includes monthly breakdown section", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)

    const req = new Request("http://localhost/api/admin/commissions/export?year=2025")
    const res = await GET(req, { params: Promise.resolve({}) })
    const csv = await res.text()

    expect(csv).toContain("=== RECEITA MENSAL ===")
    expect(csv).toContain("Janeiro")
    expect(csv).toContain("Fevereiro")
    expect(csv).toContain("Março")
    expect(csv).toContain("Mês,Bruto,Comissão,Repassado,Agendamentos")
    expect(csv).toContain('Janeiro,"R$ 1.000,00","R$ 150,00","R$ 850,00",1')
  })

  it("includes per-provider breakdown with correct data", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)

    const req = new Request("http://localhost/api/admin/commissions/export?year=2025")
    const res = await GET(req, { params: Promise.resolve({}) })
    const csv = await res.text()

    expect(csv).toContain("=== REPASSES POR PRESTADOR ===")
    // Order: Maria (2000) first, then João (1800)
    expect(csv.indexOf("Maria Profissional")).toBeLessThan(csv.indexOf("João Prestador"))
    // Maria: 1 booking, 1 completed, 2000 gross, 300 commission, 1700 net (CSV-quoted BRL)
    expect(csv).toContain('Maria Profissional,1,1,"R$ 2.000,00","R$ 300,00","R$ 1.700,00"')
    // João: 3 bookings, 2 completed, 1800 gross, 270 commission, 1530 net
    expect(csv).toContain('João Prestador,3,2,"R$ 1.800,00","R$ 270,00","R$ 1.530,00"')
  })

  it("returns empty sections when no bookings exist", async () => {
    mockDb.booking.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/admin/commissions/export?year=2025")
    const res = await GET(req, { params: Promise.resolve({}) })
    const csv = await res.text()

    expect(csv).toContain("=== RESUMO ===")
    // BRL value is CSV-quoted
    expect(csv).toContain('Receita Bruta,"R$ 0,00"')
    expect(csv).toContain("=== RECEITA MENSAL ===")
    expect(csv).toContain("=== REPASSES POR PRESTADOR ===")
    // No providers listed
    const linesAfterProviders = csv.split("REPASSES POR PRESTADOR")[1]
    const providerLines = linesAfterProviders!
      .split("\r\n")
      .filter(
        (l) =>
          l &&
          !l.trim().startsWith("Prestador") &&
          !l.trim().startsWith("=") &&
          !l.startsWith("\uFEFF"),
      )
    expect(providerLines).toHaveLength(0)
  })

  it("throws 403 when user is not ADMIN", async () => {
    _mockRole = "PROVIDER"
    mockDb.booking.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/admin/commissions/export?year=2025")
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(403)
  })
})
