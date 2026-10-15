import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../metrics/unit-economics/route"
import { db } from "@/lib/db"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (role: string) => {
    if (role !== "ADMIN") {
      const err = new Error("Forbidden")
      ;(err as unknown as { status: number }).status = 403
      throw err
    }
  }),
  requireAuth: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
  getSession: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
}))

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      aggregate: vi.fn(),
      count: vi.fn(),
    },
    user: {
      count: vi.fn(),
    },
    service: {
      count: vi.fn(),
    },
  },
}))

describe("GET /api/admin/metrics/unit-economics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("retorna unit economics completos com status 200 para admin", async () => {
    const mockDb = db as unknown as {
      booking: {
        aggregate: ReturnType<typeof vi.fn>
        count: ReturnType<typeof vi.fn>
      }
      user: {
        count: ReturnType<typeof vi.fn>
      }
      service: {
        count: ReturnType<typeof vi.fn>
      }
    }

    mockDb.booking.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 25000 }, _count: { id: 120 } }) // total
      .mockResolvedValueOnce({ _sum: { amount: 1200 }, _count: { id: 6 } }) // today
      .mockResolvedValueOnce({ _sum: { amount: 18000 }, _count: { id: 95 } }) // 30d

    mockDb.booking.count
      .mockResolvedValueOnce(150) // total count
      .mockResolvedValueOnce(120) // paid count

    mockDb.user.count
      .mockResolvedValueOnce(35) // providers
      .mockResolvedValueOnce(210) // clients

    mockDb.service.count.mockResolvedValueOnce(85) // services

    const req = new Request("http://localhost:3000/api/admin/metrics/unit-economics")
    const res = await GET(req)

    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.gmv.total).toBe(25000)
    expect(json.takeRate.percentage).toBe(12)
    expect(json.takeRate.totalRevenue).toBe(3000)
    expect(json.unitEconomics.ticketMedio).toBeGreaterThan(0)
    expect(json.pilotoGV.cidade).toBe("Governador Valadares")
    expect(Array.isArray(json.expansionCities)).toBe(true)
    expect(json.expansionCities.length).toBeGreaterThanOrEqual(5)
  })

  it("recusa acesso sem permissão de administrador", async () => {
    const { requireRole } = await import("@/lib/auth")
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"))

    const req = new Request("http://localhost:3000/api/admin/metrics/unit-economics")
    const res = await GET(req)

    expect(res.status).toBe(500)
  })
})
