/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  booking: {
    findMany: vi.fn(),
  },
  walletTransaction: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "provider-1" }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
    mockDb.booking.findMany.mockResolvedValue([{ amount: 200 }, { amount: 350 }])
    mockDb.walletTransaction.findMany.mockResolvedValue([])
    mockDb.walletTransaction.create.mockResolvedValue({
      id: "wth-new-1",
      amount: 100,
      status: "completed",
      description: "Saque simulado de R$ 100.00",
    })

    const res = await POST(mockRequest({ amount: 100 }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.amount).toBe(100)
    expect(data.newBalance).toBe(367.5) // 467.5 - 100
    expect(data.message).toContain("Saque de R$ 100")
  })

  it("rejects withdrawal exceeding available balance", async () => {
    mockDb.booking.findMany.mockResolvedValue([{ amount: 200 }])
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const res = await POST(mockRequest({ amount: 999 }))
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain("Saldo insuficiente")
  })

  it("rejects negative amount", async () => {
    const res = await POST(mockRequest({ amount: -50 }))
    expect(res.status).toBe(400)
  })

  it("rejects zero amount", async () => {
    const res = await POST(mockRequest({ amount: 0 }))
    expect(res.status).toBe(400)
  })

  it("rejects amount below minimum (R$ 10)", async () => {
    const res = await POST(mockRequest({ amount: 5 }))
    expect(res.status).toBe(400)
    expect(await res.json()).toHaveProperty("error")
  })

  it("rejects amount above maximum (R$ 50.000)", async () => {
    const res = await POST(mockRequest({ amount: 60000 }))
    expect(res.status).toBe(400)
    expect(await res.json()).toHaveProperty("error")
  })

  it("rejects non-numeric amount", async () => {
    const res = await POST(mockRequest({ amount: "abc" }))
    expect(res.status).toBe(400)
  })

  it("rejects missing amount", async () => {
    const res = await POST(mockRequest({}))
    expect(res.status).toBe(400)
  })

  it("subtracts from balance considering previous withdrawals", async () => {
    // Balance from bookings: 200 * 0.85 = 170
    mockDb.booking.findMany.mockResolvedValue([{ amount: 200 }])
    // Already withdrew 50
    mockDb.walletTransaction.findMany.mockResolvedValue([{ amount: 50, status: "completed" }])
    mockDb.walletTransaction.create.mockResolvedValue({
      id: "wth-new-2",
      amount: 30,
      status: "completed",
      description: "Saque simulado de R$ 30.00",
    })

    const res = await POST(mockRequest({ amount: 30 }))
    const data = await res.json()

    expect(res.status).toBe(200)
    // Available: 170 - 50 = 120, withdraw 30 → new balance 90
    expect(data.newBalance).toBe(90)
  })

  it("throws 401 when user is not authenticated", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await POST(mockRequest({ amount: 100 }))
    expect(res.status).toBe(401)
  })
})
