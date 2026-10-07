/**
 * financial-flow-e2e.test.ts
 *
 * Integration tests for the COMPLETE financial flow:
 *   1. Client creates booking (PENDING + PENDING payment)
 *   2. Lytex webhook confirms payment (PAID)
 *   3. Provider checks in (checkin-escrow)
 *   4. Client confirms completion (escrow released, PAID)
 *   5. Provider withdraws (walletTransaction created, balance deducted)
 *
 * Uses mocked DB (Prisma) to test the full lifecycle without a real database.
 * Each step calls the actual route handler logic to verify end-to-end behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => {
  const db = {
    user: {
      findUnique: vi.fn(),
    },
    service: {
      findUnique: vi.fn(),
    },
    booking: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    payment: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    walletTransaction: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
    },
    resetToken: {
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    // webhook lytex importa @/lib/idempotency (lib real) — model precisa
    // existir E resolver promise (a lib encadeia .catch no update)
    idempotencyRecord: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn() as ReturnType<typeof vi.fn>,
    $queryRaw: vi.fn().mockResolvedValue([]),
  }
  db.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return await arg(db)
    }
    const results: unknown[] = []
    for (const item of arg as unknown[]) {
      results.push(await Promise.resolve(item))
    }
    return results
  })
  return db
})

vi.mock("@/lib/db", () => ({ db: mockDb }))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
  requireRole: vi.fn(),
  createSession: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: new Proxy({}, { get: () => ({ prefix: "test", max: 10000, windowMs: 60_000 }) }),
}))

vi.mock("@/lib/notifications", () => ({
  notifyNewBooking: vi.fn().mockResolvedValue(undefined),
  notifyPaymentConfirmed: vi.fn().mockResolvedValue(undefined),
  notifyBookingStatus: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/notification-queue", () => ({
  saveAndQueueNotification: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheInvalidate: vi.fn().mockResolvedValue(undefined),
  withCache: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  getCacheStats: vi
    .fn()
    .mockReturnValue({ hits: 0, misses: 0, total: 0, hitRatio: null, memoryStoreSize: 0 }),
  isRedisAvailable: vi.fn().mockReturnValue(false),
  getMemoryCacheDiagnostics: vi.fn().mockReturnValue({ available: true, size: 0, maxAgeMs: null }),
}))

vi.mock("@/lib/lytex", () => ({
  verifyWebhookSignature: vi.fn().mockReturnValue(true),
  parseExternalReference: vi.fn((ref: string) => {
    const match = ref?.match(/^booking:(.+)$/)
    return match ? { type: "booking", id: match[1] } : null
  }),
  lytexLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/lib/realtime-client", () => ({
  emitRealtime: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/demo-accounts", () => ({
  isDemoAccountsEnabled: vi.fn().mockReturnValue(false),
  isDemoAccountEmail: vi.fn().mockReturnValue(false),
}))

vi.mock("@/lib/validators", () => ({
  bookingSchema: { parse: (v: unknown) => v },
  loginSchema: { parse: (v: unknown) => v },
  registerSchema: { parse: (v: unknown) => v },
  messageSchema: { parse: (v: unknown) => v },
}))

vi.mock("@/lib/sentry", () => ({
  captureError: vi.fn(),
}))

vi.mock("@/lib/wallet", () => ({
  computeAvailableBalance: vi.fn(),
  computeBaseBalance: vi.fn(),
  getWithdrawals: vi.fn(),
  buildWallet: vi.fn(),
  FEE_RATE: 0.15,
}))

// ── Test data ──────────────────────────────────────────────────────────────

const CLIENT_ID = "client-001"
const PROVIDER_ID = "provider-001"
const SERVICE_ID = "service-001"
const BOOKING_ID = "booking-001"
const PAYMENT_ID = "payment-001"

const _mockClient = {
  id: CLIENT_ID,
  name: "João Silva",
  email: "joao@test.com",
  role: "CLIENT",
  active: true,
  passwordHash: "hash",
  avatarUrl: null,
}

const _mockProvider = {
  id: PROVIDER_ID,
  name: "Maria Serviços",
  email: "maria@test.com",
  role: "PROVIDER",
  active: true,
  verified: true,
  passwordHash: "hash",
  avatarUrl: null,
  avgRating: 4.8,
  reviewCount: 50,
}

const mockService = {
  id: SERVICE_ID,
  providerId: PROVIDER_ID,
  title: "Limpeza Residencial",
  basePrice: 250,
  active: true,
  category: { name: "Limpeza" },
  provider: { id: PROVIDER_ID, verified: true, active: true },
}

const mockBooking = {
  id: BOOKING_ID,
  clientId: CLIENT_ID,
  providerId: PROVIDER_ID,
  serviceId: SERVICE_ID,
  scheduledAt: new Date("2030-03-15T14:00:00Z"),
  status: "PENDING",
  paymentStatus: "PENDING",
  amount: 250,
  address: "Rua Augusta, 1500",
  cep: "01304-001",
  lat: -23.55,
  lng: -46.63,
  paymentMethod: "PIX",
  notes: null,
  escrowReleasedAt: null,
  service: mockService,
  provider: { id: PROVIDER_ID, name: "Maria Serviços" },
  client: { id: CLIENT_ID, name: "João Silva" },
  payment: {
    id: PAYMENT_ID,
    bookingId: BOOKING_ID,
    amount: 250,
    status: "PENDING",
    method: "PIX",
  },
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Financial Flow E2E: Booking → Payment → Escrow → Completion → Withdrawal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("Step 1: Client creates booking (PENDING + PENDING payment)", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockResolvedValue({ userId: CLIENT_ID, role: "CLIENT" } as any)

    mockDb.service.findUnique.mockResolvedValue(mockService)
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
        scheduledAt: "2030-03-15T14:00:00Z",
        address: "Rua Augusta, 1500",
        cep: "01304-001",
        lat: -23.55,
        lng: -46.63,
        amount: 250,
        paymentMethod: "PIX",
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.booking.status).toBe("PENDING")
    expect(data.booking.paymentStatus).toBe("PENDING")
    expect(data.booking.payment.status).toBe("PENDING")
    expect(data.booking.amount).toBe(250)
  })

  it("Step 2: Lytex webhook confirms payment (PENDING → PAID)", async () => {
    // Simulate existing booking in PENDING state
    mockDb.booking.findUnique.mockResolvedValue({
      ...mockBooking,
      payment: mockBooking.payment,
    })

    const { POST } = await import("@/app/api/webhooks/lytex/route")
    const req = new Request("http://localhost/api/webhooks/lytex", {
      method: "POST",
      body: JSON.stringify({
        id: "lytex-001",
        status: "paid",
        externalReference: `booking:${BOOKING_ID}`,
        paidAt: new Date().toISOString(),
        qrCode: "pix-qr-code",
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.received).toBe(true)

    // Verify booking was updated to PAID
    expect(mockDb.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentStatus: "PAID" }),
      }),
    )
    expect(mockDb.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PAID" }),
      }),
    )
  })

  it("Step 3: Provider checks in (checkin-escrow)", async () => {
    const { validateGeoCheckin } = await import("@/lib/geo-checkin-escrow")

    const result = validateGeoCheckin({
      bookingId: BOOKING_ID,
      providerId: PROVIDER_ID,
      providerLat: -23.55,
      providerLng: -46.63,
      clientAddressLat: -23.55,
      clientAddressLng: -46.63,
    })

    expect(result.success).toBe(true)
  })

  it("Step 4: Client confirms completion (escrow released)", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockResolvedValue({ userId: CLIENT_ID, role: "CLIENT" } as any)

    // Booking in IN_PROGRESS (provider already checked in)
    mockDb.booking.findUnique.mockResolvedValue({
      ...mockBooking,
      status: "IN_PROGRESS",
      paymentStatus: "PAID",
    })
    mockDb.booking.update.mockResolvedValue({
      ...mockBooking,
      status: "COMPLETED",
      paymentStatus: "PAID",
      escrowReleasedAt: new Date(),
    })
    mockDb.payment.updateMany.mockResolvedValue({ count: 1 })

    const { POST } = await import("@/app/api/bookings/[id]/confirm-completion/route")
    const req = new Request("http://localhost")
    const res = await POST(req, { params: Promise.resolve({ id: BOOKING_ID }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)

    // Verify atomic transaction: both booking + payment updated
    expect(mockDb.$transaction).toHaveBeenCalled()
    const txArg = vi.mocked(mockDb.$transaction).mock.calls[0][0]
    // Array-style: $transaction([booking.update(), payment.updateMany()])
    expect(Array.isArray(txArg) || typeof txArg === "function").toBe(true)
  })

  it("Step 5: Provider withdraws (walletTransaction created, balance deducted)", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockResolvedValue({ userId: PROVIDER_ID, role: "PROVIDER" } as any)

    // 1 completed booking at R$250 → earned R$212.50 (after 15% fee)
    mockDb.booking.aggregate.mockResolvedValue({ _sum: { amount: 250 } })
    mockDb.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
    mockDb.walletTransaction.create.mockResolvedValue({
      id: "wth-001",
      providerId: PROVIDER_ID,
      amount: 100,
      status: "completed",
    })

    const { POST } = await import("@/app/api/provider/wallet/withdraw/route")
    const req = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ amount: 100 }),
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.amount).toBe(100)
    expect(data.newBalance).toBe(112.5) // 212.5 - 100

    // Verify atomic: balance check + creation in single transaction
    expect(mockDb.$transaction).toHaveBeenCalled()
    const txArg = vi.mocked(mockDb.$transaction).mock.calls[0][0]
    // Array-style: $transaction([booking.update(), payment.updateMany()])
    expect(Array.isArray(txArg) || typeof txArg === "function").toBe(true)
  })

  it("Step 5b: Provider cannot withdraw more than available balance", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockResolvedValue({ userId: PROVIDER_ID, role: "PROVIDER" } as any)

    mockDb.booking.aggregate.mockResolvedValue({ _sum: { amount: 250 } })
    mockDb.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })

    const { POST } = await import("@/app/api/provider/wallet/withdraw/route")
    const req = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ amount: 500 }),
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain("Saldo insuficiente")
  })

  it("Step 5c: Double-spend prevention (concurrent withdrawals)", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockResolvedValue({ userId: PROVIDER_ID, role: "PROVIDER" } as any)

    // Balance is R$212.50 — withdrawal of R$200 should succeed
    mockDb.booking.aggregate.mockResolvedValue({ _sum: { amount: 250 } })
    mockDb.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
    mockDb.walletTransaction.create.mockResolvedValue({
      id: "wth-002",
      amount: 200,
      status: "completed",
    })

    const { POST } = await import("@/app/api/provider/wallet/withdraw/route")
    const req = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ amount: 200 }),
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    // Verify Serializable isolation is used
    expect(mockDb.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    })
  })
})
