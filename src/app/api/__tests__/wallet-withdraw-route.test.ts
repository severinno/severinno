import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => {
  const db = {
    booking: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    walletTransaction: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn() as ReturnType<typeof vi.fn>,
  }
  // $transaction: execute callback-style or array-style with the mock db as tx
  db.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return await arg(db) // callback-style: $transaction(async (tx) => { ... })
    }
    // array-style: $transaction([promise1, promise2])
    const results: unknown[] = []
    for (const fn of arg as Array<() => Promise<unknown>>) {
      results.push(await fn())
    }
    return results
  })
  return db
})

vi.mock("@/lib/db", () => ({ db: mockDb }))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "provider-1" }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: new Proxy({}, { get: () => ({ prefix: "test", max: 1000, windowMs: 60_000 }) }),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from "../provider/wallet/withdraw/route"

// ── Helpers ────────────────────────────────────────────────────────────────

function mockRequest(body?: unknown): Request {
  return new Request("http://localhost/api/provider/wallet/withdraw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/provider/wallet/withdraw", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates a withdrawal and returns success", async () => {
    // 2 COMPLETED bookings = balance 467.5
    mockDb.booking.aggregate.mockResolvedValue({ _sum: { amount: 550 } })
    mockDb.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
    mockDb.walletTransaction.create.mockResolvedValue({
      id: "wth-new-1",
      amount: 100,
      status: "completed",
      description: "Saque simulado de R$ 100.00",
    })

    const res = await POST(mockRequest({ amount: 100 }), { params: Promise.resolve({}) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.amount).toBe(100)
    expect(data.newBalance).toBe(367.5) // 467.5 - 100
    expect(data.message).toContain("Saque de R$ 100")
  })

  it("rejects withdrawal exceeding available balance", async () => {
    mockDb.booking.aggregate.mockResolvedValue({ _sum: { amount: 200 } })
    mockDb.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })

    const res = await POST(mockRequest({ amount: 999 }), { params: Promise.resolve({}) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain("Saldo insuficiente")
  })

  it("rejects negative amount", async () => {
    const res = await POST(mockRequest({ amount: -50 }), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
  })

  it("rejects zero amount", async () => {
    const res = await POST(mockRequest({ amount: 0 }), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
  })

  it("rejects amount below minimum (R$ 10)", async () => {
    const res = await POST(mockRequest({ amount: 5 }), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    expect(await res.json()).toHaveProperty("error")
  })

  it("rejects amount above maximum (R$ 50.000)", async () => {
    const res = await POST(mockRequest({ amount: 60000 }), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    expect(await res.json()).toHaveProperty("error")
  })

  it("rejects non-numeric amount", async () => {
    const res = await POST(mockRequest({ amount: "abc" }), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
  })

  it("rejects missing amount", async () => {
    const res = await POST(mockRequest({}), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
  })

  it("subtracts from balance considering previous withdrawals", async () => {
    // Balance from bookings: 200 * 0.85 = 170
    mockDb.booking.aggregate.mockResolvedValue({ _sum: { amount: 200 } })
    // Already withdrew 50
    mockDb.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 50 } })
    mockDb.walletTransaction.create.mockResolvedValue({
      id: "wth-new-2",
      amount: 30,
      status: "completed",
      description: "Saque simulado de R$ 30.00",
    })

    const res = await POST(mockRequest({ amount: 30 }), { params: Promise.resolve({}) })
    const data = await res.json()

    expect(res.status).toBe(200)
    // Available: 170 - 50 = 120, withdraw 30 → new balance 90
    expect(data.newBalance).toBe(90)
  })

  it("throws 401 when user is not authenticated", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await POST(mockRequest({ amount: 100 }), { params: Promise.resolve({}) })
    expect(res.status).toBe(401)
  })
})
