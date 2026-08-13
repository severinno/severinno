/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for POST /api/bookings/[id]/pay — payment processing.
 *
 * Covers gaps left by the main bookings-route.test.ts:
 *   - Card payment flow (createCardCharge)
 *   - PIX reuse with existing QR code (idempotency)
 *   - LytexError → badRequest mapping
 *   - Incomplete card data validation
 *   - Card waitingPayment → polling flow
 *   - Rate limiting (assertRateLimit)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  booking: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  payment: {
    upsert: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "client-1", role: "CLIENT" }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))

vi.mock("@/lib/lytex", () => ({
  createPixCharge: vi.fn(),
  createCardCharge: vi.fn(),
  pollChargeStatus: vi.fn().mockResolvedValue({ status: "paid", paidAt: new Date().toISOString() }),
  lytexLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
  LytexError: class LytexError extends Error {
    status: number
    constructor(m: string, s = 400) {
      super(m)
      this.name = "LytexError"
      this.status = s
    }
  },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { bookings: { prefix: "bookings", max: 30, windowMs: 60_000 } },
}))

vi.mock("@/lib/realtime-client", () => ({
  emitRealtime: vi.fn().mockResolvedValue(undefined),
  sendBookingUpdate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/notification-queue", () => ({
  saveAndQueueNotification: vi.fn().mockResolvedValue(undefined),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { HttpError } from "@/lib/api-server"
import { POST } from "../bookings/[id]/pay/route"
import { createPixCharge, createCardCharge, pollChargeStatus, LytexError } from "@/lib/lytex"
import { assertRateLimit } from "@/lib/rate-limit"
import { db } from "@/lib/db"

// ── Helpers ────────────────────────────────────────────────────────────────

const PAID_BOOKING = {
  id: "book-1",
  clientId: "client-1",
  status: "CONFIRMED",
  paymentStatus: "PAID",
  amount: 200,
  paymentMethod: "PIX",
  providerId: "prov-1",
  client: {
    id: "client-1",
    name: "Test",
    email: "test@test.com",
    cpfCnpj: "12345678900",
    whatsapp: "11999999999",
  },
  payment: null,
}

const PENDING_PIX_BOOKING = {
  id: "book-1",
  clientId: "client-1",
  status: "CONFIRMED",
  paymentStatus: "PENDING",
  amount: 200,
  paymentMethod: "PIX",
  providerId: "prov-1",
  client: {
    id: "client-1",
    name: "Test",
    email: "test@test.com",
    cpfCnpj: "12345678900",
    whatsapp: "11999999999",
  },
  payment: null,
}

const PENDING_CARD_BOOKING = {
  id: "book-1",
  clientId: "client-1",
  status: "CONFIRMED",
  paymentStatus: "PENDING",
  amount: 200,
  paymentMethod: "CARD",
  providerId: "prov-1",
  client: {
    id: "client-1",
    name: "Test",
    email: "test@test.com",
    cpfCnpj: "12345678900",
    whatsapp: "11999999999",
  },
  payment: null,
}

const VALID_CARD = {
  number: "4111111111111111",
  holderName: "Test User",
  expiryMonth: "12",
  expiryYear: "2028",
  cvv: "123",
  installments: 1,
}

function mockRequest(body?: unknown): Request {
  return createMockRequest({
    method: "POST",
    body: body ?? {},
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/bookings/[id]/pay — PIX flow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reusa QR code existente quando booking já tem cobrança PIX ativa", async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      ...PENDING_PIX_BOOKING,
      payment: { id: "pay-1", status: "PENDING", lytexId: "lytex-1" },
    })
    mockDb.payment.findUnique.mockResolvedValue({
      lytexId: "lytex-1",
      qrCode: "pix-copia-e-cola-existing",
      qrCodeImage: "data:image/png;base64,qr-existing",
      status: "PENDING",
      lytexStatus: "waitingPayment",
    })

    const res = await POST(mockRequest(), { params: Promise.resolve({ id: "book-1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.qrCode).toBe("pix-copia-e-cola-existing")
    expect(data.paymentMethod).toBe("PIX")
    // Should NOT call createPixCharge — existing QR reused
    expect(createPixCharge).not.toHaveBeenCalled()
  })

  it("cria novo PIX quando booking não tem payment ainda", async () => {
    mockDb.booking.findUnique.mockResolvedValue(PENDING_PIX_BOOKING)
    vi.mocked(createPixCharge).mockResolvedValue({
      id: "charge-new",
      status: "waitingPayment",
      transactionId: "tx-new",
      qrCode: "pix-copia-e-cola-new",
      qrCodeImage: "data:image/png;base64,qr-new",
      pixKey: "test-key",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      amount: 200,
      lytexStatus: "waitingPayment",
      createdAt: new Date().toISOString(),
    })
    mockDb.payment.upsert.mockResolvedValue({} as any)

    const res = await POST(mockRequest(), { params: Promise.resolve({ id: "book-1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.qrCode).toBe("pix-copia-e-cola-new")
    expect(createPixCharge).toHaveBeenCalledTimes(1)
  })

  it("retorna badRequest com mensagem Lytex quando LytexError é lançado no PIX", async () => {
    mockDb.booking.findUnique.mockResolvedValue(PENDING_PIX_BOOKING)
    vi.mocked(createPixCharge).mockRejectedValue(new LytexError("Saldo insuficiente na conta", 422))

    const res = await POST(mockRequest(), { params: Promise.resolve({ id: "book-1" }) })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("Lytex: Saldo insuficiente na conta")
  })
})

describe("POST /api/bookings/[id]/pay — Card flow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("processa cartão com sucesso quando aprovado imediatamente (status=paid)", async () => {
    mockDb.booking.findUnique.mockResolvedValue(PENDING_CARD_BOOKING)
    vi.mocked(createCardCharge).mockResolvedValue({
      id: "card-charge-1",
      status: "paid",
      transactionId: "tx-card-1",
      cardLastDigits: "1111",
      cardBrand: "visa",
      installments: 1,
      amount: 200,
      installmentAmount: 200,
      lytexStatus: "paid",
      createdAt: new Date().toISOString(),
    })
    mockDb.$transaction.mockResolvedValue([{}, {}])

    const req = createMockRequest({
      method: "POST",
      body: { card: VALID_CARD },
    })
    const res = await POST(req, { params: Promise.resolve({ id: "book-1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.status).toBe("PAID")
    expect(data.cardLastDigits).toBe("1111")
    expect(data.cardBrand).toBe("visa")
    expect(createCardCharge).toHaveBeenCalledTimes(1)
    // Should commit $transaction with payment.upsert + booking.update
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1)
  })

  it("retorna waitingPayment quando cartão entra em processamento assíncrono", async () => {
    mockDb.booking.findUnique.mockResolvedValue(PENDING_CARD_BOOKING)
    vi.mocked(createCardCharge).mockResolvedValue({
      id: "card-charge-2",
      status: "waitingPayment",
      transactionId: "tx-waiting",
      cardLastDigits: "4444",
      cardBrand: "mastercard",
      installments: 3,
      amount: 200,
      installmentAmount: 66.67,
      lytexStatus: "waitingPayment",
      createdAt: new Date().toISOString(),
    })
    mockDb.payment.upsert.mockResolvedValue({} as any)

    const req = createMockRequest({
      method: "POST",
      body: { card: VALID_CARD },
    })
    const res = await POST(req, { params: Promise.resolve({ id: "book-1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.status).toBe("waitingPayment")
    expect(data.message).toContain("Pagamento em processamento")
    // Should start polling (non-blocking)
    expect(pollChargeStatus).toHaveBeenCalledWith("card-charge-2")
  })

  it("rejeita dados de cartão incompletos (sem card.number)", async () => {
    mockDb.booking.findUnique.mockResolvedValue(PENDING_CARD_BOOKING)

    const req = createMockRequest({
      method: "POST",
      body: { card: { holderName: "Test", expiryMonth: "12", expiryYear: "2028", cvv: "123" } },
    })
    const res = await POST(req, { params: Promise.resolve({ id: "book-1" }) })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("Dados do cartão incompletos")
    expect(createCardCharge).not.toHaveBeenCalled()
  })

  it("rejeita dados de cartão completamente vazios", async () => {
    mockDb.booking.findUnique.mockResolvedValue(PENDING_CARD_BOOKING)

    const req = createMockRequest({
      method: "POST",
      body: { card: {} },
    })
    const res = await POST(req, { params: Promise.resolve({ id: "book-1" }) })

    expect(res.status).toBe(400)
    expect(createCardCharge).not.toHaveBeenCalled()
  })

  it("retorna badRequest com mensagem Lytex quando LytexError é lançado no cartão", async () => {
    mockDb.booking.findUnique.mockResolvedValue(PENDING_CARD_BOOKING)
    vi.mocked(createCardCharge).mockRejectedValue(
      new LytexError("Cartão recusado pela bandeira", 402),
    )

    const req = createMockRequest({
      method: "POST",
      body: { card: VALID_CARD },
    })
    const res = await POST(req, { params: Promise.resolve({ id: "book-1" }) })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("Lytex: Cartão recusado pela bandeira")
  })

  it("rejeita pagamento quando cartão tem status inesperado (falha)", async () => {
    mockDb.booking.findUnique.mockResolvedValue(PENDING_CARD_BOOKING)
    vi.mocked(createCardCharge).mockResolvedValue({
      id: "card-charge-fail",
      status: "failed",
      transactionId: "tx-fail",
      cardLastDigits: "0000",
      cardBrand: "unknown",
      installments: 1,
      amount: 200,
      installmentAmount: 200,
      lytexStatus: "failed",
      createdAt: new Date().toISOString(),
    })

    const req = createMockRequest({
      method: "POST",
      body: { card: VALID_CARD },
    })
    const res = await POST(req, { params: Promise.resolve({ id: "book-1" }) })
    const body = await res.json()

    // Falls through to "Pagamento não aprovado" error
    expect(res.status).toBe(400)
    expect(body.error).toContain("Pagamento não aprovado")
  })
})

describe("POST /api/bookings/[id]/pay — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lança 429 quando rate limit é excedido", async () => {
    mockDb.booking.findUnique.mockResolvedValue(PENDING_PIX_BOOKING)
    vi.mocked(assertRateLimit).mockRejectedValueOnce(
      new HttpError(429, "Muitas requisições. Tente novamente em alguns segundos."),
    )

    const res = await POST(mockRequest(), { params: Promise.resolve({ id: "book-1" }) })

    expect(res.status).toBe(429)
  })

  it("respeita prefixo rate-limit específico por booking", async () => {
    mockDb.booking.findUnique.mockResolvedValue(PENDING_PIX_BOOKING)

    await POST(mockRequest(), { params: Promise.resolve({ id: "book-1" }) })

    expect(assertRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        prefix: "pay:book-1",
      }),
    )
  })
})

describe("POST /api/bookings/[id]/pay — validations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("retorna 403 quando cliente tenta pagar booking de outro usuário", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockResolvedValueOnce({ userId: "other-client", role: "CLIENT" })
    mockDb.booking.findUnique.mockResolvedValue(PENDING_PIX_BOOKING)

    const res = await POST(mockRequest(), { params: Promise.resolve({ id: "book-1" }) })
    expect(res.status).toBe(403)
  })

  it("permite ADMIN pagar qualquer booking", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockResolvedValueOnce({ userId: "admin-1", role: "ADMIN" })
    mockDb.booking.findUnique.mockResolvedValue(PENDING_PIX_BOOKING)
    vi.mocked(createPixCharge).mockResolvedValue({
      id: "charge-admin",
      status: "waitingPayment",
      transactionId: "tx-admin",
      qrCode: "pix-admin",
      qrCodeImage: "data:image/png;base64,qr-admin",
      pixKey: "admin-key",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      amount: 200,
      lytexStatus: "waitingPayment",
      createdAt: new Date().toISOString(),
    })
    mockDb.payment.upsert.mockResolvedValue({} as any)

    const res = await POST(mockRequest(), { params: Promise.resolve({ id: "book-1" }) })
    expect(res.status).toBe(200)
  })

  it("retorna 400 quando booking está cancelada", async () => {
    mockDb.booking.findUnique.mockResolvedValue({ ...PENDING_PIX_BOOKING, status: "CANCELLED" })

    const res = await POST(mockRequest(), { params: Promise.resolve({ id: "book-1" }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("cancelado")
  })

  it("retorna 400 quando booking já está paga", async () => {
    mockDb.booking.findUnique.mockResolvedValue(PAID_BOOKING)

    const res = await POST(mockRequest(), { params: Promise.resolve({ id: "book-1" }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("já realizado")
  })

  it("retorna 404 quando booking não existe", async () => {
    mockDb.booking.findUnique.mockResolvedValue(null)

    const res = await POST(mockRequest(), { params: Promise.resolve({ id: "nonexistent" }) })
    expect(res.status).toBe(404)
  })
})

describe("POST /api/bookings/[id]/pay — LytexError propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("propaga erro não-Lytex como 500 (não engole exceção inesperada)", async () => {
    mockDb.booking.findUnique.mockResolvedValue(PENDING_PIX_BOOKING)
    vi.mocked(createPixCharge).mockRejectedValue(new Error("ECONNREFUSED"))

    const res = await POST(mockRequest(), { params: Promise.resolve({ id: "book-1" }) })

    // handleError mapeia Error genérico → 500
    expect(res.status).toBe(500)
  })

  it("propaga erro não-Lytex no fluxo de cartão como 500", async () => {
    mockDb.booking.findUnique.mockResolvedValue(PENDING_CARD_BOOKING)
    vi.mocked(createCardCharge).mockRejectedValue(new Error("connection timeout"))

    const req = createMockRequest({
      method: "POST",
      body: { card: VALID_CARD },
    })
    const res = await POST(req, { params: Promise.resolve({ id: "book-1" }) })

    expect(res.status).toBe(500)
  })
})
