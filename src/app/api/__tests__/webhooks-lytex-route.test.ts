import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))

// Mock mail, notification, realtime before importing
vi.mock("@/lib/mail", () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  paymentConfirmedHtml: vi.fn().mockReturnValue("<html></html>"),
  paymentRefundedHtml: vi.fn().mockReturnValue("<html></html>"),
}))

vi.mock("@/lib/notification-queue", () => ({
  saveAndQueueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/realtime-client", () => ({
  emitRealtime: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/lytex", () => ({
  verifyWebhookSignature: vi.fn().mockReturnValue(true),
  parseExternalReference: vi.fn((ref: string) => {
    const parts = ref.split(":")
    return { type: parts[0] ?? "booking", id: parts[1] ?? ref }
  }),
  lytexLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))

// Mock db before importing
vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findUnique: vi.fn(),
    },
    payment: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    //  is mocked in vitest.setup.ts via @prisma/client,
    // but the mock for @/lib/db overrides it — need to provide it here
    $transaction: vi.fn(async (queries: Array<Promise<unknown>>) => {
      return Promise.all(queries)
    }),
    booking: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { verifyWebhookSignature, parseExternalReference } from "@/lib/lytex"
import { POST as webhookHandler } from "../webhooks/lytex/route"


import { db } from "@/lib/db"

// ── Tests ──────────────────────────────────────────────────────────────────

// Save original value to restore after all tests (prevents env leak to other test files)
const _origWebhookSecret = process.env.PAYMENT_WEBHOOK_SECRET

describe("POST /api/webhooks/lytex", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear PAYMENT_WEBHOOK_SECRET so the route skips signature validation
    // (the test sends a fake signature, not a real HMAC)
    process.env.PAYMENT_WEBHOOK_SECRET = ""
  })

  afterAll(() => {
    process.env.PAYMENT_WEBHOOK_SECRET = _origWebhookSecret
  })

  const chargePaidPayload = {
    id: "lytex-charge-paid-1",
    transactionId: "tx-123",
    externalReference: "booking:book-1",
    status: "paid" as const,
    paymentMethod: "PIX",
    paidAmount: 20000,
    paidAt: new Date().toISOString(),
  }

  it("processes charge.paid event and updates booking", async () => {
    // Mock setting lookup to return empty (skip signature validation)
    (vi.mocked(db.setting.findUnique) as any).mockResolvedValue(null)
    (vi.mocked(db.payment.upsert) as any).mockResolvedValue({} as any)
    (vi.mocked(db.booking.update) as any).mockResolvedValue({} as any)
    // First mock: confirmBookingPayment findUnique — must have payment
    vi.mocked(db.booking.findUnique)
      .mockResolvedValueOnce({
        id: "book-1",
        clientId: "client-1",
        providerId: "provider-1",
        paymentStatus: "PENDING",
        status: "PENDING",
        amount: 200,
        payment: { id: "pay-1", status: "PENDING" },
      })
      .mockResolvedValueOnce({
        id: "book-1",
        client: { name: "Client", email: "client@test.com", id: "client-1" },
        provider: { name: "Provider", id: "provider-1" },
        service: { title: "Service" },
        scheduledAt: new Date(),
        amount: 200,
        paymentMethod: "PIX",
      })

    const req = createMockRequest({
      method: "POST",
      body: chargePaidPayload,
      headers: { "x-signature": "any-signature" },
    })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).received).toBe(true)
    expect(db.$transaction).toHaveBeenCalled()
    expect(db.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: "book-1" },
        data: expect.objectContaining({ status: "PAID" }),
      }),
    )
  })

  it("processes charge.expired event", async () => {
    (vi.mocked(db.setting.findUnique) as any).mockResolvedValue(null)
    (vi.mocked(db.payment.upsert) as any).mockResolvedValue({} as any)
    (vi.mocked(db.booking.update) as any).mockResolvedValue({} as any)
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue({
      clientId: "client-1",
      amount: 200,
    } as any)

    const payload = {
      id: "lytex-charge-expired-1",
      transactionId: "tx-123",
      externalReference: "booking:book-1",
      status: "expired" as const,
      paymentMethod: "PIX",
    }

    const req = createMockRequest({
      method: "POST",
      body: payload,
    })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).received).toBe(true)
    // Handler only logs for expired events — no DB update needed
    expect(db.booking.update).not.toHaveBeenCalled()
  })

  it("processes charge.refunded event", async () => {
    (vi.mocked(db.payment.findUnique) as any).mockResolvedValue({ id: "pay-1", status: "PAID", lytexId: "lytex-charge-refunded-1" } as any)
    (vi.mocked(db.booking.update) as any).mockResolvedValue({
      client: { name: "Client", email: "client@test.com", id: "client-1" },
      provider: { name: "Provider", id: "provider-1" },
      service: { title: "Service" },
      amount: 200,
    } as any)

    const payload = {
      id: "lytex-charge-refunded-1",
      transactionId: "tx-123",
      externalReference: "booking:book-1",
      status: "refunded" as const,
      paymentMethod: "PIX",
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).received).toBe(true)
    expect(db.payment.update).toHaveBeenCalled()
  })

  it("returns 400 when external reference is invalid", async () => {
    vi.mocked(verifyWebhookSignature).mockReturnValue(true)
    vi.mocked(parseExternalReference).mockReturnValueOnce(null)

    const payload = {
      id: "ch-1",
      transactionId: "tx-1",
      externalReference: "invalid-ref",
      status: "paid" as const,
      paymentMethod: "PIX",
    }

    const req = createMockRequest({
      method: "POST",
      body: payload,
    })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toBe("externalReference inválido")
  })

  it("returns 401 when signature is invalid", async () => {
    vi.mocked(verifyWebhookSignature).mockReturnValue(false)

    const payload = {
      id: "ch-1",
      transactionId: "tx-1",
      externalReference: "booking:book-1",
      status: "paid" as const,
      paymentMethod: "PIX",
    }

    const req = createMockRequest({
      method: "POST",
      body: payload,
    })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(401)
    expect((parsed.body as any).error).toBe("Assinatura inválida")
  })
})

