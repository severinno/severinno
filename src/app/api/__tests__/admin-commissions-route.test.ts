import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  booking: {
    aggregate: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

let _mockRole: string | null = null

import { makeAuthError } from "@/lib/__tests__/helpers/auth-mock"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (role: string) => {
    if (_mockRole !== role) throw makeAuthError("FORBIDDEN")
  }),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { admin: { prefix: "admin", max: 30, windowMs: 60000 } },
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from "../admin/commissions/route"

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/admin/commissions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockRole = "ADMIN"

    mockDb.booking.aggregate.mockResolvedValue({
      _sum: { amount: 3800 },
      _count: { id: 4 },
    })
    mockDb.booking.count.mockResolvedValue(3)
    // $queryRaw: monthly breakdown (raw SQL)
    mockDb.$queryRaw.mockResolvedValue([
      { month: "2025-01", gross: BigInt(1000), count: BigInt(1) },
      { month: "2025-02", gross: BigInt(2500), count: BigInt(2) },
      { month: "2025-03", gross: BigInt(300), count: BigInt(1) },
    ])
    // 2x groupBy: per-provider + completed by provider
    mockDb.booking.groupBy
      .mockResolvedValueOnce([
        {
          providerId: "prov-2",
          _sum: { amount: 2000 },
          _count: { id: 1 },
        },
        {
          providerId: "prov-1",
          _sum: { amount: 1800 },
          _count: { id: 3 },
        },
      ])
      .mockResolvedValueOnce([
        { providerId: "prov-1", _count: { id: 2 } },
        { providerId: "prov-2", _count: { id: 1 } },
      ])

    mockDb.user.findMany.mockResolvedValue([
      { id: "prov-1", name: "João Prestador", avatarUrl: null },
      { id: "prov-2", name: "Maria Profissional", avatarUrl: "https://example.com/avatar.jpg" },
    ])
  })

  it("returns correct aggregated totals", async () => {
    const req = new Request("http://localhost/api/admin/commissions?year=2025")
    const res = await GET(req)
    const data = await res.json()

    expect(data.grossRevenue).toBe(3800)
    expect(data.platformCommission).toBe(570)
    expect(data.providerEarnings).toBe(3230)
    expect(res.status).toBe(200)
  })

  it("counts total bookings and completed bookings", async () => {
    const req = new Request("http://localhost/api/admin/commissions?year=2025")
    const res = await GET(req)
    const data = await res.json()

    expect(data.bookingCount).toBe(4)
    expect(data.completedCount).toBe(3)
  })

  it("returns per-provider breakdown sorted by gross revenue", async () => {
    const req = new Request("http://localhost/api/admin/commissions?year=2025")
    const res = await GET(req)
    const data = await res.json()

    expect(data.providers).toHaveLength(2)

    expect(data.providers[0].name).toBe("Maria Profissional")
    expect(data.providers[0].grossRevenue).toBe(2000)
    expect(data.providers[0].commission).toBe(300)
    expect(data.providers[0].netEarnings).toBe(1700)
    expect(data.providers[0].bookingCount).toBe(1)
    expect(data.providers[0].completedCount).toBe(1)

    expect(data.providers[1].name).toBe("João Prestador")
    expect(data.providers[1].grossRevenue).toBe(1800)
    expect(data.providers[1].commission).toBe(270)
    expect(data.providers[1].netEarnings).toBe(1530)
    expect(data.providers[1].bookingCount).toBe(3)
    expect(data.providers[1].completedCount).toBe(2)
  })

  it("returns empty state when no bookings exist", async () => {
    mockDb.booking.aggregate.mockResolvedValue({
      _sum: { amount: null },
      _count: { id: 0 },
    })
    mockDb.booking.count.mockResolvedValue(0)
    mockDb.$queryRaw.mockResolvedValue([])
    mockDb.booking.groupBy.mockReset()
    mockDb.booking.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    mockDb.user.findMany.mockResolvedValue([])

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

    const req = new Request("http://localhost/api/admin/commissions?year=2025")
    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})
