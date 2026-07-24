import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  booking: {
    findMany: vi.fn(),
  },
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

let _mockRole: string | null = null

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (role: string) => {
    if (_mockRole !== role) throw new Error("FORBIDDEN")
  }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from "../admin/commissions/route"

// ── Mock data ──────────────────────────────────────────────────────────────

const mockBookings = [
  {
    id: "b-1",
    amount: 1000,
    status: "COMPLETED",
    createdAt: new Date("2025-01-15"),
    provider: { id: "prov-1", name: "João Prestador", avatarUrl: null },
  },
  {
    id: "b-2",
    amount: 500,
    status: "COMPLETED",
    createdAt: new Date("2025-02-10"),
    provider: { id: "prov-1", name: "João Prestador", avatarUrl: null },
  },
  {
    id: "b-3",
    amount: 2000,
    status: "COMPLETED",
    createdAt: new Date("2025-02-20"),
    provider: { id: "prov-2", name: "Maria Profissional", avatarUrl: "https://example.com/avatar.jpg" },
  },
  {
    id: "b-4",
    amount: 300,
    status: "CONFIRMED",
    createdAt: new Date("2025-03-01"),
    provider: { id: "prov-1", name: "João Prestador", avatarUrl: null },
  },
]

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/admin/commissions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockRole = "ADMIN"
  })

  it("returns correct aggregated totals", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)

    const req = new Request("http://localhost/api/admin/commissions?year=2025")
    const res = await GET(req)
    const data = await res.json()

    // grossRevenue = 1000 + 500 + 2000 + 300 = 3800
    expect(data.grossRevenue).toBe(3800)
    expect(data.platformCommission).toBe(570) // 3800 * 0.15
    expect(data.providerEarnings).toBe(3230) // 3800 * 0.85
    expect(res.status).toBe(200)
  })

  it("counts total bookings and completed bookings", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)

    const req = new Request("http://localhost/api/admin/commissions?year=2025")
    const res = await GET(req)
    const data = await res.json()

    expect(data.bookingCount).toBe(4)
    expect(data.completedCount).toBe(3) // b-1, b-2, b-3 are COMPLETED
  })

  it("returns per-provider breakdown sorted by gross revenue", async () => {
    mockDb.booking.findMany.mockResolvedValue(mockBookings)

    const req = new Request("http://localhost/api/admin/commissions?year=2025")
    const res = await GET(req)
    const data = await res.json()

    expect(data.providers).toHaveLength(2)

    // First: prov-2 (Maria) with 2000 > prov-1 (João) with 1500 (1000+500-300... wait 1000+500+300=1800... no, 1000+500+300=1800)
    expect(data.providers[0].name).toBe("Maria Profissional")
    expect(data.providers[0].grossRevenue).toBe(2000)
    expect(data.providers[0].commission).toBe(300) // 2000 * 0.15
    expect(data.providers[0].netEarnings).toBe(1700) // 2000 * 0.85
    expect(data.providers[0].bookingCount).toBe(1)
    expect(data.providers[0].completedCount).toBe(1)

    expect(data.providers[1].name).toBe("João Prestador")
    expect(data.providers[1].grossRevenue).toBe(1800) // 1000 + 500 + 300
    expect(data.providers[1].commission).toBe(270) // 1800 * 0.15
    expect(data.providers[1].netEarnings).toBe(1530) // 1800 * 0.85
    expect(data.providers[1].bookingCount).toBe(3)
    expect(data.providers[1].completedCount).toBe(2)
  })

  it("returns empty state when no bookings exist", async () => {
    mockDb.booking.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/admin/commissions?year=2025")
    const res = await GET(req)
    const data = await res.json()

    expect(data.grossRevenue).toBe(0)
    expect(data.platformCommission).toBe(0)
    expect(data.providerEarnings).toBe(0)
    expect(data.bookingCount).toBe(0)
    expect(data.completedCount).toBe(0)
    expect(data.providers).toHaveLength(0)
    expect(data.monthly).toHaveLength(0)
  })

  it("throws 403 when user is not ADMIN", async () => {
    _mockRole = "PROVIDER"
    mockDb.booking.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/admin/commissions?year=2025")
    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})
