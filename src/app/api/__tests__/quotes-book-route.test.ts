import { describe, it, expect, vi, beforeEach } from "vitest"
import { POST } from "../quotes/[id]/book/route"

const mockUserFindUnique = vi.fn()
const mockQuoteFindUnique = vi.fn()
const mockBookingFindUnique = vi.fn()
const mockTransaction = vi.fn()

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    quoteRequest: {
      findUnique: (...args: unknown[]) => mockQuoteFindUnique(...args),
    },
    booking: {
      findUnique: (...args: unknown[]) => mockBookingFindUnique(...args),
      create: vi.fn(),
    },
    quoteItem: {
      updateMany: vi.fn(),
    },
    $transaction: (ops: unknown[]) => mockTransaction(ops),
  },
}))

let mockSession = { userId: "client-1", role: "CLIENT" }

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockSession),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn(),
  RATE_LIMITS: { general: {} },
}))

vi.mock("@/lib/notification-queue", () => ({
  saveAndQueueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/realtime-client", () => ({
  emitRealtime: vi.fn().mockResolvedValue(undefined),
}))

function createRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/quotes/qt-123/book", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/quotes/[id]/book", () => {
  const futureDate = new Date(Date.now() + 86400000).toISOString()

  beforeEach(() => {
    vi.clearAllMocks()
    mockSession = { userId: "client-1", role: "CLIENT" }
    mockUserFindUnique.mockResolvedValue({ id: "client-1", name: "Cliente Teste" })
    mockQuoteFindUnique.mockResolvedValue({
      id: "qt-123",
      clientId: "client-1",
      providerId: "prov-1",
      status: "APPROVED",
      address: "Rua das Flores, 100",
      cep: "35010-000",
      lat: -18.85,
      lng: -41.95,
      items: [{ id: "item-1", serviceId: "svc-1", price: 150, status: "ACCEPTED" }],
      provider: { id: "prov-1", name: "Prestador Teste", email: "p@teste.com" },
    })
    mockBookingFindUnique.mockResolvedValue(null)
    mockTransaction.mockResolvedValue([
      { id: "book-123", amount: 150, status: "PENDING" },
      { id: "qt-123", status: "ACCEPTED" },
    ])
  })

  it("denies access if user is not a CLIENT", async () => {
    mockSession = { userId: "prov-1", role: "PROVIDER" }
    const req = createRequest({ scheduledAt: futureDate })
    const res = await POST(req, { params: Promise.resolve({ id: "qt-123" }) })
    expect(res.status).toBe(403)
  })

  it("fails with 400 when scheduledAt is missing or invalid in zod schema", async () => {
    const req = createRequest({ address: "Nova Rua" })
    const res = await POST(req, { params: Promise.resolve({ id: "qt-123" }) })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe("Dados inválidos")
  })

  it("fails with 400 when scheduledAt is a past date", async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString()
    const req = createRequest({ scheduledAt: pastDate })
    const res = await POST(req, { params: Promise.resolve({ id: "qt-123" }) })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain("A data deve ser futura")
  })

  it("returns 404 when quote does not exist", async () => {
    mockQuoteFindUnique.mockResolvedValue(null)
    const req = createRequest({ scheduledAt: futureDate })
    const res = await POST(req, { params: Promise.resolve({ id: "qt-999" }) })
    expect(res.status).toBe(404)
  })

  it("returns 403 when quote belongs to another client", async () => {
    mockQuoteFindUnique.mockResolvedValue({
      id: "qt-123",
      clientId: "client-other",
      status: "APPROVED",
      items: [],
    })
    const req = createRequest({ scheduledAt: futureDate })
    const res = await POST(req, { params: Promise.resolve({ id: "qt-123" }) })
    expect(res.status).toBe(403)
  })

  it("returns 400 when quote is not in APPROVED status", async () => {
    mockQuoteFindUnique.mockResolvedValue({
      id: "qt-123",
      clientId: "client-1",
      status: "PENDING",
      items: [],
    })
    const req = createRequest({ scheduledAt: futureDate })
    const res = await POST(req, { params: Promise.resolve({ id: "qt-123" }) })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe("Orçamento precisa estar aprovado")
  })

  it("returns 409 conflict when booking already exists for quote", async () => {
    mockBookingFindUnique.mockResolvedValue({ id: "book-existing" })
    const req = createRequest({ scheduledAt: futureDate })
    const res = await POST(req, { params: Promise.resolve({ id: "qt-123" }) })
    expect(res.status).toBe(409)
  })

  it("successfully creates booking and accepts quote on valid data", async () => {
    const req = createRequest({ scheduledAt: futureDate, address: "Rua Nova, 50" })
    const res = await POST(req, { params: Promise.resolve({ id: "qt-123" }) })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.booking).toBeDefined()
    expect(mockTransaction).toHaveBeenCalled()
  })
})
