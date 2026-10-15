import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { GET, POST } from "../route"

let mockSession = { userId: "prov-1", role: "PROVIDER" }

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockImplementation(() => Promise.resolve(mockSession)),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { bookings: {} },
}))

const mockBooking = {
  id: "bk-123",
  clientId: "client-1",
  providerId: "prov-1",
  status: "IN_PROGRESS",
  paymentStatus: "PENDING",
  beforePhotos: ["https://s3.severinno.com/before1.jpg"],
  afterPhotos: [],
  completionNote: null,
  completionPin: "1234",
  escrowReleasedAt: null,
  createdAt: new Date("2026-10-15T00:00:00Z"),
  updatedAt: new Date("2026-10-15T00:00:00Z"),
  service: { id: "srv-1", title: "Conserto de Vazamento", category: { name: "Hidráulica" } },
  provider: { id: "prov-1", name: "José Encanador", phone: "33999999999" },
  client: { id: "client-1", name: "Ana Silva", phone: "33988888888" },
}

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findUnique: vi.fn().mockImplementation(() => Promise.resolve(mockBooking)),
      update: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: "bk-123",
          beforePhotos: data.beforePhotos || mockBooking.beforePhotos,
          afterPhotos: data.afterPhotos || [],
          completionNote: data.completionNote || null,
        }),
      ),
    },
  },
}))

describe("GET & POST /api/bookings/[id]/photos — Laudo & Vistoria Fotográfica", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession = { userId: "prov-1", role: "PROVIDER" }
  })

  it("GET retorna fotos e metadados da vistoria para o participante", async () => {
    const req = new NextRequest("http://localhost:3000/api/bookings/bk-123/photos")
    const res = await GET(req, { params: Promise.resolve({ id: "bk-123" }) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.booking.id).toBe("bk-123")
    expect(data.booking.beforePhotos).toHaveLength(1)
    expect(data.booking.service.title).toBe("Conserto de Vazamento")
  })

  it("GET recusa acesso a usuários não-participantes (403)", async () => {
    mockSession = { userId: "stranger-999", role: "CLIENT" }
    const req = new NextRequest("http://localhost:3000/api/bookings/bk-123/photos")
    const res = await GET(req, { params: Promise.resolve({ id: "bk-123" }) })
    expect(res.status).toBe(403)
  })

  it("POST salva fotos da vistoria inicial (Antes)", async () => {
    const req = new NextRequest("http://localhost:3000/api/bookings/bk-123/photos", {
      method: "POST",
      body: JSON.stringify({
        type: "before",
        photos: ["https://s3.severinno.com/before1.jpg", "https://s3.severinno.com/before2.jpg"],
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: "bk-123" }) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.booking.beforePhotos).toHaveLength(2)
  })

  it("POST salva laudo final (Depois) com checklist formatado", async () => {
    const req = new NextRequest("http://localhost:3000/api/bookings/bk-123/photos", {
      method: "POST",
      body: JSON.stringify({
        type: "after",
        photos: ["https://s3.severinno.com/after1.jpg"],
        completionNote: "Troca de sifão e vedação concluída com garantia.",
        checklist: [
          { id: "c1", label: "Registro desligado com segurança", checked: true },
          { id: "c2", label: "Teste de estanqueidade sem vazamento", checked: true },
        ],
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: "bk-123" }) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.booking.afterPhotos).toHaveLength(1)
    expect(data.booking.completionNote).toContain("Troca de sifão")
    expect(data.booking.completionNote).toContain("[x] Registro desligado com segurança")
  })
})
