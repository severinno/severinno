import { describe, it, expect, vi, beforeEach } from "vitest"
import { makeAuthError } from "@/lib/__tests__/helpers/auth-mock"

let _mockRole: string | null = "ADMIN"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (roles: string | string[]) => {
    const list = Array.isArray(roles) ? roles : [roles]
    if (!_mockRole || !list.includes(_mockRole)) throw makeAuthError("FORBIDDEN")
    return { userId: "admin-1", role: _mockRole }
  }),
}))

const mockDb = vi.hoisted(() => ({
  booking: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    aggregate: vi.fn(),
  },
  payment: {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  user: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn((promises: any) => Promise.all(promises)),
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

import { GET, POST } from "../admin/operations/live/route"

describe("GET & POST /api/admin/operations/live (Torre de Controle Operacional GV)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockRole = "ADMIN"
  })

  it("bloqueia acesso para usuários não-administradores", async () => {
    _mockRole = "CLIENT"
    const req = new Request("http://localhost/api/admin/operations/live")
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it("retorna dados operacionais agregados para Governador Valadares", async () => {
    mockDb.booking.findMany.mockResolvedValue([
      {
        id: "book-gv-101",
        clientId: "client-1",
        providerId: "prov-1",
        serviceId: "srv-1",
        status: "IN_PROGRESS",
        paymentStatus: "HELD",
        amount: 180.0,
        lat: -18.8548,
        lng: -41.9482,
        address: "Rua Peçanha, 450 - Centro, Governador Valadares",
        cep: "35010-160",
        scheduledAt: new Date("2026-10-14T15:00:00Z"),
        escrowReleasedAt: null,
        client: { id: "client-1", name: "Carlos Cliente", whatsapp: "5533999991111" },
        provider: { id: "prov-1", name: "Marcos Prestador", whatsapp: "5533999992222" },
        service: { id: "srv-1", title: "Conserto Elétrico" },
      },
    ])

    mockDb.booking.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: 180.0 },
        _count: { id: 1 },
      })
      .mockResolvedValueOnce({
        _sum: { amount: 350.0 },
        _count: { id: 2 },
      })

    mockDb.user.findMany.mockResolvedValue([
      {
        id: "prov-1",
        name: "Marcos Prestador",
        whatsapp: "5533999992222",
        city: "Governador Valadares",
        state: "MG",
        lat: -18.852,
        lng: -41.944,
        active: true,
        verified: true,
      },
    ])

    const req = new Request("http://localhost/api/admin/operations/live")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.city).toBe("Governador Valadares")
    expect(data.state).toBe("MG")
    expect(data.kpis.activeBookings).toBe(1)
    expect(data.kpis.onlineProviders).toBe(1)
    expect(data.kpis.escrowHeldAmount).toBe(180.0)
    expect(data.bookings.length).toBe(1)
    expect(data.bookings[0].neighborhood).toBe("Centro")
    expect(data.providers.length).toBe(1)
  })

  it("permite liberação manual de custódia (Escrow) pelo admin via POST", async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      id: "book-gv-101",
      paymentStatus: "HELD",
    })

    const req = new Request("http://localhost/api/admin/operations/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId: "book-gv-101",
        action: "release_escrow",
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockDb.$transaction).toHaveBeenCalled()
    expect(mockDb.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "book-gv-101", paymentStatus: "HELD" }),
        data: expect.objectContaining({ paymentStatus: "PAID", status: "COMPLETED" }),
      }),
    )
  })

  it("retorna 409 caso a custódia já tenha sido liberada concorrentemente (count 0)", async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      id: "book-gv-101",
      paymentStatus: "HELD",
    })
    mockDb.booking.updateMany.mockResolvedValue({ count: 0 })

    const req = new Request("http://localhost/api/admin/operations/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId: "book-gv-101",
        action: "release_escrow",
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.error).toContain("já foi liberada por outra operação concorrente")
  })

  it("rejeita requisições POST com parâmetros inválidos", async () => {
    const req = new Request("http://localhost/api/admin/operations/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId: "book-gv-101",
        action: "unknown_action",
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
