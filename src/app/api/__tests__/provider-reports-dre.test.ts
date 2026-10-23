import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const { mockGetSession, mockDb } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDb: {
    user: {
      findUnique: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
    },
    walletTransaction: {
      findMany: vi.fn(),
    },
    quoteItem: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}))

vi.mock("@/lib/db", () => ({
  db: mockDb,
}))

vi.mock("@/lib/logger", () => ({
  default: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}))

import { GET } from "../provider/reports/route"

describe("GET /api/provider/reports — DRE & Financial Reports", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null)
    const req = new NextRequest("http://localhost:3000/api/provider/reports?type=dre")
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it("returns 403 when user is CLIENT (not provider or admin)", async () => {
    mockGetSession.mockResolvedValue({ userId: "user-client-1" })
    mockDb.user.findUnique.mockResolvedValue({ role: "CLIENT", name: "Cliente Teste" })

    const req = new NextRequest("http://localhost:3000/api/provider/reports?type=dre")
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it("generates DRE report in JSON format with MEI and Escrow metrics", async () => {
    mockGetSession.mockResolvedValue({ userId: "prov-123" })
    mockDb.user.findUnique.mockResolvedValue({ role: "PROVIDER", name: "Carlos Eletricista" })

    // Mock bookings
    mockDb.booking.findMany
      .mockResolvedValueOnce([
        {
          id: "bk-1",
          amount: 500,
          status: "COMPLETED",
          paymentStatus: "PAID",
          scheduledAt: new Date("2026-10-10"),
          escrowReleasedAt: new Date("2026-10-10"),
          service: { title: "Instalação de Tomadas" },
          client: { name: "Maria" },
        },
        {
          id: "bk-2",
          amount: 300,
          status: "CONFIRMED",
          paymentStatus: "PAID",
          scheduledAt: new Date("2026-10-15"),
          escrowReleasedAt: null,
          service: { title: "Troca de Disjuntor" },
          client: { name: "João" },
        },
      ]) // period bookings
      .mockResolvedValueOnce([{ amount: 500 }, { amount: 300 }, { amount: 1200 }]) // ytd bookings

    // Mock wallet transactions (withdrawals)
    mockDb.walletTransaction.findMany.mockResolvedValue([
      { id: "tx-1", amount: 400, status: "completed", createdAt: new Date() },
      { id: "tx-2", amount: 100, status: "pending", createdAt: new Date() },
    ])

    const req = new NextRequest(
      "http://localhost:3000/api/provider/reports?type=dre&month=2026-10&format=json",
    )
    const res = await GET(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.dre).toBeDefined()
    expect(data.dre.providerName).toBe("Carlos Eletricista")
    expect(data.dre.totalBookings).toBe(2)
    expect(data.dre.grossRevenue).toBe(800)
    // 15% fee on 800 = 120
    expect(data.dre.platformFees).toBe(120)
    expect(data.dre.netRevenue).toBe(680)
    // 500 completed with escrowReleasedAt, 300 still in custody
    expect(data.dre.escrowReleased).toBe(500)
    expect(data.dre.escrowInCustody).toBe(300)
    expect(data.dre.withdrawalsCompleted).toBe(400)
    expect(data.dre.withdrawalsPending).toBe(100)
    // YTD gross = 500 + 300 + 1200 = 2000
    expect(data.dre.ytdGross).toBe(2000)
    expect(data.dre.isWithinMeiLimit).toBe(true)
  })

  it("generates DRE report in CSV format with UTF-8 BOM", async () => {
    mockGetSession.mockResolvedValue({ userId: "prov-123" })
    mockDb.user.findUnique.mockResolvedValue({ role: "PROVIDER", name: "Carlos Eletricista" })

    mockDb.booking.findMany
      .mockResolvedValueOnce([
        {
          id: "bk-1",
          amount: 200,
          status: "COMPLETED",
          paymentStatus: "PAID",
          scheduledAt: new Date("2026-10-10"),
          escrowReleasedAt: new Date("2026-10-10"),
          service: { title: "Reparo Chuveiro" },
          client: { name: "Ana" },
        },
      ])
      .mockResolvedValueOnce([{ amount: 200 }])

    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const req = new NextRequest(
      "http://localhost:3000/api/provider/reports?type=dre&month=2026-10&format=csv",
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/csv")
    expect(res.headers.get("Content-Disposition")).toContain(
      'attachment; filename="dre-mensal-2026-10.csv"',
    )

    const text = await res.text()
    expect(text).toContain("DEMONSTRATIVO DRE & EXTRATO CONTÁBIL")
    expect(text).toContain("FATURAMENTO BRUTO DE SERVIÇOS;200.00")
    expect(text).toContain("Reparo Chuveiro")
  })

  it("generates DRE report in HTML format with CSP header and sanitized values", async () => {
    mockGetSession.mockResolvedValue({ userId: "prov-123" })
    mockDb.user.findUnique.mockResolvedValue({
      role: "PROVIDER",
      name: "João & <script>alert(1)</script> Silva",
    })

    mockDb.booking.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const req = new NextRequest(
      "http://localhost:3000/api/provider/reports?type=dre&month=2026-10&format=html",
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/html")
    expect(res.headers.get("Content-Security-Policy")).toBeDefined()

    const html = await res.text()
    expect(html).toContain("Demonstrativo de Resultado do Exercício (DRE)")
    // Verify XSS prevention
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).toContain("Imprimir / Salvar como PDF")
  })
})
