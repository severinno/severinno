import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDb = vi.hoisted(() => {
  const db = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    service: { findUnique: vi.fn() },
    booking: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    payment: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    walletTransaction: { findMany: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
    resetToken: { updateMany: vi.fn(), create: vi.fn() },
    pushSubscription: { upsert: vi.fn() },
    notification: { create: vi.fn() },
    // webhook lytex importa @/lib/idempotency (lib real) — model precisa
    // existir E resolver promise (a lib encadeia .catch no update)
    idempotencyRecord: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn() as ReturnType<typeof vi.fn>,
  }
  db.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return await arg(db)
    const results: unknown[] = []
    for (const item of arg as unknown[]) results.push(await Promise.resolve(item))
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
  RATE_LIMITS: new Proxy({}, { get: () => ({ prefix: "t", max: 10000, windowMs: 60000 }) }),
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
  withCache: vi.fn(async (_k: string, fn: () => Promise<unknown>) => fn()),
}))
vi.mock("@/lib/validators", () => ({
  bookingSchema: { parse: (v: unknown) => v },
  loginSchema: { parse: (v: unknown) => v },
  registerSchema: { parse: (v: unknown) => v },
  messageSchema: { parse: (v: unknown) => v },
}))
vi.mock("@/lib/demo-accounts", () => ({
  isDemoAccountsEnabled: vi.fn().mockReturnValue(false),
  isDemoAccountEmail: vi.fn().mockReturnValue(false),
}))
vi.mock("@/lib/crypto", () => ({
  hashPassword: vi.fn().mockReturnValue("hash"),
  verifyPassword: vi.fn().mockReturnValue(true),
}))
vi.mock("@/lib/mail", () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  passwordResetHtml: vi.fn().mockReturnValue(""),
  passwordChangedHtml: vi.fn().mockReturnValue(""),
}))
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }))
vi.mock("@/lib/event-hub", () => ({ fireEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/lytex", () => ({
  verifyWebhookSignature: vi.fn().mockReturnValue(true),
  parseExternalReference: vi.fn((ref: string) => {
    const m = ref?.match(/^booking:(.+)$/)
    return m ? { type: "booking", id: m[1] } : null
  }),
  lytexLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock("@/lib/realtime-client", () => ({ emitRealtime: vi.fn().mockResolvedValue(undefined) }))

describe("Full Financial Flow E2E", () => {
  beforeEach(() => vi.clearAllMocks())

  it("Complete lifecycle: booking → Lytex paid → completion → withdrawal", async () => {
    // Step 1: Create booking
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockResolvedValue({ userId: "c1", role: "CLIENT" } as any)
    mockDb.service.findUnique.mockResolvedValue({
      id: "s1",
      providerId: "p1",
      title: "Limpeza",
      basePrice: 250,
      active: true,
      provider: { id: "p1", verified: true, active: true },
    })
    mockDb.booking.create.mockResolvedValue({
      id: "b1",
      status: "PENDING",
      paymentStatus: "PENDING",
      amount: 250,
      service: { title: "Limpeza" },
      provider: { id: "p1", name: "Prov" },
      client: { id: "c1", name: "Cli" },
      payment: { id: "pay1", status: "PENDING", amount: 250 },
    })

    const { POST: createBooking } = await import("@/app/api/bookings/route")
    const r1 = await createBooking(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          providerId: "p1",
          serviceId: "s1",
          scheduledAt: "2030-05-01T10:00:00Z",
          address: "Rua A",
          cep: "01000-000",
          lat: -23.55,
          lng: -46.63,
          amount: 250,
          paymentMethod: "PIX",
        }),
      }),
    )
    expect((await r1.json()).booking.status).toBe("PENDING")

    // Step 2: Lytex webhook confirms payment
    mockDb.booking.findUnique.mockResolvedValue({
      id: "b1",
      paymentStatus: "PENDING",
      payment: { id: "pay1", status: "PENDING" },
    })
    const { POST: lytexWebhook } = await import("@/app/api/webhooks/lytex/route")
    const r2 = await lytexWebhook(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          id: "lytex-1",
          status: "paid",
          externalReference: "booking:b1",
          paidAt: new Date().toISOString(),
        }),
      }),
    )
    expect((await r2.json()).received).toBe(true)

    // Step 3: Confirm completion (atomic transaction)
    vi.mocked(requireUser).mockResolvedValue({ userId: "c1", role: "CLIENT" } as any)
    mockDb.booking.findUnique.mockResolvedValue({
      id: "b1",
      clientId: "c1",
      status: "IN_PROGRESS",
      paymentStatus: "PAID",
      provider: { id: "p1", name: "Prov" },
      service: { title: "Limpeza" },
    })
    mockDb.booking.update.mockResolvedValue({ id: "b1", status: "COMPLETED" })
    mockDb.payment.updateMany.mockResolvedValue({ count: 1 })

    const { POST: confirm } = await import("@/app/api/bookings/[id]/confirm-completion/route")
    const r3 = await confirm(new Request("http://localhost"), {
      params: Promise.resolve({ id: "b1" }),
    })
    expect((await r3.json()).ok).toBe(true)
    expect(mockDb.$transaction).toHaveBeenCalled()

    // Step 4: Provider withdraws (serializable tx)
    vi.mocked(requireUser).mockResolvedValue({ userId: "p1", role: "PROVIDER" } as any)
    mockDb.booking.aggregate.mockResolvedValue({ _sum: { amount: 250 } })
    mockDb.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
    mockDb.walletTransaction.create.mockResolvedValue({
      id: "w1",
      amount: 100,
      status: "completed",
    })

    const { POST: withdraw } = await import("@/app/api/provider/wallet/withdraw/route")
    const r4 = await withdraw(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ amount: 100 }) }),
    )
    const d4 = await r4.json()
    expect(d4.amount).toBe(100)
    expect(d4.newBalance).toBe(112.5)
    expect(mockDb.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    })
  })
})
