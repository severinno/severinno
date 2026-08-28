import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET as getPerformance } from "@/app/api/admin/performance/route"
import { GET as getPgBouncer } from "@/app/api/admin/pgbouncer/route"
import { requireRole } from "@/lib/auth"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn(),
  RATE_LIMITS: { admin: 100, general: 100 },
}))

vi.mock("@/lib/db", () => ({
  db: {},
}))

describe("Admin Infra API Routes (/api/admin/performance, /api/admin/pgbouncer)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any)
  })

  it("returns performance metrics summary", async () => {
    const req = new Request("http://localhost:3000/api/admin/performance?period=24h")
    const res = await getPerformance(req as any)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.period).toBe("24h")
    expect(json.endpoints).toBeInstanceOf(Array)
    expect(json.systemHealth.uptime).toBeGreaterThan(0)
  })

  it("handles PgBouncer diagnostics gracefully", async () => {
    const res = await getPgBouncer(new Request("http://localhost/api/admin/pgbouncer"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveProperty("pools")
    expect(json).toHaveProperty("stats")
    expect(json).toHaveProperty("config")
  })
})