// ── Idempotency — booking already PAID ──────────────────────────────────────

describe("POST /api/webhooks/lytex — idempotência (booking já paga)", () => {
  beforeEach(() => {
    process.env.PAYMENT_WEBHOOK_SECRET = ""
    vi.mocked(verifyWebhookSignature).mockReturnValue(true)
    // Recreate all db mocks fresh — avoids vi.clearAllMocks() quirk that resets implementations
    db.booking.findUnique = vi.fn()
    db.booking.update = vi.fn()
    db.payment.update = vi.fn()
    db.payment.findUnique = vi.fn()
    db.payment.upsert = vi.fn()
    db.payment.updateMany = vi.fn()
    db.$transaction = vi.fn(async (queries: Array<Promise<unknown>>) => Promise.all(queries))
  })

  it("atualiza apenas metadados quando booking já está PAID", async () => {
    db.booking.findUnique = vi.fn().mockResolvedValue({
      id: "book-1",
      clientId: "client-1",
      providerId: "provider-1",
      paymentStatus: "PAID",
      status: "CONFIRMED",
      amount: 200,
      payment: { id: "pay-1", status: "PAID" },
    })
    db.payment.update = vi.fn().mockResolvedValue({} as any)

    const payload = {
      id: "lytex-charge-duplicate",
      transactionId: "tx-new",
      externalReference: "booking:book-1",
      status: "paid" as const,
      paymentMethod: "PIX",
      qrCode: "new-qr-code",
      qrCodeImage: "data:image/png;base64,new",
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).received).toBe(true)

    // Should update metadata (lytexId, qrCode) but NOT call $transaction
    expect(db.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: "book-1" },
        data: expect.objectContaining({ qrCode: "new-qr-code" }),
      }),
    )
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("não cria nova notificação quando booking já está PAID", async () => {
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue({
      id: "book-1",
      clientId: "client-1",
      providerId: "provider-1",
      paymentStatus: "PAID",
      status: "CONFIRMED",
      amount: 200,
      payment: { id: "pay-1", status: "PAID" },
    })
    (vi.mocked(db.payment.update) as any).mockResolvedValue({} as any)

    const payload = {
      id: "lytex-charge-duplicate-2",
      transactionId: "tx-new-2",
      externalReference: "booking:book-1",
      status: "paid" as const,
      paymentMethod: "PIX",
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    // notifyPaymentConfirmed is only called AFTER $transaction — since early return
    // happens before $transaction, the notification should not be attempted
    // We verify this indirectly: db.booking.update was not called (only payment.update)
    expect(db.booking.update).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

// ── Card payment ────────────────────────────────────────────────────────────

describe("POST /api/webhooks/lytex — pagamento com cartão", () => {
  beforeEach(() => {
    process.env.PAYMENT_WEBHOOK_SECRET = ""
    vi.mocked(verifyWebhookSignature).mockReturnValue(true)
    db.booking.findUnique = vi.fn()
    db.booking.update = vi.fn()
    db.payment.update = vi.fn()
    db.payment.findUnique = vi.fn()
    db.$transaction = vi.fn(async (q: Array<Promise<unknown>>) => Promise.all(q))
  })

  it("processa charge.paid com paymentMethod CARD", async () => {
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue({
      id: "book-card-1",
      clientId: "client-1",
      providerId: "provider-1",
      paymentStatus: "PENDING",
      status: "CONFIRMED",
      amount: 350,
      payment: { id: "pay-card-1", status: "PENDING" },
    })
    (vi.mocked(db.payment.update) as any).mockResolvedValue({} as any)
    (vi.mocked(db.booking.update) as any).mockResolvedValue({} as any)
    vi.mocked(db.$transaction).mockResolvedValue([{}, {}])

    const payload = {
      id: "lytex-card-paid-1",
      transactionId: "tx-card-1",
      externalReference: "booking:book-card-1",
      status: "paid" as const,
      paymentMethod: "CARD",
      paidAmount: 35000,
      paidAt: new Date().toISOString(),
      cardLastDigits: "4444",
      cardBrand: "mastercard",
      installments: 3,
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(db.$transaction).toHaveBeenCalled()
    // Should pass card-specific fields to payment.update
    expect(db.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cardLastDigits: "4444",
          cardBrand: "mastercard",
          installments: 3,
          status: "PAID",
        }),
      }),
    )
  })
})

