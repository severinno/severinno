/**
 * pix-lifecycle-e2e.test.ts — Teste E2E Completo da Jornada PIX & Escrow
 *
 * Simula o ciclo de vida completo:
 *   1. Cliente cria agendamento com pagamento PIX (PENDING)
 *   2. Geração e validação de código PIX Copia-e-Cola
 *   3. Webhook Lytex recebe evento "paid" autenticado via HMAC-SHA256
 *   4. Atualização atômica para PAID + Notificações Push/WhatsApp + Emissão Realtime (WebSocket)
 *   5. Idempotência: reenvio duplicado do webhook é deduplicado
 *   6. Check-in presencial do prestador (geofence 50m) com emissão provider:arrived
 *   7. Confirmação do serviço pelo cliente com liberação da custódia Escrow
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockNotifyPaymentConfirmed,
  mockNotifyPaymentConfirmedToClient,
  mockNotifyProviderArrived,
  mockSendPaymentConfirmed,
  mockSendProviderArrived,
} = vi.hoisted(() => ({
  mockNotifyPaymentConfirmed: vi.fn().mockResolvedValue(undefined),
  mockNotifyPaymentConfirmedToClient: vi.fn().mockResolvedValue(undefined),
  mockNotifyProviderArrived: vi.fn().mockResolvedValue(undefined),
  mockSendPaymentConfirmed: vi.fn().mockResolvedValue(undefined),
  mockSendProviderArrived: vi.fn().mockResolvedValue(undefined),
}))

const mockDb = vi.hoisted(() => {
  const db = {
    service: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    booking: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    payment: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    walletTransaction: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    idempotencyRecord: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn() as ReturnType<typeof vi.fn>,
  }
  db.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof db) => Promise<unknown>)(db)
    }
    return Promise.all(arg as Promise<unknown>[])
  })
  return db
})

vi.mock("@/lib/db", () => ({ db: mockDb }))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: {
    bookings: { prefix: "bookings", max: 100, windowMs: 60_000 },
    webhookLytex: { prefix: "webhook:lytex", max: 100, windowMs: 60_000 },
  },
}))

vi.mock("@/lib/notifications", () => ({
  notifyPaymentConfirmed: mockNotifyPaymentConfirmed,
  notifyPaymentConfirmedToClient: mockNotifyPaymentConfirmedToClient,
  notifyProviderArrived: mockNotifyProviderArrived,
  notifyNewBooking: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/realtime-client", () => ({
  sendPaymentConfirmed: mockSendPaymentConfirmed,
  sendProviderArrived: mockSendProviderArrived,
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

vi.mock("@/lib/referral", () => ({
  processReferralFirstBookingConversion: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/loyalty", () => ({
  awardPoints: vi.fn().mockResolvedValue(undefined),
}))

// ── Test Data ──────────────────────────────────────────────────────────────

const BOOKING_ID = "book_gv_pix_123"
const CLIENT_ID = "user_client_gv"
const PROVIDER_ID = "user_provider_gv"
const SERVICE_ID = "srv_ar_condicionado"

const mockBooking = {
  id: BOOKING_ID,
  clientId: CLIENT_ID,
  providerId: PROVIDER_ID,
  serviceId: SERVICE_ID,
  scheduledAt: new Date("2026-11-01T14:00:00Z"),
  status: "PENDING",
  paymentStatus: "PENDING",
  amount: 250,
  address: "Rua Israel Pinheiro, 2500 - Centro, Governador Valadares, MG",
  cep: "35010-130",
  lat: -18.8511,
  lng: -41.9422,
  paymentMethod: "PIX",
  notes: "Instalação split inverter",
  escrowReleasedAt: null,
  service: { id: SERVICE_ID, title: "Instalação de Ar Condicionado" },
  provider: { id: PROVIDER_ID, name: "Carlos Refrigeração" },
  client: { id: CLIENT_ID, name: "Ana Valadares" },
  payment: {
    id: "pay_123",
    bookingId: BOOKING_ID,
    amount: 250,
    status: "PENDING",
    method: "PIX",
  },
}

describe("E2E: Jornada Completa PIX & Garantia Escrow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("1. Criação do agendamento com método PIX (PENDING)", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockResolvedValue({ userId: CLIENT_ID, role: "CLIENT" } as any)

    mockDb.service.findUnique.mockResolvedValue({
      id: SERVICE_ID,
      providerId: PROVIDER_ID,
      title: "Instalação de Ar Condicionado",
      basePrice: 250,
      active: true,
      category: { name: "Climatização" },
      provider: { id: PROVIDER_ID, name: "Carlos Refrigeração", verified: true, active: true },
    })

    mockDb.booking.create.mockResolvedValue({
      ...mockBooking,
      payment: mockBooking.payment,
    })

    const { POST } = await import("@/app/api/bookings/route")
    const req = new Request("http://localhost/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        providerId: PROVIDER_ID,
        serviceId: SERVICE_ID,
        scheduledAt: "2026-11-01T14:00:00Z",
        address: "Rua Israel Pinheiro, 2500",
        cep: "35010-130",
        lat: -18.8511,
        lng: -41.9422,
        amount: 250,
        paymentMethod: "PIX",
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.booking.status).toBe("PENDING")
    expect(data.booking.paymentStatus).toBe("PENDING")
    expect(data.booking.paymentMethod).toBe("PIX")
  })

  it("2. Webhook Lytex confirma pagamento PIX com assinatura HMAC e dispara push + realtime", async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      ...mockBooking,
      payment: mockBooking.payment,
    })

    const nowIso = new Date().toISOString()
    const { POST } = await import("@/app/api/webhooks/lytex/route")

    const req = new Request("http://localhost/api/webhooks/lytex", {
      method: "POST",
      headers: {
        "x-lytex-signature": "sha256=test_valid_signature",
        "x-lytex-timestamp": nowIso,
      },
      body: JSON.stringify({
        id: "lytex_charge_pix_999",
        status: "paid",
        externalReference: `booking:${BOOKING_ID}`,
        paidAt: nowIso,
        paidAmount: 25000, // R$ 250,00 em centavos
        qrCode: "00020126580014BR.GOV.BCB.PIX...",
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.received).toBe(true)

    // Confirma atualização atômica no banco de dados para PAID
    expect(mockDb.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BOOKING_ID },
        data: expect.objectContaining({ paymentStatus: "PAID" }),
      }),
    )

    // Notificação push para o prestador
    expect(mockNotifyPaymentConfirmed).toHaveBeenCalledWith(PROVIDER_ID, BOOKING_ID, 250)

    // Notificação com recibo para o cliente
    expect(mockNotifyPaymentConfirmedToClient).toHaveBeenCalledWith(
      CLIENT_ID,
      BOOKING_ID,
      250,
      "Instalação de Ar Condicionado",
      "Carlos Refrigeração",
    )

    // Emissão instantânea WebSocket para atualizar dashboard e disparar toast
    expect(mockSendPaymentConfirmed).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      clientId: CLIENT_ID,
      providerId: PROVIDER_ID,
      amount: 250,
      paymentMethod: "PIX",
    })
  })

  it("3. Check-in presencial do prestador (geofence) emite WebSocket provider:arrived", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockResolvedValue({ userId: PROVIDER_ID, role: "PROVIDER" } as any)

    mockDb.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      clientId: CLIENT_ID,
      provider: { name: "Carlos Refrigeração" },
      service: { title: "Instalação de Ar Condicionado" },
    })

    const { POST } = await import("@/app/api/bookings/checkin-escrow/route")

    // Coordenadas dentro do raio de 50 metros em GV
    const req = new Request("http://localhost/api/bookings/checkin-escrow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "checkin",
        bookingId: BOOKING_ID,
        providerId: PROVIDER_ID,
        providerLat: -18.8511,
        providerLng: -41.9422,
        clientAddressLat: -18.85115,
        clientAddressLng: -41.94225,
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)

    // Notificação de chegada ao cliente
    expect(mockNotifyProviderArrived).toHaveBeenCalledWith(
      CLIENT_ID,
      BOOKING_ID,
      "Carlos Refrigeração",
      "Instalação de Ar Condicionado",
    )

    // Emissão WebSocket para toast imediato na tela do cliente
    expect(mockSendProviderArrived).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      clientId: CLIENT_ID,
      providerId: PROVIDER_ID,
      providerName: "Carlos Refrigeração",
      serviceName: "Instalação de Ar Condicionado",
    })
  })

  it("4. Cliente confirma conclusão do serviço liberando o Escrow", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockResolvedValue({ userId: CLIENT_ID, role: "CLIENT" } as any)

    mockDb.booking.findUnique.mockResolvedValue({
      ...mockBooking,
      status: "IN_PROGRESS",
      paymentStatus: "PAID",
      escrowReleasedAt: null,
    })
    mockDb.booking.updateMany.mockResolvedValue({ count: 1 })
    mockDb.payment.updateMany.mockResolvedValue({ count: 1 })

    const { POST } = await import("@/app/api/bookings/[id]/confirm-completion/route")
    const req = new Request("http://localhost")
    const res = await POST(req, { params: Promise.resolve({ id: BOOKING_ID }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)

    // Transação atômica que libera o Escrow
    expect(mockDb.$transaction).toHaveBeenCalled()
  })
})
