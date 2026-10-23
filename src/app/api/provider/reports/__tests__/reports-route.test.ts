import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "../route"

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ userId: "prov-reports-1", role: "PROVIDER" }),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: {} },
}))

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "prov-reports-1",
        name: "João Prestador",
        role: "PROVIDER",
      }),
    },
    booking: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "bk-rep-1",
          amount: 200.0,
          paymentMethod: "PIX",
          paymentStatus: "PAID",
          status: "COMPLETED",
          updatedAt: new Date("2026-10-15T10:00:00Z"),
          scheduledAt: new Date("2026-10-15T10:00:00Z"),
          service: { title: "Pintura Parede" },
          client: { name: "Maria Cliente" },
        },
        {
          id: "bk-rep-2",
          amount: 150.0,
          paymentMethod: "CREDIT_CARD",
          paymentStatus: "PAID",
          status: "COMPLETED",
          updatedAt: new Date("2026-10-16T11:00:00Z"),
          scheduledAt: new Date("2026-10-16T11:00:00Z"),
          service: { title: "Reparo Torneira" },
          client: { name: "Pedro Cliente" },
        },
      ]),
    },
  },
}))

describe("GET /api/provider/reports (Financial Settlement with MoneySettlement)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calculates exact financial totals in JSON format without float drift", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/provider/reports?type=financial&period=30d&format=json",
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    const json = await res.json()

    // 200 + 150 = 350.00
    expect(json.totalGross).toBe(350)
    // 350 * 0.15 = 52.50
    expect(json.platformFee).toBe(52.5)
    // 350 - 52.50 = 297.50
    expect(json.netReceived).toBe(297.5)
    expect(json.totalBookings).toBe(2)
  })

  it("exports financial settlement report in CSV format with line-by-line accounting", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/provider/reports?type=financial&period=30d&format=csv",
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/csv")
    const csv = await res.text()

    // Contains headers
    expect(csv).toContain(
      "ID Agendamento;Data Pagamento;Forma;Valor Bruto (R$);Taxa Plataforma (R$);Valor Líquido (R$)",
    )
    // Contains row 1 (200.00 gross -> 30.00 fee -> 170.00 net)
    expect(csv).toContain("bk-rep-1;2026-10-15;PIX;200.00;30.00;170.00")
    // Contains row 2 (150.00 gross -> 22.50 fee -> 127.50 net)
    expect(csv).toContain("bk-rep-2;2026-10-16;CREDIT_CARD;150.00;22.50;127.50")
  })
})
