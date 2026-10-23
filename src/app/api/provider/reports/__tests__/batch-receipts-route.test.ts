import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "../batch-receipts/route"

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ userId: "prov-1", role: "PROVIDER" }),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: {} },
}))

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "prov-1",
        name: "Carlos Eletricista",
        role: "PROVIDER",
      }),
    },
    booking: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "booking-101",
          amount: 250.0,
          paymentMethod: "PIX",
          paymentStatus: "PAID",
          status: "COMPLETED",
          scheduledAt: new Date("2026-10-10T14:00:00Z"),
          service: { title: "Instalação Elétrica" },
          client: { name: "Maria Oliveira" },
          payment: { method: "PIX", amount: 250.0 },
        },
      ]),
    },
  },
}))

describe("GET /api/provider/reports/batch-receipts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("exports batch receipts in JSON format", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/provider/reports/batch-receipts?month=2026-10&format=json",
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.totalBookings).toBe(1)
    expect(json.totalGross).toBe(250)
    expect(json.totalPlatformFee).toBe(37.5) // FEE_RATE (15%)
    expect(json.totalNet).toBe(212.5)
    expect(json.receipts[0].serialNumber).toContain("REC-20261010-")
  })

  it("exports batch receipts in CSV format", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/provider/reports/batch-receipts?month=2026-10&format=csv",
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/csv")
    expect(res.headers.get("Content-Disposition")).toContain(
      'attachment; filename="recibos-lote-2026-10.csv"',
    )
    const text = await res.text()
    expect(text).toContain("Numero Recibo")
    expect(text).toContain("Instalação Elétrica")
    expect(text).toContain("250.00")
  })

  it("exports batch receipts in printable HTML format", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/provider/reports/batch-receipts?month=2026-10&format=html",
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/html")
    const html = await res.text()
    expect(html).toContain("Extrato Consolidado de Recibos")
    expect(html).toContain("Carlos Eletricista")
    expect(html).toContain("R$ 250.00")
    expect(html).toContain("@media print")
  })
})
