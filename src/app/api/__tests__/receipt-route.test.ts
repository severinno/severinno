import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "@/app/api/bookings/[id]/receipt/route"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}))

const BOOKING_ID = "book-rec-1"
const CLIENT_ID = "client-rec-1"
const PROVIDER_ID = "prov-rec-1"

const mockBooking = {
  id: BOOKING_ID,
  amount: 250,
  status: "COMPLETED",
  paymentStatus: "PAID",
  paymentMethod: "PIX",
  address: "Av. Paulista, 1000, SP",
  scheduledAt: new Date("2026-10-15T14:00:00Z"),
  createdAt: new Date("2026-10-10T10:00:00Z"),
  updatedAt: new Date("2026-10-15T16:00:00Z"),
  clientId: CLIENT_ID,
  providerId: PROVIDER_ID,
  service: { title: "Instalação Elétrica Completa", description: "Troca de quadro" },
  client: { name: "Maria Oliveira", email: "maria@example.com", phone: "11999999999" },
  provider: {
    name: "Carlos Eletricista ME",
    email: "carlos@example.com",
    phone: "11988888888",
    cpfCnpj: "12345678000199",
  },
}

describe("GET /api/bookings/[id]/receipt", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: CLIENT_ID, role: "CLIENT" } as never)
  })

  it("retorna recibo em formato JSON estruturado com código de autenticação SHA-256", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(mockBooking as never)

    const req = new Request(`http://localhost:3000/api/bookings/${BOOKING_ID}/receipt`)
    const res = await GET(req, { params: Promise.resolve({ id: BOOKING_ID }) })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.receipt.serialNumber).toContain("REC-")
    expect(data.receipt.authCode).toHaveLength(16)
    expect(data.receipt.financials.totalAmount).toBe(250)
    expect(data.receipt.client.name).toBe("Maria Oliveira")
    expect(data.receipt.provider.name).toBe("Carlos Eletricista ME")
  })

  it("retorna recibo em formato HTML para impressão direta quando solicitado ?format=html", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(mockBooking as never)

    const req = new Request(`http://localhost:3000/api/bookings/${BOOKING_ID}/receipt?format=html`)
    const res = await GET(req, { params: Promise.resolve({ id: BOOKING_ID }) })

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/html")
    const html = await res.text()
    expect(html).toContain("SEVERINNO")
    expect(html).toContain("Comprovante de Intermediação")
    expect(html).toContain("Carlos Eletricista ME")
    expect(html).toContain("window.print()")
  })

  it("retorna 403 se o usuário não fizer parte do agendamento", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "outro-usuario", role: "CLIENT" } as never)
    vi.mocked(db.booking.findUnique).mockResolvedValue(mockBooking as never)

    const req = new Request(`http://localhost:3000/api/bookings/${BOOKING_ID}/receipt`)
    const res = await GET(req, { params: Promise.resolve({ id: BOOKING_ID }) })

    expect(res.status).toBe(403)
  })
})
