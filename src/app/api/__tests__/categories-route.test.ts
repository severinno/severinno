import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../categories/route"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// Mock the db module
vi.mock("@/lib/redis", () => ({
  withCache: vi.fn((_key: string, fn: () => Promise<unknown>, _ttl?: number) => fn()),
  cacheInvalidate: vi.fn(),
}))

vi.mock("@/lib/api-server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...(actual as Record<string, unknown>),
    cacheControlPublic: vi.fn((response: Response) => response),
    syncEntitySearch: vi.fn(),
  }
})

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
  it("returns categories as a tree (roots with children)", async () => {
    ;(vi.mocked(db.category.findMany) as any).mockResolvedValue(mockCategories)

    const req = createMockRequest()
    const response = await GET(req)
    const parsed = await parseResponse<any[]>(response)

    expect(parsed.status).toBe(200)
    expect(Array.isArray(parsed.body)).toBe(true)
    // Tree structure: 1 root (Reparos) with 2 children
    expect(parsed.body).toHaveLength(1)
    expect(parsed.body![0]?.name).toBe("Reparos")
    expect(parsed.body![0]?.children).toHaveLength(2)
    expect(parsed.body![0]?.children![0]?.name).toBe("Elétrica")
    expect(parsed.body![0]?.children![1]?.name).toBe("Hidráulica")
  })

  it("returns flat list when all categories are roots", async () => {
    const rootsOnly = mockCategories.filter((c) => c.parentId === null)
    ;(vi.mocked(db.category.findMany) as any).mockResolvedValue(rootsOnly)

    const req = createMockRequest()
    const response = await GET(req)
    const parsed = await parseResponse<any[]>(response)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toHaveLength(1)
    expect(parsed.body![0]?.name).toBe("Reparos")
  })

  it("returns empty array when no categories exist", async () => {
    ;(vi.mocked(db.category.findMany) as any).mockResolvedValue([])

    const req = createMockRequest()
    const response = await GET(req)
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toEqual([])
  })

  it("passes correct Prisma query parameters", async () => {
    ;(vi.mocked(db.category.findMany) as any).mockResolvedValue([])

    const req = createMockRequest()
    await GET(req)

    expect(db.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ order: "asc" }, { name: "asc" }],
      }),
    )
  })
})
