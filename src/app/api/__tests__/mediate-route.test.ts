import { describe, it, expect, vi, beforeEach } from "vitest"
import { POST } from "../bookings/[id]/mediate/route"
import { requireUser } from "@/lib/auth"
import { db } from "@/lib/db"

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { bookings: {} },
}))

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findUnique: vi.fn(),
    },
    message: {
      create: vi.fn(),
    },
    notification: {
      create: vi.fn().mockResolvedValue({ id: "notif-1" }),
    },
  },
}))

describe("API /api/bookings/[id]/mediate", () => {
  const mockBooking = {
    id: "booking-med-1",
    clientId: "client-1",
    providerId: "provider-1",
    service: { title: "Troca de Chuveiro" },
    client: { id: "client-1", name: "Ana Cliente" },
    provider: { id: "provider-1", name: "Pedro Eletricista" },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: "provider-1", role: "PROVIDER" } as never)
  })

  it("retorna 404 quando o agendamento não existe", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(null)

    const req = new Request("http://localhost/api/bookings/invalid-id/mediate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "notify_delay", delayMinutes: 15 }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: "invalid-id" }) })
    expect(res.status).toBe(404)
  })

  it("retorna 403 quando o usuário não é participante", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "stranger-user", role: "CLIENT" } as never)
    vi.mocked(db.booking.findUnique).mockResolvedValue(mockBooking as never)

    const req = new Request("http://localhost/api/bookings/booking-med-1/mediate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "notify_delay", delayMinutes: 15 }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: "booking-med-1" }) })
    expect(res.status).toBe(403)
  })

  it("processa notify_delay com sucesso criando mensagem no chat", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(mockBooking as never)
    vi.mocked(db.message.create).mockResolvedValue({
      id: "msg-delay-1",
      fromId: "provider-1",
      toId: "client-1",
      content: "Aviso de atraso",
    } as never)

    const req = new Request("http://localhost/api/bookings/booking-med-1/mediate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "notify_delay",
        delayMinutes: 30,
        reason: "Trânsito na BR-381",
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: "booking-med-1" }) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromId: "provider-1",
          toId: "client-1",
          content: expect.stringContaining("+30 min"),
        }),
      }),
    )
  })

  it("processa scope_adjustment criando proposta de aditivo com custódia", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(mockBooking as never)
    vi.mocked(db.message.create).mockResolvedValue({
      id: "msg-scope-1",
      fromId: "provider-1",
      toId: "client-1",
      content: "Proposta",
    } as never)

    const req = new Request("http://localhost/api/bookings/booking-med-1/mediate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "scope_adjustment",
        additionalAmount: 45,
        description: "Flange e veda-rosca adicional",
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: "booking-med-1" }) })
    expect(res.status).toBe(200)

    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining("[SEVERINNO_PROPOSAL:"),
        }),
      }),
    )
  })
})
