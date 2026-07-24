import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  booking: {
    findMany: vi.fn(),
  },
  walletTransaction: {
    findMany: vi.fn(),
  },
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "provider-1" }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from "../provider/wallet/history/export/route"

// ── Mock data ──────────────────────────────────────────────────────────────

const mockBookings = [
  {
    id: "booking-1",
    amount: 200,
    status: "COMPLETED",
    paymentStatus: "PAID",
    createdAt: new Date("2025-01-15"),
    service: { title: "Limpeza completa" },
    client: { name: "Maria Silva" },
  },
  {
    id: "booking-2",
    amount: 350,
    status: "COMPLETED",
    paymentStatus: "PAID",
    createdAt: new Date("2025-01-20"),
    service: { title: "Pintura parede" },
    client: { name: "João Santos" },
  },
  {
    id: "booking-3",
    amount: 150,
    status: "CONFIRMED",
    paymentStatus: "PAID",
    createdAt: new Date("2025-02-01"),
    service: { title: "Reparo elétrico" },
    client: { name: "Ana Costa" },
  },
]

const mockWithdrawals = [
  {
    id: "wth-1",
    amount: 100,
    description: "Saque de R$ 100,00",
    createdAt: new Date("2025-03-01"),
    status: "completed",
  },
]

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/provider/wallet/history/export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns CSV with correct Content-Type and Content-Disposition", async () => {
    mockDb.booking.findMany.mockResolvedValue([])
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/provider/wallet/history/export")
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8")
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="extrato-carteira.csv"')
  })

  it("includes summary and all transactions in CSV", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/provider/wallet/history/export")
    const res = await GET(req)
    const csv = await res.text()

    expect(csv).toContain("=== RESUMO ===")
    expect(csv).toContain("Total de transações,3")
    expect(csv).toContain("=== TRANSAÇÕES ===")
    expect(csv).toContain("Limpeza completa")
    expect(csv).toContain("Pintura parede")
    expect(csv).toContain("Reparo elétrico")
  })

  it("includes header row with correct columns", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/provider/wallet/history/export")
    const res = await GET(req)
    const csv = await res.text()

    expect(csv).toContain("Data,Descrição,Cliente,Valor Bruto,Taxa (15%),Valor Líquido,Status")
  })

  it("includes withdrawal transactions with status Sacado", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue(mockWithdrawals)

    const req = new Request("http://localhost/api/provider/wallet/history/export")
    const res = await GET(req)
    const csv = await res.text()

    expect(csv).toContain("Sacado")
    expect(csv).toContain("Saque de R$ 100,00")
  })

  it("filters by type=paid when type param is provided", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const req = new Request(
      "http://localhost/api/provider/wallet/history/export?type=paid",
    )
    const res = await GET(req)
    const csv = await res.text()

    expect(csv).toContain("Total de transações,2")
    expect(csv).toContain("Limpeza completa")
    expect(csv).toContain("Pintura parede")
    expect(csv).not.toContain("Reparo elétrico")
  })

  it("returns CSV with totals even when empty", async () => {
    mockDb.booking.findMany.mockResolvedValue([])
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/provider/wallet/history/export")
    const res = await GET(req)
    const csv = await res.text()

    expect(csv).toContain("Total de transações,0")
    expect(csv).toContain("Total recebido")
    expect(csv).toContain("=== TRANSAÇÕES ===")
  })

  it("throws 401 when not authenticated", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const req = new Request("http://localhost/api/provider/wallet/history/export")
    const res = await GET(req)

    expect(res.status).toBe(401)
  })
})
