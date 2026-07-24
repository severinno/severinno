import { describe, it, expect, vi } from "vitest"
import { parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/api-server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, handleError: vi.fn((e: unknown) => (actual.handleError as (e: unknown) => Response)(e)) }
})

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock("@/lib/routing", () => ({
  getRoute: vi.fn().mockResolvedValue({
    distanceKm: 5.5,
    durationMin: 11,
    polyline: "[[...]]",
  }),
}))

import { GET } from "../tracking/[id]/route"
import { db } from "@/lib/db"

const mockBooking = {
  id: "book-1",
  status: "CONFIRMED",
  paymentStatus: "PAID",
  scheduledAt: new Date("2026-07-25T14:00:00Z").toISOString(),
  address: "Rua Exemplo, 123",
  createdAt: new Date("2026-07-20T10:00:00Z").toISOString(),
  amount: 15000,
  lat: -18.8505,
  lng: -41.9481,
  provider: { id: "prov-1", name: "João Prestador", avatarUrl: null },
  client: { id: "client-1", name: "Maria Cliente" },
  service: { id: "svc-1", title: "Instalação Elétrica", basePrice: 15000 },
}

describe("GET /api/tracking/[id]", () => {
  it("returns booking data for valid id", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(mockBooking)

    const req = new Request("http://localhost")
    const res = await GET(req, { params: Promise.resolve({ id: "book-1" }) })
    const parsed = await parseResponse(res)

    expect(res.status).toBe(200)
    expect(parsed.body).toEqual({
      booking: {
        id: "book-1",
        status: "CONFIRMED",
        paymentStatus: "PAID",
        scheduledAt: mockBooking.scheduledAt,
        address: "Rua Exemplo, 123",
        createdAt: mockBooking.createdAt,
        amount: 15000,
        lat: -18.8505,
        lng: -41.9481,
        provider: { id: "prov-1", name: "João Prestador", avatarUrl: null },
        client: { id: "client-1", name: "Maria Cliente" },
        service: { id: "svc-1", title: "Instalação Elétrica", basePrice: 15000 },
      },
      route: null,
    })
  })

  it("returns 404 for non-existent booking", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(null)

    const req = new Request("http://localhost")
    const res = await GET(req, { params: Promise.resolve({ id: "invalid-id" }) })
    const parsed = await parseResponse(res)

    expect(res.status).toBe(404)
    expect(parsed.body).toEqual({ error: "Agendamento não encontrado" })
  })

  it("returns cancelled booking data (tracking shows all statuses)", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue({
      ...mockBooking,
      status: "CANCELLED",
      paymentStatus: "REFUNDED",
    })

    const req = new Request("http://localhost")
    const res = await GET(req, { params: Promise.resolve({ id: "book-1" }) })
    expect(res.status).toBe(200)
  })
})
