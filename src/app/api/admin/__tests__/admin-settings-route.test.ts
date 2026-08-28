import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET, POST } from "@/app/api/admin/settings/route"
import { requireRole } from "@/lib/auth"
import { createMockRequest } from "@/lib/__tests__/helpers/api-test-utils"

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    setting: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
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

vi.mock("@/lib/geo-settings", () => ({
  resetGeoSettingsCache: vi.fn(),
}))

vi.mock("@/app/api/health/route", () => ({
  resetHealthCache: vi.fn(),
}))

describe("GET & POST /api/admin/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any)
  })

  it("lists all system settings", async () => {
    vi.mocked(mockDb.setting.findMany).mockResolvedValue([
      { key: "SITE_NAME", value: "Severinno" } as any,
    ])

    const req = createMockRequest({ method: "GET" })
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.items).toHaveLength(1)
    expect(json.total).toBe(1)
  })

  it("bulk updates settings", async () => {
    vi.mocked(mockDb.$transaction).mockResolvedValue([
      { key: "COMMISSION_RATE", value: "10", updatedAt: new Date() },
    ])

    const req = new Request("http://localhost:3000/api/admin/settings", {
      method: "POST",
      body: JSON.stringify([{ key: "COMMISSION_RATE", value: "10" }]),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.items).toHaveLength(1)
    expect(mockDb.$transaction).toHaveBeenCalled()
  })

  it("returns 400 when invalid payload is sent", async () => {
    const req = new Request("http://localhost:3000/api/admin/settings", {
      method: "POST",
      body: JSON.stringify({}),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
