/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * Tests for src/lib/wallet.ts
 *
 * Pure unit tests — `db` is mocked via vi.hoisted() so these tests run
 * fast and deterministically without a database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => ({
  booking: { findMany: vi.fn() },
  walletTransaction: { findMany: vi.fn() },
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  computeBaseBalance,
  computeAvailableBalance,
  getWithdrawals,
  buildWallet,
  FEE_RATE,
} from "../wallet"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_ID = "provider-1"

// ---------------------------------------------------------------------------
// FEE_RATE
// ---------------------------------------------------------------------------

describe("FEE_RATE", () => {
  it("is 0.15 (15%)", () => {
    expect(FEE_RATE).toBe(0.15)
  })
})

// ---------------------------------------------------------------------------
// computeBaseBalance
// ---------------------------------------------------------------------------

describe("computeBaseBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("sums COMPLETED bookings into balance with fee deduction", async () => {
    mockDb.booking.findMany.mockResolvedValue([
      {
        id: "b1",
        amount: 200,
        status: "COMPLETED",
        paymentStatus: "PAID",
        createdAt: new Date("2025-01-15"),
        service: { title: "Limpeza" },
        client: { name: "Maria" },
      },
      {
        id: "b2",
        amount: 350,
        status: "COMPLETED",
        paymentStatus: "PAID",
        createdAt: new Date("2025-02-10"),
        service: { title: "Pintura" },
        client: { name: "João" },
      },
    ])

    const result = await computeBaseBalance(PROVIDER_ID)

    // Balance: (200 + 350) * 0.85 = 467.5
    expect(result.balance).toBe(467.5)
    expect(result.totalReceived).toBe(550)
    expect(result.completedCount).toBe(2)
  })

  it("separates CONFIRMED/IN_PROGRESS into pendingBalance", async () => {
    mockDb.booking.findMany.mockResolvedValue([
      {
        id: "b3",
        amount: 150,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        createdAt: new Date("2025-03-01"),
        service: { title: "Reparo" },
        client: { name: "Ana" },
      },
      {
        id: "b4",
        amount: 100,
        status: "IN_PROGRESS",
        paymentStatus: "PAID",
        createdAt: new Date("2025-03-05"),
        service: { title: "Desentupimento" },
        client: { name: "Carlos" },
      },
    ])

    const result = await computeBaseBalance(PROVIDER_ID)

    // (150 + 100) * 0.85 = 212.5
    expect(result.pendingBalance).toBe(212.5)
    expect(result.balance).toBe(0)
    expect(result.completedCount).toBe(0)
  })

  it("excludes PENDING payment status bookings entirely", async () => {
    mockDb.booking.findMany.mockResolvedValue([
      {
        id: "b5",
        amount: 500,
        status: "PENDING",
        paymentStatus: "PENDING",
        createdAt: new Date("2025-03-10"),
        service: { title: "Reforma" },
        client: { name: "Patrícia" },
      },
    ])

    const result = await computeBaseBalance(PROVIDER_ID)

    expect(result.balance).toBe(0)
    expect(result.pendingBalance).toBe(0)
    expect(result.totalReceived).toBe(0)
    expect(result.transactions).toHaveLength(0)
  })

  it("returns zero for empty bookings", async () => {
    mockDb.booking.findMany.mockResolvedValue([])

    const result = await computeBaseBalance(PROVIDER_ID)

    expect(result.balance).toBe(0)
    expect(result.pendingBalance).toBe(0)
    expect(result.totalReceived).toBe(0)
    expect(result.completedCount).toBe(0)
    expect(result.transactions).toHaveLength(0)
  })

  it("generates transactions with correct fee and netAmount", async () => {
    mockDb.booking.findMany.mockResolvedValue([
      {
        id: "b1",
        amount: 200,
        status: "COMPLETED",
        paymentStatus: "PAID",
        createdAt: new Date("2025-01-15"),
        service: { title: "Limpeza" },
        client: { name: "Maria Silva" },
      },
    ])

    const result = await computeBaseBalance(PROVIDER_ID)

    expect(result.transactions).toHaveLength(1)
    const tx = result.transactions[0]
    expect(tx.amount).toBe(200)
    expect(tx.fee).toBe(30) // 200 * 0.15
    expect(tx.netAmount).toBe(170) // 200 - 30
    expect(tx.status).toBe("paid")
    expect(tx.clientName).toBe("Maria Silva")
    expect(tx.description).toBe("Limpeza")
  })
})

// ---------------------------------------------------------------------------
// computeAvailableBalance
// ---------------------------------------------------------------------------

