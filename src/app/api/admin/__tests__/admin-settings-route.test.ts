import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET, POST } from "@/app/api/admin/settings/route"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"

vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}))

describe("GET & POST /api/admin/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any)
  })

  it("lists all system settings", async () => {
    vi.mocked(db.setting.findMany).mockResolvedValue([
      { key: "SITE_NAME", value: "Severinno" } as any,
    ])

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.items).toHaveLength(1)
    expect(json.total).toBe(1)
  })

  it("bulk updates settings", async () => {
    vi.mocked(db.setting.upsert).mockResolvedValue({
      key: "COMMISSION_RATE",
      value: "10",
      updatedAt: new Date(),
    } as any)

    const req = new Request("http://localhost:3000/api/admin/settings", {
      method: "POST",
      body: JSON.stringify([{ key: "COMMISSION_RATE", value: "10" }]),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.items).toHaveLength(1)
    expect(db.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "COMMISSION_RATE" },
      }),
    )
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