// ── Non-paid status events (log only) ───────────────────────────────────────

describe("POST /api/webhooks/lytex — status não-pagos (log only)", () => {
  beforeEach(() => {
    process.env.PAYMENT_WEBHOOK_SECRET = ""
    vi.mocked(verifyWebhookSignature).mockReturnValue(true)
    db.booking.findUnique = vi.fn()
    db.booking.update = vi.fn()
    db.payment.update = vi.fn()
    db.payment.findUnique = vi.fn()
    db.$transaction = vi.fn(async (q: Array<Promise<unknown>>) => Promise.all(q))
  })

  it("canceled: apenas log, sem DB update", async () => {
    const payload = {
      id: "lytex-canceled-1",
      transactionId: "tx-canceled",
      externalReference: "booking:book-canceled",
      status: "canceled" as const,
      paymentMethod: "PIX",
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    // No DB mutation for canceled events
    // db.booking.findUnique still gets called by parseExternalReference path
    // but no update/transaction
    expect(db.booking.update).not.toHaveBeenCalled()
    expect(db.payment.update).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("waitingPayment: apenas log, sem DB update", async () => {
    const payload = {
      id: "lytex-waiting-1",
      transactionId: "tx-waiting",
      externalReference: "booking:book-waiting",
      status: "waitingPayment" as const,
      paymentMethod: "CARD",
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(db.booking.update).not.toHaveBeenCalled()
    expect(db.payment.update).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("status desconhecido: apenas log, sem DB update", async () => {
    const payload = {
      id: "lytex-unknown-1",
      transactionId: "tx-unknown",
      externalReference: "booking:book-unknown",
      status: "unknown_status" as any,
      paymentMethod: "BOLETO",
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(db.booking.update).not.toHaveBeenCalled()
    expect(db.payment.update).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("POST /api/webhooks/lytex — edge cases", () => {
  beforeEach(() => {
    process.env.PAYMENT_WEBHOOK_SECRET = ""
    vi.mocked(verifyWebhookSignature).mockReturnValue(true)
    db.booking.findUnique = vi.fn()
    db.booking.update = vi.fn()
    db.payment.update = vi.fn()
    db.payment.findUnique = vi.fn()
    db.$transaction = vi.fn(async (q: Array<Promise<unknown>>) => Promise.all(q))
  })

  it("refund sem lytexId: warn, sem DB update", async () => {
    (vi.mocked(db.payment.findUnique) as any).mockResolvedValue({
      id: "pay-no-lytex",
      status: "PAID",
      lytexId: null,
    } as any)

    const payload = {
      id: "lytex-refund-no-id",
      transactionId: "tx-refund",
      externalReference: "booking:book-refund-no-id",
      status: "refunded" as const,
      paymentMethod: "PIX",
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    // refundBookingPayment logs warn and returns without DB update
    expect(db.payment.update).not.toHaveBeenCalled()
    expect(db.booking.update).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("confirmPayment sem payment: warn, retorna sem DB update", async () => {
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue({
      id: "book-no-payment",
      clientId: "client-1",
      providerId: "provider-1",
      paymentStatus: "PENDING",
      status: "CONFIRMED",
      amount: 200,
      payment: null, // No payment record yet
    } as any)

    const payload = {
      id: "lytex-paid-no-payment",
      transactionId: "tx-no-payment",
      externalReference: "booking:book-no-payment",
      status: "paid" as const,
      paymentMethod: "PIX",
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    // confirmBookingPayment logs warn and returns early
    expect(db.payment.update).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("JSON inválido no body retorna 200 (catch block)", async () => {
    const req = createMockRequest({ method: "POST" })
    // Override body to invalid JSON by accessing Request internals
    // createMockRequest with no body creates an empty GET — use explicit invalid body
    const badReq = new Request("http://localhost:3000/api/webhooks/lytex", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json-}",
    })

    const res = await webhookHandler(badReq)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    // catch block logs error and returns { received: true }
    expect((parsed.body as any).received).toBe(true)
    // No DB operations should be attempted
    expect(db.booking.findUnique).not.toHaveBeenCalled()
  })
})
