import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET, generateCalendarToken, verifyCalendarToken } from "../route"
import { NextRequest } from "next/server"
import { db } from "@/lib/db"

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findFirst: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: {} },
}))

describe("Calendar Feed Token Security", () => {
  const providerId = "cuid12345678901234567890"

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AUTH_SECRET = "test-secret-key-calendar"
  })

  it("rejeita tokens com ID puro (previne enumeração IDOR)", () => {
    expect(verifyCalendarToken(providerId)).toBeNull()
    expect(verifyCalendarToken("cuid99999999999999999999")).toBeNull()
  })

  it("rejeita tokens adulterados ou com assinatura HMAC inválida", () => {
    const tamperedToken = `${providerId}_badsignature12345678901`
    expect(verifyCalendarToken(tamperedToken)).toBeNull()
  })

  it("valida com sucesso tokens assinados com HMAC legítimo", () => {
    const validToken = generateCalendarToken(providerId)
    expect(verifyCalendarToken(validToken)).toBe(providerId)
  })

  it("retorna 404 quando o token é inválido ao chamar o handler GET", async () => {
    const req = new NextRequest(`http://localhost:3000/api/calendar/feed/${providerId}`)
    const res = await GET(req, {
      params: Promise.resolve({ token: providerId }),
    })
    expect(res.status).toBe(404)
  })

  it("retorna feed ICS válido quando o token assinado é legítimo", async () => {
    const validToken = generateCalendarToken(providerId)
    vi.mocked(db.user.findFirst).mockResolvedValue({
      id: providerId,
      name: "João Eletricista",
    } as never)
    vi.mocked(db.booking.findMany).mockResolvedValue([
      {
        id: "b-1",
        scheduledAt: new Date(),
        lat: -18.85,
        lng: -41.95,
        address: "Rua das Flores, 100",
        status: "CONFIRMED",
        service: { title: "Troca de Fiação" },
        client: { name: "Maria", phone: "33999998888" },
      },
    ] as never)

    const req = new NextRequest(`http://localhost:3000/api/calendar/feed/${validToken}`)
    const res = await GET(req, {
      params: Promise.resolve({ token: validToken }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/calendar")
    const text = await res.text()
    expect(text).toContain("BEGIN:VCALENDAR")
    expect(text).toContain("Troca de Fiação")
  })
})
