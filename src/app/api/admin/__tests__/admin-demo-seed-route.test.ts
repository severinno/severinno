import { describe, it, expect, vi, beforeEach } from "vitest"
import { POST } from "@/app/api/admin/demo/seed/route"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { createMockRequest } from "@/lib/__tests__/helpers/api-test-utils"

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      upsert: vi.fn().mockImplementation(async ({ create }) => ({ id: "mock-user-id", ...create })),
    },
    category: {
      findFirst: vi.fn().mockResolvedValue({ id: "mock-cat-id", name: "Elétrica" }),
    },
    service: {
      upsert: vi.fn().mockImplementation(async ({ create }) => ({ id: "mock-srv-id", ...create })),
    },
    booking: {
      upsert: vi.fn().mockImplementation(async ({ create }) => ({ id: "mock-book-id", ...create })),
    },
    dispute: {
      upsert: vi.fn().mockImplementation(async ({ create }) => ({ id: "mock-disp-id", ...create })),
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

vi.mock("@/lib/redis", () => ({
  cacheInvalidate: vi.fn().mockResolvedValue(true),
}))

describe("POST /api/admin/demo/seed", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any)
  })

  it("exige role ADMIN", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"))

    const req = createMockRequest({ method: "POST" })
    const res = await POST(req)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it("injeta cenário de investidores com prestadores, agendamentos e escrow em GV", async () => {
    const req = createMockRequest({ method: "POST" })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.city).toBe("Governador Valadares (MG)")
    expect(json.bookingsSummary.inProgress).toBe(1)
    expect(json.bookingsSummary.readyEscrowRelease).toBe(1)
    expect(db.user.upsert).toHaveBeenCalled()
    expect(db.booking.upsert).toHaveBeenCalled()
  })
})
