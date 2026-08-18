/**
 * Lytex Payment Gateway Mock
 *
 * Mocks the Lytex API for E2E testing of payment flows.
 * Intercepts /api/webhooks/lytex and simulates payment confirmation.
 *
 * Usage in Playwright tests:
 *   import { mockLytexWebhook } from "./mocks/lytex"
 *
 *   // After creating a booking and initiating payment:
 *   await mockLytexWebhook(page, bookingId, "paid")
 */

import type { Page } from "@playwright/test"

// ── Mock charge database ──────────────────────────────────────────────────

const mockCharges = new Map<string, MockCharge>()

export interface MockCharge {
  id: string
  bookingId: string
  status: "pending" | "paid" | "refunded" | "expired" | "canceled"
  amount: number
  qrCode: string
  qrCodeImage: string
  paidAt?: string
  transactionId: string
  cardLastDigits?: string
  cardBrand?: string
  installments?: number
}

// ── Generate mock data ────────────────────────────────────────────────────

function generateMockCharge(bookingId: string, amount: number): MockCharge {
  return {
    id: `lytex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bookingId,
    status: "pending",
    amount,
    qrCode: `00020126580014BR.GOV.BCB.PIX0136${bookingId.slice(0, 36)}520400005303986540${amount.toFixed(2)}5802BR5913SEVERINNO6009SAO PAULO62070503***6304`,
    qrCodeImage: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`,
    transactionId: `txn-${Date.now()}`,
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Create a mock PIX charge for testing.
 */
export function createMockPixCharge(bookingId: string, amount: number): MockCharge {
  const charge = generateMockCharge(bookingId, amount)
  charge.status = "pending"
  mockCharges.set(charge.id, charge)
  return charge
}

/**
 * Create a mock card charge for testing.
 */
export function createMockCardCharge(
  bookingId: string,
  amount: number,
  options: { installments?: number; cardLastDigits?: string; cardBrand?: string } = {},
): MockCharge {
  const charge = generateMockCharge(bookingId, amount)
  charge.status = "pending"
  charge.installments = options.installments || 1
  charge.cardLastDigits = options.cardLastDigits || "1111"
  charge.cardBrand = options.cardBrand || "visa"
  mockCharges.set(charge.id, charge)
  return charge
}

/**
 * Simulate payment confirmation via webhook.
 */
export async function confirmPayment(
  page: Page,
  chargeId: string,
  bookingId: string,
  amount: number,
): Promise<void> {
  await page.request.post("/api/webhooks/lytex", {
    data: {
      id: chargeId,
      status: "paid",
      externalReference: `booking:${bookingId}`,
      amount,
      paidAt: new Date().toISOString(),
      transactionId: `txn-${Date.now()}`,
    },
  })
}

/**
 * Simulate payment refund via webhook.
 */
export async function refundPayment(page: Page, chargeId: string, bookingId: string): Promise<void> {
  await page.request.post("/api/webhooks/lytex", {
    data: {
      id: chargeId,
      status: "refunded",
      externalReference: `booking:${bookingId}`,
      amount: 0,
    },
  })
}

/**
 * Simulate payment expiration via webhook.
 */
export async function expirePayment(page: Page, chargeId: string, bookingId: string): Promise<void> {
  await page.request.post("/api/webhooks/lytex", {
    data: {
      id: chargeId,
      status: "expired",
      externalReference: `booking:${bookingId}`,
      amount: 0,
    },
  })
}

/**
 * Simulate payment cancellation via webhook.
 */
export async function cancelPayment(page: Page, chargeId: string, bookingId: string): Promise<void> {
  await page.request.post("/api/webhooks/lytex", {
    data: {
      id: chargeId,
      status: "canceled",
      externalReference: `booking:${bookingId}`,
      amount: 0,
    },
  })
}

/**
 * Get a mock charge by ID.
 */
export function getMockCharge(chargeId: string): MockCharge | undefined {
  return mockCharges.get(chargeId)
}

/**
 * Clear all mock charges (call in test cleanup).
 */
export function clearMockCharges(): void {
  mockCharges.clear()
}

/**
 * Mock the Lytex API responses for Playwright page routing.
 * Intercepts requests to Lytex API and returns mock responses.
 */
export function mockLytexApi(page: Page): void {
  // Mock PIX charge creation
  page.route("**/api.lytex.com.br/v1/charges", async (route) => {
    const request = route.request()
    if (request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}")

      const charge: MockCharge = {
        id: `lytex-${Date.now()}`,
        bookingId: body.externalReference?.replace("booking:", "") || "unknown",
        status: "pending",
        amount: body.amount || 0,
        qrCode: `00020126580014BR.GOV.BCB.PIX0136${body.externalReference || ""}520400005303986540${(body.amount || 0).toFixed(2)}5802BR5913SEVERINNO6009SAO PAULO62070503***6304`,
        qrCodeImage: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`,
        transactionId: `txn-${Date.now()}`,
      }

      mockCharges.set(charge.id, charge)

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: charge.id,
          status: charge.status,
          amount: charge.amount,
          qrCode: charge.qrCode,
          qrCodeImage: charge.qrCodeImage,
          transactionId: charge.transactionId,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }),
      })
    } else {
      await route.continue()
    }
  })

  // Mock card charge creation
  page.route("**/api.lytex.com.br/v1/charges/card", async (route) => {
    const request = route.request()
    if (request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}")

      const charge: MockCharge = {
        id: `lytex-card-${Date.now()}`,
        bookingId: body.externalReference?.replace("booking:", "") || "unknown",
        status: "paid", // Card charges are typically synchronous
        amount: body.amount || 0,
        qrCode: "",
        qrCodeImage: "",
        transactionId: `txn-card-${Date.now()}`,
        cardLastDigits: body.card?.number?.slice(-4) || "1111",
        cardBrand: "visa",
        installments: body.installments || 1,
      }

      mockCharges.set(charge.id, charge)

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: charge.id,
          status: charge.status,
          amount: charge.amount,
          transactionId: charge.transactionId,
          cardLastDigits: charge.cardLastDigits,
          cardBrand: charge.cardBrand,
          installments: charge.installments,
        }),
      })
    } else {
      await route.continue()
    }
  })
}
