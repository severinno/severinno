import { describe, it, expect, vi, beforeEach } from "vitest"
import { POST } from "@/app/api/admin/taxonomy/sync/route"
import { requireRole } from "@/lib/auth"
import { createMockRequest } from "@/lib/__tests__/helpers/api-test-utils"

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    category: {
      upsert: vi.fn(),
    },
  },
}))

vi.mock("@/lib/db", () => ({
  db: mockDb,
}))

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn(),
  RATE_LIMITS: { admin: { prefix: "admin", max: 30, windowMs: 60000 } },
}))

vi.mock("@/lib/redis", () => ({
  cacheInvalidate: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/api-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-server")>()
  return {
    ...actual,
    invalidateCategoryCache: vi.fn().mockResolvedValue(true),
  }
})

describe("POST /api/admin/taxonomy/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any)
    vi.mocked(mockDb.category.upsert).mockImplementation(async ({ where, create }) => ({
      id: `cat-${where.slug}`,
      ...create,
    }))
  })

  it("exige role ADMIN", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"))

    const req = createMockRequest({ method: "POST" })
    const res = await POST(req)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it("sincroniza com sucesso as 129 categorias canônicas", async () => {
    const req = createMockRequest({ method: "POST" })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.total).toBe(129)
    expect(json.roots).toBe(7)
    expect(json.subcategories).toBe(36)
    expect(json.specialties).toBe(86)
    expect(mockDb.category.upsert).toHaveBeenCalledTimes(129)
  })
})
