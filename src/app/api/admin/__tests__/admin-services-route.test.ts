import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "@/app/api/admin/services/route"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"

vi.mock("@/lib/db", () => ({
  db: {
    service: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}))

describe("GET /api/admin/services", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any)
  })

  it("lists services with provider and category details", async () => {
    const mockServices = [
      {
        id: "s1",
        title: "Instalação Elétrica",
        category: { name: "Eletricista" },
        provider: { name: "Carlos" },
        _count: { bookings: 5, reviews: 3 },
      },
    ]
    vi.mocked(db.service.findMany).mockResolvedValue(mockServices as any)
    vi.mocked(db.service.count).mockResolvedValue(1)

    const req = new Request("http://localhost:3000/api/admin/services?q=eletrica&active=true")
    const res = await GET(req, { params: Promise.resolve({}) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.items).toHaveLength(1)
    expect(json.total).toBe(1)
  })
})
