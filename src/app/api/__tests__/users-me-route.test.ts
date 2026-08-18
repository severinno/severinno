import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET, PATCH } from "@/app/api/users/me/route"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}))

vi.mock("@/lib/api-server", async () => {
  const actual = await vi.importActual("@/lib/api-server")
  return {
    ...actual,
    syncServiceSearch: vi.fn(),
  }
})

describe("GET & PATCH /api/users/me", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: "u-123", role: "CLIENT" } as any)
  })

  it("returns current user profile", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-123",
      email: "user@test.com",
      name: "João Silva",
      role: "CLIENT",
    } as any)

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.user.email).toBe("user@test.com")
  })

  it("updates user profile with validated fields", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ id: "u-123", role: "CLIENT" } as any)
    vi.mocked(db.user.update).mockResolvedValue({
      id: "u-123",
      name: "João da Silva Sauro",
      city: "São Paulo",
      role: "CLIENT",
    } as any)

    const req = new Request("http://localhost:3000/api/users/me", {
      method: "PATCH",
      body: JSON.stringify({
        name: "João da Silva Sauro",
        city: "São Paulo",
      }),
    })

    const res = await PATCH(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.user.name).toBe("João da Silva Sauro")
  })
})
