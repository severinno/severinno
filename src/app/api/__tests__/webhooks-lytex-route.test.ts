import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

// Mock db before importing
vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findUnique: vi.fn(),
    },
    payment: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    booking: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

// ── Imports ────────────────────────────────────────────────────────────────

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
    event: "charge.paid",
    charge: {
      id: "lytex-charge-paid-1",
      referenceId: "book-1",
      amount: 20000, // in cents
      status: "paid",
      paymentMethod: "PIX",
      paidAmount: 20000,
      paidAt: new Date().toISOString(),
      transactionId: "tx-123",
    },
  }

  it("processes charge.paid event and updates booking", async () => {
    // Mock setting lookup to return empty (skip signature validation)
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
    vi.mocked(db.payment.upsert).mockResolvedValue({} as any)
    vi.mocked(db.booking.update).mockResolvedValue({} as any)
    vi.mocked(db.booking.findUnique)
      .mockResolvedValueOnce({ clientId: "client-1", providerId: "provider-1" })
      .mockResolvedValueOnce({
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
    expect(parsed.body!.ok).toBe(true)
    expect(db.payment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: "book-1" },
        create: expect.objectContaining({ status: "PAID" }),
        update: expect.objectContaining({ status: "PAID" }),
      }),
    )
    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "book-1" },
        data: { paymentStatus: "PAID", status: "CONFIRMED" },
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
      event: "charge.expired",
      charge: {
        id: "lytex-charge-expired-1",
        referenceId: "book-1",
        amount: 20000,
        status: "expired",
        paymentMethod: "PIX",
        transactionId: "tx-123",
      },
    }

    const req = createMockRequest({
      method: "POST",
      body: payload,
    })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.ok).toBe(true)
    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { paymentStatus: "PENDING" },
      }),
    )
  })

  it("processes charge.refunded event", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)
    vi.mocked(db.payment.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(db.booking.update).mockResolvedValue({
      client: { name: "Client", email: "client@test.com", id: "client-1" },
      provider: { name: "Provider", id: "provider-1" },
      service: { title: "Service" },
      amount: 200,
    } as any)

    const payload = {
      event: "charge.refunded",
      charge: {
        id: "lytex-charge-refunded-1",
        referenceId: "book-1",
        amount: 20000,
        status: "refunded",
        paymentMethod: "PIX",
        transactionId: "tx-123",
      },
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.ok).toBe(true)
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: "book-1" },
        data: { status: "REFUNDED" },
      }),
    )
    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { paymentStatus: "REFUNDED" },
      }),
    )
  })

  it("returns 400 when charge data is missing", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)

    const req = createMockRequest({
      method: "POST",
      body: { event: "charge.paid" },
    })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(parsed.body!.error).toBe("missing charge data")
  })

  it("returns 400 when referenceId is missing", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)

    const req = createMockRequest({
      method: "POST",
      body: {
        event: "charge.paid",
        charge: { id: "ch-1", amount: 100, status: "paid", paymentMethod: "PIX" },
      },
    })
    const res = await webhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(parsed.body!.error).toBe("missing referenceId")
  })
})
