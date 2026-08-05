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
    createdAt: new Date("2025-01-20"),
    service: { title: "Pintura parede" },
    client: { name: "João Santos" },
  },
  {
    id: "booking-3",
    amount: 150,
    status: "CONFIRMED",
    paymentStatus: "PAID",
    createdAt: new Date("2025-02-01"),
    service: { title: "Reparo elétrico" },
    client: { name: "Ana Costa" },
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

import { GET } from "../provider/wallet/history/route"

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/provider/wallet/history", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns paginated transactions with default page/limit", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/provider/wallet/history")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.items).toHaveLength(3) // all 3 within default limit 20
    expect(data.total).toBe(3)
    expect(data.page).toBe(1)
    expect(data.limit).toBe(20)
    expect(data.hasMore).toBe(false)
  })

  it("respects page and limit parameters", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/provider/wallet/history?page=1&limit=2")
    const res = await GET(req)
    const data = await res.json()

    expect(data.items).toHaveLength(2)
    expect(data.total).toBe(3)
    expect(data.page).toBe(1)
    expect(data.limit).toBe(2)
    expect(data.hasMore).toBe(true) // 2 of 3 shown, more available
  })

  it("returns second page correctly", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/provider/wallet/history?page=2&limit=2")
    const res = await GET(req)
    const data = await res.json()

    expect(data.items).toHaveLength(1) // 3 total, 2 on page 1, 1 on page 2
    expect(data.total).toBe(3)
    expect(data.page).toBe(2)
    expect(data.hasMore).toBe(false)
  })

  it("includes withdrawal transactions in the history", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([
      {
        id: "wth-1",
        amount: 100,
        description: "Saque de R$ 100,00",
        createdAt: new Date("2025-03-01"),
        status: "completed",
      },
    ])

    const req = new Request("http://localhost/api/provider/wallet/history")
    const res = await GET(req)
    const data = await res.json()

    // 3 booking transactions + 1 withdrawal = 4 total
    expect(data.total).toBe(4)

    const withdrawnTx = data.items.find((t: { status: string }) => t.status === "withdrawn")
    expect(withdrawnTx).toBeDefined()
    expect(withdrawnTx.amount).toBe(100)
    expect(withdrawnTx.clientName).toBe("—")
  })

  it("returns empty items when there is no data", async () => {
    mockDb.booking.findMany.mockResolvedValue([])
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/provider/wallet/history")
    const res = await GET(req)
    const data = await res.json()

    expect(data.items).toHaveLength(0)
    expect(data.total).toBe(0)
    expect(data.hasMore).toBe(false)
  })

  it("filters by type=paid returning only completed bookings", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/provider/wallet/history?type=paid")
    const res = await GET(req)
    const data = await res.json()

    // Only booking-1 and booking-2 are COMPLETED → status "paid"
    // booking-3 is CONFIRMED → status "pending"
    expect(data.total).toBe(2)
    expect(data.items).toHaveLength(2)
    expect(data.items.every((t: { status: string }) => t.status === "paid")).toBe(true)
  })

  it("filters by type=pending returning only CONFIRMED bookings", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/provider/wallet/history?type=pending")
    const res = await GET(req)
    const data = await res.json()

    expect(data.total).toBe(1)
    expect(data.items).toHaveLength(1)
    expect(data.items[0].status).toBe("pending")
  })

  it("filters by type=withdrawn returning only withdrawal transactions", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([
      {
        id: "wth-1",
        amount: 100,
        description: "Saque de R$ 100,00",
        createdAt: new Date("2025-03-01"),
        status: "completed",
      },
    ])

    const req = new Request("http://localhost/api/provider/wallet/history?type=withdrawn")
    const res = await GET(req)
    const data = await res.json()

    expect(data.total).toBe(1)
    expect(data.items).toHaveLength(1)
    expect(data.items[0].status).toBe("withdrawn")
  })

  it("returns all transactions when type filter is invalid", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/provider/wallet/history?type=invalid")
    const res = await GET(req)
    const data = await res.json()

    expect(data.total).toBe(3) // all 3 returned
  })

  it("filters by date range (dateStart only)", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    // Only bookings on or after 2025-01-20
    const req = new Request("http://localhost/api/provider/wallet/history?dateStart=2025-01-20")
    const res = await GET(req)
    const data = await res.json()

    // booking-1 is 2025-01-15 → excluded, booking-2 is 2025-01-20 → included
    // booking-3 is 2025-02-01 → included
    expect(data.total).toBe(2)
    expect(
      data.items.find((t: { description: string }) => t.description.includes("Limpeza")),
    ).toBeUndefined()
    expect(
      data.items.find((t: { description: string }) => t.description.includes("Pintura")),
    ).toBeDefined()
    expect(
      data.items.find((t: { description: string }) => t.description.includes("Reparo")),
    ).toBeDefined()
  })

  it("filters by date range (dateEnd only)", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    // Only bookings on or before 2025-01-20
    const req = new Request("http://localhost/api/provider/wallet/history?dateEnd=2025-01-20")
    const res = await GET(req)
    const data = await res.json()

    expect(data.total).toBe(2)
    expect(
      data.items.find((t: { description: string }) => t.description.includes("Limpeza")),
    ).toBeDefined()
    expect(
      data.items.find((t: { description: string }) => t.description.includes("Pintura")),
    ).toBeDefined()
    expect(
      data.items.find((t: { description: string }) => t.description.includes("Reparo")),
    ).toBeUndefined()
  })

  it("filters by full date range", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)
    mockDb.walletTransaction.findMany.mockResolvedValue([])

    // Only bookings between 2025-01-20 and 2025-01-31
    const req = new Request(
      "http://localhost/api/provider/wallet/history?dateStart=2025-01-20&dateEnd=2025-01-31",
    )
    const res = await GET(req)
    const data = await res.json()

    expect(data.total).toBe(1)
    expect(data.items[0].description).toContain("Pintura")
  })

  it("throws 401 when not authenticated", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const req = new Request("http://localhost/api/provider/wallet/history")
    const res = await GET(req)

    expect(res.status).toBe(401)
  })
})
