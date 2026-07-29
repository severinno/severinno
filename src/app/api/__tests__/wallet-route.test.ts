import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockBookings = vi.hoisted(() => [
  {
    id: "booking-1",
    amount: 200,
    status: "COMPLETED",
    paymentStatus: "PAID",
    createdAt: new Date("2025-01-15"),
    service: { title: "Limpeza completa" },
    client: { name: "Maria Silva" },
  },
  {
    id: "booking-2",
    amount: 350,
    status: "COMPLETED",
    paymentStatus: "PAID",
    createdAt: new Date("2025-02-10"),
    service: { title: "Pintura parede" },
    client: { name: "João Santos" },
  },
  {
    id: "booking-3",
    amount: 150,
    status: "CONFIRMED",
    paymentStatus: "PAID",
    createdAt: new Date("2025-03-01"),
    service: { title: "Reparo elétrico" },
    client: { name: "Ana Costa" },
  },
  {
    id: "booking-4",
    amount: 100,
    status: "IN_PROGRESS",
    paymentStatus: "PAID",
    createdAt: new Date("2025-03-05"),
    service: { title: "Desentupimento" },
    client: { name: "Carlos Lima" },
  },
  {
    id: "booking-5",
    amount: 500,
    status: "PENDING",
    paymentStatus: "PENDING",
    createdAt: new Date("2025-03-10"),
    service: { title: "Reforma banheiro" },
    client: { name: "Patrícia Souza" },
  },
])

const mockDb = vi.hoisted(() => ({
  booking: {
    findMany: vi.fn(),
  },
  walletTransaction: {
    findMany: vi.fn(),
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

import { GET } from "../provider/wallet/route"

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/provider/wallet", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns simulated wallet with correct balance from COMPLETED bookings", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const res = await GET(new Request("http://localhost/api/provider/wallet"))
    const data = await res.json()

    // booking-1 (200) + booking-2 (350) = 550 total COMPLETED
    // Fee: 15% → 550 * 0.85 = 467.5
    expect(data.balance).toBe(467.5)
    expect(data.totalWithdrawn).toBe(0)
    expect(res.status).toBe(200)
  })

  it("includes pending balance from CONFIRMED and IN_PROGRESS bookings", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const res = await GET(new Request("http://localhost/api/provider/wallet"))
    const data = await res.json()

    // booking-3 (150) + booking-4 (100) = 250 * 0.85 = 212.5
    expect(data.pendingBalance).toBe(212.5)
  })

  it("includes total received (all PAID bookings before fee)", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const res = await GET(new Request("http://localhost/api/provider/wallet"))
    const data = await res.json()

    // booking-1 (200) + booking-2 (350) + booking-3 (150) + booking-4 (100) = 800
    expect(data.totalReceived).toBe(800)
  })

  it("counts only COMPLETED bookings in totalBookings", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const res = await GET(new Request("http://localhost/api/provider/wallet"))
    const data = await res.json()

    expect(data.totalBookings).toBe(2)
  })

  it("calculates avgTicket from COMPLETED bookings", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const res = await GET(new Request("http://localhost/api/provider/wallet"))
    const data = await res.json()

    // (200 + 350) / 2 = 275
    expect(data.avgTicket).toBe(275)
  })

  it("returns transactions for paid and pending bookings", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const res = await GET(new Request("http://localhost/api/provider/wallet"))
    const data = await res.json()

    // 4 bookings with PAID paymentStatus (COMPLETED + CONFIRMED + IN_PROGRESS)
    expect(data.transactions).toHaveLength(4)

    // Paid transactions (COMPLETED bookings)
    const paidTxns = data.transactions.filter((t: { status: string }) => t.status === "paid")
    expect(paidTxns).toHaveLength(2)
    for (const tx of paidTxns) {
      expect(tx.fee).toBeCloseTo(tx.amount * 0.15, 2)
      expect(tx.netAmount).toBeCloseTo(tx.amount - tx.fee, 2)
    }

    // Pending transactions (CONFIRMED/IN_PROGRESS bookings)
    const pendingTxns = data.transactions.filter((t: { status: string }) => t.status === "pending")
    expect(pendingTxns).toHaveLength(2)
    for (const tx of pendingTxns) {
      expect(tx.fee).toBeCloseTo(tx.amount * 0.15, 2)
      expect(tx.netAmount).toBeCloseTo(tx.amount - tx.fee, 2)
    }
  })

  it("returns 0 values when there are no bookings", async () => {
    mockDb.booking.findMany.mockResolvedValue([])
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const res = await GET(new Request("http://localhost/api/provider/wallet"))
    const data = await res.json()

    expect(data.balance).toBe(0)
    expect(data.pendingBalance).toBe(0)
    expect(data.totalReceived).toBe(0)
    expect(data.totalBookings).toBe(0)
    expect(data.avgTicket).toBe(0)
    expect(data.totalWithdrawn).toBe(0)
    expect(data.transactions).toHaveLength(0)
  })

  it("excludes PENDING paymentStatus bookings from calculations", async () => {
    mockDb.booking.findMany.mockResolvedValue([mockBookings[4]]) // booking-5 is PENDING payment
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const res = await GET(new Request("http://localhost/api/provider/wallet"))
    const data = await res.json()

    expect(data.balance).toBe(0)
    expect(data.pendingBalance).toBe(0)
    expect(data.totalReceived).toBe(0)
    expect(data.transactions).toHaveLength(0)
  })

  it("subtracts withdrawals from balance", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([
      { id: "wth-1", amount: 100, description: "Saque de R$ 100,00", createdAt: new Date("2025-03-15"), status: "completed" },
      { id: "wth-2", amount: 50, description: "Saque de R$ 50,00", createdAt: new Date("2025-03-20"), status: "completed" },
    ])

    const res = await GET(new Request("http://localhost/api/provider/wallet"))
    const data = await res.json()

    // balance was 467.5, minus 150 in withdrawals = 317.5
    expect(data.balance).toBe(317.5)
    expect(data.totalWithdrawn).toBe(150)
    // Should include withdrawal transactions
    const withdrawnTxns = data.transactions.filter((t: { status: string }) => t.status === "withdrawn")
    expect(withdrawnTxns).toHaveLength(2)
  })

  it("does not allow negative balance", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([
      { id: "wth-1", amount: 999999, description: "Saque gigante", createdAt: new Date("2025-03-15"), status: "completed" },
    ])

    const res = await GET(new Request("http://localhost/api/provider/wallet"))
    const data = await res.json()

    // balance capped at 0
    expect(data.balance).toBe(0)
    expect(data.totalWithdrawn).toBe(999999)
  })

  it("throws 401 when user is not authenticated", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockRejectedValueOnce(
      new Error("UNAUTHORIZED"),
    )

    mockDb.booking.findMany.mockResolvedValue([])

    const res = await GET(new Request("http://localhost/api/provider/wallet"))
    expect(res.status).toBe(401)
  })
})
