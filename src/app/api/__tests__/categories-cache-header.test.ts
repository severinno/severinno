/**
 * Vitest tests for Cache-Control and Vary headers on /api/categories.
 *
 * Uses shared helpers from cache-test-utils to reduce boilerplate.
 *
 * Verifies:
 *   1. 200 response -> Cache-Control: public, max-age=120, s-maxage=600 + Vary
 *   2. Empty categories -> Cache-Control still present (unlike providers,
 *      categories always wraps in cacheControlPublic)
 */

import { describe, it, vi, beforeEach } from "vitest"
import { createMockRequest } from "@/lib/__tests__/helpers/api-test-utils"
import { expectCacheHeaders } from "@/lib/__tests__/helpers/cache-test-utils"

// Mock Redis withCache to just call the factory function (bypasses real Redis)
vi.mock("@/lib/redis", () => ({
  withCache: vi.fn((_key: string, fn: () => Promise<unknown>) => fn()),
  cacheInvalidate: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/db", () => ({
  db: {
    category: { findMany: vi.fn() },
  },
}))

import { GET } from "../categories/route"
import { db } from "@/lib/db"

// Note: api-server is NOT mocked — cacheControlPublic must be real for header assertions

const mockCategories = [
  {
    id: "cat-1", name: "Reparos", slug: "reparos", icon: "🔧",
    level: 0, parentId: null, active: true, order: 1,
    createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-01"),
  },
  {
    id: "cat-2", name: "Elétrica", slug: "eletrica", icon: "⚡",
    level: 1, parentId: "cat-1", active: true, order: 1,
    createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-01"),
  },
  {
    id: "cat-3", name: "Hidráulica", slug: "hidraulica", icon: "💧",
    level: 1, parentId: "cat-1", active: true, order: 2,
    createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-01"),
  },
]

describe("Cache-Control headers on GET /api/categories", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("sets cache headers on 200 with categories (max-age=120, s-maxage=600)", async () => {
    vi.mocked(db.category.findMany as any).mockResolvedValue(mockCategories)
    const res = await GET(createMockRequest())
    expectCacheHeaders(res, 120, 600)
  })

  it("sets cache headers even when no categories exist", async () => {
    vi.mocked(db.category.findMany).mockResolvedValue([])
    const res = await GET(createMockRequest())
    expectCacheHeaders(res, 120, 600)
  })

  it("sets cache headers on filtered results (by level)", async () => {
    vi.mocked(db.category.findMany as any).mockResolvedValue(
      mockCategories.filter((c) => c.level === 0),
    )
    const res = await GET(createMockRequest({ searchParams: { level: "0" } }))
    expectCacheHeaders(res, 120, 600)
  })
})
