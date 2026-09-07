import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  withMultiLevelCache,
  invalidateMultiLevelCache,
  getMultiLevelCacheStats,
  clearMultiLevelCache,
} from "../cache/multi-level-cache"

const { mockCacheGet, mockCacheSet, mockCacheInvalidate } = vi.hoisted(() => ({
  mockCacheGet: vi.fn(),
  mockCacheSet: vi.fn(),
  mockCacheInvalidate: vi.fn(),
}))

vi.mock("@/lib/redis", () => ({
  cacheGet: mockCacheGet,
  cacheSet: mockCacheSet,
  cacheInvalidate: mockCacheInvalidate,
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe("MultiLevelCache (L1 In-Memory + L2 Redis)", () => {
  beforeEach(() => {
    clearMultiLevelCache()
    vi.clearAllMocks()
    mockCacheGet.mockResolvedValue(null)
    mockCacheSet.mockResolvedValue(true)
    mockCacheInvalidate.mockResolvedValue(undefined)
  })

  it("handles cache miss: invokes fetcher, writes to L1 and L2", async () => {
    const fetcher = vi.fn().mockResolvedValue([{ id: 1, name: "Severino" }])

    const res = await withMultiLevelCache("test:providers", fetcher, {
      l1TtlSeconds: 10,
      l2TtlSeconds: 60,
      tags: ["providers"],
    })

    expect(res.source).toBe("db")
    expect(res.data).toEqual([{ id: 1, name: "Severino" }])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(mockCacheSet).toHaveBeenCalledWith("test:providers", [{ id: 1, name: "Severino" }], 60)

    const stats = getMultiLevelCacheStats()
    expect(stats.misses).toBe(1)
    expect(stats.l1Hits).toBe(0)
  })

  it("serves subsequent request directly from L1 (instant memory hit)", async () => {
    const fetcher = vi.fn().mockResolvedValue({ status: "active" })

    // Miss
    await withMultiLevelCache("test:status", fetcher)

    // Second call — L1 hit
    const second = await withMultiLevelCache("test:status", fetcher)

    expect(second.source).toBe("l1")
    expect(second.data).toEqual({ status: "active" })
    expect(fetcher).toHaveBeenCalledTimes(1) // not called again
    expect(mockCacheGet).toHaveBeenCalledTimes(1) // not called on L1 hit

    const stats = getMultiLevelCacheStats()
    expect(stats.l1Hits).toBe(1)
    expect(stats.misses).toBe(1)
    expect(stats.hitRate).toBe(0.5)
  })

  it("serves from L2 when L1 is empty/cleared", async () => {
    mockCacheGet.mockResolvedValue({ cachedFromRedis: true })
    const fetcher = vi.fn()

    const res = await withMultiLevelCache("test:redis-key", fetcher, { l1TtlSeconds: 30 })

    expect(res.source).toBe("l2")
    expect(res.data).toEqual({ cachedFromRedis: true })
    expect(fetcher).not.toHaveBeenCalled()

    // Third call should now hit L1 because L2 populated L1
    const nextCall = await withMultiLevelCache("test:redis-key", fetcher)
    expect(nextCall.source).toBe("l1")

    const stats = getMultiLevelCacheStats()
    expect(stats.l2Hits).toBe(1)
    expect(stats.l1Hits).toBe(1)
  })

  it("invalidates by tag or prefix correctly", async () => {
    const fetcher = vi.fn().mockResolvedValue("data-1")
    await withMultiLevelCache("vitrine:featured", fetcher, { tags: ["vitrine"] })

    const invalidated = await invalidateMultiLevelCache("vitrine")
    expect(invalidated).toBeGreaterThan(0)
    expect(mockCacheInvalidate).toHaveBeenCalledWith("vitrine*")

    // After invalidation, should be a miss again
    await withMultiLevelCache("vitrine:featured", fetcher, { tags: ["vitrine"] })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
