import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../categories/route"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// Mock the db module
vi.mock("@/lib/db", () => ({
  db: {
    category: {
      findMany: vi.fn(),
    },
  },
}))

// Import the mocked db
import { db } from "@/lib/db"

const mockCategories = [
  {
    id: "cat-1",
    name: "Reparos",
    slug: "reparos",
    icon: "🔧",
    level: 0,
    parentId: null,
    active: true,
    order: 1,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  },
  {
    id: "cat-2",
    name: "Elétrica",
    slug: "eletrica",
    icon: "⚡",
    level: 1,
    parentId: "cat-1",
    active: true,
    order: 1,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  },
  {
    id: "cat-3",
    name: "Hidráulica",
    slug: "hidraulica",
    icon: "💧",
    level: 1,
    parentId: "cat-1",
    active: true,
    order: 2,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/categories", () => {
  it("returns all active categories as a flat array", async () => {
    vi.mocked(db.category.findMany).mockResolvedValue(mockCategories)

    const req = createMockRequest()
    const response = await GET(req)
    const parsed = await parseResponse<typeof mockCategories>(response)

    expect(parsed.status).toBe(200)
    expect(Array.isArray(parsed.body)).toBe(true)
    expect(parsed.body).toHaveLength(3)
    expect(parsed.body![0]?.name).toBe("Reparos")
  })

  it("filters by level", async () => {
    vi.mocked(db.category.findMany).mockResolvedValue(
      mockCategories.filter((c) => c.level === 0),
    )

    const req = createMockRequest({ searchParams: { level: "0" } })
    const response = await GET(req)
    const parsed = await parseResponse<typeof mockCategories>(response)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toHaveLength(1)
    expect(parsed.body![0]?.level).toBe(0)
  })

  it("filters by parentId", async () => {
    vi.mocked(db.category.findMany).mockResolvedValue(
      mockCategories.filter((c) => c.parentId === "cat-1"),
    )

    const req = createMockRequest({ searchParams: { parentId: "cat-1" } })
    const response = await GET(req)
    const parsed = await parseResponse<typeof mockCategories>(response)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toHaveLength(2)
    expect(parsed.body![0]?.name).toBe("Elétrica")
    expect(parsed.body![1]?.name).toBe("Hidráulica")
  })

  it("returns empty array when no categories exist", async () => {
    vi.mocked(db.category.findMany).mockResolvedValue([])

    const req = createMockRequest()
    const response = await GET(req)
    const parsed = await parseResponse<typeof mockCategories>(response)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toEqual([])
  })

  it("passes correct Prisma query parameters", async () => {
    vi.mocked(db.category.findMany).mockResolvedValue([])

    const req = createMockRequest({ searchParams: { level: "1" } })
    await GET(req)

    expect(db.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ order: "asc" }, { name: "asc" }],
      }),
    )
  })
})
