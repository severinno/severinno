import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "@/app/api/admin/badges/route"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { createMockRequest } from "@/lib/__tests__/helpers/api-test-utils"

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      count: vi.fn(),
    },
    user: {
      count: vi.fn(),
    },
    dispute: {
      count: vi.fn(),
    },
    service: {
      count: vi.fn(),
    },
    category: {
      count: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { admin: { prefix: "admin", max: 30, windowMs: 60000 } },
}))

describe("GET /api/admin/badges", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any)
  })

  it("exige role ADMIN", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"))

    const req = createMockRequest()
    const res = await GET(req)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it("retorna contadores dinâmicos para o menu lateral", async () => {
    vi.mocked(db.booking.count).mockResolvedValueOnce(7)
    vi.mocked(db.user.count).mockResolvedValueOnce(3) // KYC
    vi.mocked(db.dispute.count).mockResolvedValueOnce(1)
    vi.mocked(db.service.count).mockResolvedValueOnce(42)
    vi.mocked(db.category.count).mockResolvedValueOnce(129)
    vi.mocked(db.user.count).mockResolvedValueOnce(15) // Providers

    const req = createMockRequest()
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({
      activeBookings: 7,
      pendingKyc: 3,
      openDisputes: 1,
      services: 42,
      taxonomy: 129,
      verifiedProviders: 15,
    })
  })
})
