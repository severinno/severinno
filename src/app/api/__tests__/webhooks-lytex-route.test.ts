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
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
    vi.mocked(db.payment.upsert).mockResolvedValue({} as any)
    vi.mocked(db.booking.update).mockResolvedValue({} as any)
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
    expect(parsed.body!.received).toBe(true)
    expect(db.$transaction).toHaveBeenCalled()
    expect(db.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: "book-1" },
        data: expect.objectContaining({ status: "PAID" }),
      }),
    )
  })

  it("processes charge.expired event", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
    vi.mocked(db.payment.upsert).mockResolvedValue({} as any)
    vi.mocked(db.booking.update).mockResolvedValue({} as any)
    vi.mocked(db.booking.findUnique).mockResolvedValue({
      clientId: "client-1",
      amount: 200,
    })

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
    expect(parsed.body!.received).toBe(true)
    // Handler only logs for expired events — no DB update needed
    expect(db.booking.update).not.toHaveBeenCalled()
  })

  it("processes charge.refunded event", async () => {
    vi.mocked(db.payment.findUnique).mockResolvedValue({ id: "pay-1", status: "PAID", lytexId: "lytex-charge-refunded-1" })
    vi.mocked(db.booking.update).mockResolvedValue({
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
    expect(parsed.body!.received).toBe(true)
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
    expect(parsed.body!.error).toBe("externalReference inválido")
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
    expect(parsed.body!.error).toBe("Assinatura inválida")
  })
})