describe("computeAvailableBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns earned amount minus fee for COMPLETED bookings", async () => {
    mockDb.booking.findMany.mockResolvedValue([{ amount: 200 }, { amount: 350 }])
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const balance = await computeAvailableBalance(PROVIDER_ID)

    // (200 + 350) * 0.85 = 467.5
    expect(balance).toBe(467.5)
  })

  it("subtracts previous withdrawals", async () => {
    mockDb.booking.findMany.mockResolvedValue([{ amount: 200 }])
    mockDb.walletTransaction.findMany.mockResolvedValue([
      { amount: 50, status: "completed" },
      { amount: 30, status: "completed" },
    ])

    const balance = await computeAvailableBalance(PROVIDER_ID)

    // 200 * 0.85 = 170 - 50 - 30 = 90
    expect(balance).toBe(90)
  })

  it("returns 0 when balance is negative (over-withdrawn)", async () => {
    mockDb.booking.findMany.mockResolvedValue([{ amount: 100 }]) // 100 * 0.85 = 85
    mockDb.walletTransaction.findMany.mockResolvedValue([{ amount: 200, status: "completed" }])

    const balance = await computeAvailableBalance(PROVIDER_ID)

    expect(balance).toBe(0) // capped at 0
  })

  it("returns 0 when no bookings exist", async () => {
    mockDb.booking.findMany.mockResolvedValue([])
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const balance = await computeAvailableBalance(PROVIDER_ID)

    expect(balance).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getWithdrawals
// ---------------------------------------------------------------------------

describe("getWithdrawals", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns total withdrawn and transactions from completed withdrawals", async () => {
    mockDb.walletTransaction.findMany.mockResolvedValue([
      { id: "w1", amount: 100, description: "Saque 1", createdAt: new Date("2025-03-01") },
      { id: "w2", amount: 50, description: "Saque 2", createdAt: new Date("2025-03-15") },
    ])

    const result = await getWithdrawals(PROVIDER_ID)

    expect(result.totalWithdrawn).toBe(150)
    expect(result.withdrawalTxns).toHaveLength(2)
    expect(result.withdrawalTxns[0].status).toBe("withdrawn")
    expect(result.withdrawalTxns[0].amount).toBe(100)
  })

  it("returns zero when no withdrawals", async () => {
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const result = await getWithdrawals(PROVIDER_ID)

    expect(result.totalWithdrawn).toBe(0)
    expect(result.withdrawalTxns).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// buildWallet
// ---------------------------------------------------------------------------

describe("buildWallet", () => {
  it("builds a complete SimulatedWallet from base + withdrawals", () => {
    const base = {
      balance: 467.5,
      pendingBalance: 212.5,
      totalReceived: 800,
      completedCount: 2,
      completedSum: 550,
      transactions: [
        {
          id: "TXN-B1",
          bookingId: "b1",
          amount: 200,
          fee: 30,
          netAmount: 170,
          status: "paid" as const,
          description: "Limpeza",
          clientName: "Maria",
          date: "2025-01-15",
        },
      ],
    }

    const withdrawals = {
      totalWithdrawn: 100,
      withdrawalTxns: [
        {
          id: "WTH-1",
          bookingId: "",
          amount: 100,
          fee: 0,
          netAmount: 100,
          status: "withdrawn" as const,
          description: "Saque",
          clientName: "—",
          date: "2025-03-01",
        },
      ],
    }

    const wallet = buildWallet(base, withdrawals)

    expect(wallet.balance).toBe(367.5) // 467.5 - 100
    expect(wallet.pendingBalance).toBe(212.5)
    expect(wallet.totalReceived).toBe(800)
    expect(wallet.totalBookings).toBe(2)
    expect(wallet.avgTicket).toBe(275) // 550 / 2
    expect(wallet.totalWithdrawn).toBe(100)
    expect(wallet.transactions).toHaveLength(2) // base + withdrawal
    // Most recent first
    expect(wallet.transactions[0].status).toBe("withdrawn")
    expect(wallet.transactions[1].status).toBe("paid")
  })

  it("handles empty base (no bookings)", () => {
    const base = {
      balance: 0,
      pendingBalance: 0,
      totalReceived: 0,
      completedCount: 0,
      completedSum: 0,
      transactions: [],
    }
    const withdrawals = { totalWithdrawn: 0, withdrawalTxns: [] }

    const wallet = buildWallet(base, withdrawals)

    expect(wallet.balance).toBe(0)
    expect(wallet.avgTicket).toBe(0)
    expect(wallet.transactions).toHaveLength(0)
  })
})
