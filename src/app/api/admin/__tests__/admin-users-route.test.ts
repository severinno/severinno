import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "@/app/api/admin/users/route"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}))

function createRequest(url: string) {
  return new Request(url, { method: "GET" })
}

describe("GET /api/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any)
  })

  it("returns paginated users successfully", async () => {
    const mockUsers = [
      { id: "u1", name: "User 1", email: "u1@test.com", role: "CLIENT", createdAt: new Date() },
      { id: "u2", name: "User 2", email: "u2@test.com", role: "PROVIDER", createdAt: new Date() },
    ]
    vi.mocked(db.user.findMany).mockResolvedValue(mockUsers as any)
    vi.mocked(db.user.count).mockResolvedValue(2)

    const req = createRequest("http://localhost:3000/api/admin/users?page=1&limit=10")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.items).toHaveLength(2)
    expect(json.total).toBe(2)
    expect(json.page).toBe(1)
    expect(json.limit).toBe(10)
  })

  it("filters users by role and search query", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([])
    vi.mocked(db.user.count).mockResolvedValue(0)

    const req = createRequest(
      "http://localhost:3000/api/admin/users?role=PROVIDER&q=eletricista&city=Sao%20Paulo",
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: "PROVIDER",
          city: { contains: "Sao Paulo" },
          OR: expect.any(Array),
        }),
      }),
    )
  })

  it("calculates distance when lat/lng are provided", async () => {
    const mockUsers = [{ id: "u1", name: "Nearby Provider", lat: -23.5505, lng: -46.6333 }]
    vi.mocked(db.user.findMany).mockResolvedValue(mockUsers as any)
    vi.mocked(db.user.count).mockResolvedValue(1)

    const req = createRequest(
      "http://localhost:3000/api/admin/users?lat=-23.5505&lng=-46.6333&radius=10",
    )
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.items[0]).toHaveProperty("distanceKm")
  })

  it("returns 403 if unauthorized", async () => {
    const { HttpError } = await import("@/lib/api-server")
    vi.mocked(requireRole).mockRejectedValue(new HttpError(403, "Acesso proibido"))

    const req = createRequest("http://localhost:3000/api/admin/users")
    const res = await GET(req)

    expect(res.status).toBe(403)
  })
})
