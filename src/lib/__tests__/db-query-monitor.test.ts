import { describe, it, expect, beforeEach, vi } from "vitest"
import { buildQueryMonitorExtensions, getSlowQueryMetrics, resetQueryMetrics } from "../db-query-monitor"

describe("db-query-monitor", () => {
  beforeEach(() => {
    resetQueryMetrics()
    vi.clearAllMocks()
  })

  it("builds query extensions for all models", () => {
    const extensions = buildQueryMonitorExtensions()
    expect(Object.keys(extensions)).toContain("user")
    expect(Object.keys(extensions)).toContain("booking")
    expect(Object.keys(extensions)).toContain("service")
    expect(Object.keys(extensions)).toContain("review")
  })

  it("each extension has findMany, findFirst, create, update, upsert", () => {
    const extensions = buildQueryMonitorExtensions()
    const userOps = Object.keys(extensions.user)
    expect(userOps).toContain("findMany")
    expect(userOps).toContain("findFirst")
    expect(userOps).toContain("create")
    expect(userOps).toContain("update")
    expect(userOps).toContain("upsert")
  })

  it("passes through queries without errors", async () => {
    const extensions = buildQueryMonitorExtensions()
    const mockResult = [{ id: "1", name: "Test" }]
    const query = vi.fn().mockResolvedValue(mockResult)

    const result = await extensions.user.findMany({ args: { where: {} }, query })

    expect(query).toHaveBeenCalledWith({ where: {} })
    expect(result).toEqual(mockResult)
  })

  it("tracks slow queries in the ring buffer", async () => {
    // Set env before building extensions so the threshold is low
    const originalThreshold = process.env.SLOW_QUERY_THRESHOLD_MS
    process.env.SLOW_QUERY_THRESHOLD_MS = "1"

    // Need fresh module to pick up the env change
    vi.resetModules()
    const { buildQueryMonitorExtensions: freshBuild, getSlowQueryMetrics: freshMetrics } = await import("../db-query-monitor")
    const extensions = freshBuild()

    const query = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10))
      return []
    })

    await extensions.booking.findMany({ args: { where: {} }, query })

    const metrics = freshMetrics()
    expect(metrics.total).toBeGreaterThanOrEqual(1)
    expect(metrics.queries[0]).toMatchObject({
      model: "booking",
      operation: "findMany",
    })

    process.env.SLOW_QUERY_THRESHOLD_MS = originalThreshold
    vi.resetModules()
  })

  it("resets metrics correctly", () => {
    resetQueryMetrics()
    const metrics = getSlowQueryMetrics()
    expect(metrics.total).toBe(0)
    expect(metrics.queries).toEqual([])
  })

  it("returns default threshold when env not set", () => {
    const originalThreshold = process.env.SLOW_QUERY_THRESHOLD_MS
    delete process.env.SLOW_QUERY_THRESHOLD_MS
    resetQueryMetrics()

    const metrics = getSlowQueryMetrics()
    expect(metrics.thresholdMs).toBe(200)

    process.env.SLOW_QUERY_THRESHOLD_MS = originalThreshold
  })
})
