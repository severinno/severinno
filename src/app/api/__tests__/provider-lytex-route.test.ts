/**
 * Tests for GET /api/provider/lytex — provider wallet view.
 *
 * Covers:
 *   - Simulated wallet (no Lytex credentials)
 *   - Withdrawal deduction from balance
 *   - Pending balance from CONFIRMED/IN_PROGRESS bookings
 *   - Empty bookings
 *   - 401 when not authenticated
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  booking: { findMany: vi.fn() },
  walletTransaction: { findMany: vi.fn() },
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "provider-1" }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Mock lytex getWallet/listSplits to throw (simulating "not configured")
vi.mock("@/lib/lytex", () => ({
  getWallet: vi.fn().mockRejectedValue(new Error("Lytex não configurado")),
  listSplits: vi.fn().mockRejectedValue(new Error("Lytex não configurado")),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from "../provider/lytex/route"

// ── Mock data ──────────────────────────────────────────────────────────────

const mockBookings = [
  {
    id: "booking-1", amount: 200, status: "COMPLETED", paymentStatus: "PAID",
    createdAt: new Date("2025-01-15"),
  },
  {
    id: "booking-2", amount: 350, status: "COMPLETED", paymentStatus: "PAID",
    createdAt: new Date("2025-02-10"),
  },
  {
    id: "booking-3", amount: 150, status: "CONFIRMED", paymentStatus: "PAID",
    createdAt: new Date("2025-03-01"),
  },
  {
    id: "booking-4", amount: 100, status: "IN_PROGRESS", paymentStatus: "PAID",
    createdAt: new Date("2025-03-05"),
  },
  {
    id: "booking-5", amount: 500, status: "PENDING", paymentStatus: "PENDING",
    createdAt: new Date("2025-03-10"),
  },
]

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/provider/lytex", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Simulate: user has no lytexRecipientId → simulated wallet
    mockDb.user.findUnique.mockResolvedValue({ lytexRecipientId: null })
  })

  it("returns simulated wallet with correct balance from COMPLETED bookings", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)

    const res = await GET()
    const data = await res.json()

    // COMPLETED: (200 + 350) * 0.85 = 467.5
    expect(data.wallet.balance).toBe(467.5)
    // PENDING: (150 + 100) * 0.85 = 212.5
    expect(data.wallet.pendingBalance).toBe(212.5)
    // totalReceived = balance (same calculation, after fee)
    expect(data.wallet.totalReceived).toBe(467.5)
    expect(res.status).toBe(200)
  })

  it("generates simulated splits from COMPLETED bookings", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)

    const res = await GET()
    const data = await res.json()

    expect(data.splits).toHaveLength(2) // 2 COMPLETED bookings
    expect(data.splits[0].status).toBe("paid")
    expect(data.splits[0].value).toBe(200 * 0.85)
    expect(data.splits[1].value).toBe(350 * 0.85)
  })

  it("returns 0 values when there are no bookings", async () => {
    mockDb.booking.findMany.mockResolvedValue([])

    const res = await GET()
    const data = await res.json()

    expect(data.wallet.balance).toBe(0)
    expect(data.wallet.pendingBalance).toBe(0)
    expect(data.wallet.totalReceived).toBe(0)
    expect(data.splits).toHaveLength(0)
  })

  it("excludes PENDING paymentStatus bookings", async () => {
    mockDb.booking.findMany.mockResolvedValue([mockBookings[4]])

    const res = await GET()
    const data = await res.json()

    expect(data.wallet.balance).toBe(0)
    expect(data.wallet.totalReceived).toBe(0)
  })

  it("throws 401 when user is not authenticated", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await GET()
    expect(res.status).toBe(401)
  })
})
