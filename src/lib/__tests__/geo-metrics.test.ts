/**
 * geo-metrics.test.ts
 *
 * Unit tests for geo-metrics.ts.
 *
 * Tests cover trackGeoLatency(), getGeoMetricsHistory(), and error tracking.
 * recordGeoLatency() and getGeoMetrics() are already tested via integration tests.
 *
 * Mocks:
 *   - server-only           → required by vitest
 *   - ./logger              → no-op
 *   - ./geo-metrics-persist → no-op mocks for persistSnapshot, loadPersistedSnapshots
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}))

vi.mock("../logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("../geo-metrics-persist", () => ({
  persistSnapshot: vi.fn(),
  loadPersistedSnapshots: vi.fn(() => []),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  recordGeoLatency,
  trackGeoLatency,
  getGeoMetrics,
  getGeoMetricsHistory,
  resetGeoMetrics,
} from "../geo-metrics"

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  resetGeoMetrics()
})

// ═══════════════════════════════════════════════════════════════════════════
// trackGeoLatency
// ═══════════════════════════════════════════════════════════════════════════

describe("trackGeoLatency", () => {
  it("records latency on successful function execution", async () => {
    const result = await trackGeoLatency("nominatim", async () => "hello")

    expect(result).toBe("hello")

    // Should have recorded one sample
    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.count).toBe(1)
    expect(metrics.services.nominatim.errorCount).toBe(0)
    expect(metrics.services.nominatim.errorRate).toBe(0)
  })

  it("records latency with error=true when function throws", async () => {
    const err = new Error("test error")
    await expect(
      trackGeoLatency("viacep", async () => {
        throw err
      }),
    ).rejects.toThrow("test error")

    const metrics = getGeoMetrics()
    expect(metrics.services.viacep.count).toBe(1)
    expect(metrics.services.viacep.errorCount).toBe(1)
    expect(metrics.services.viacep.errorRate).toBe(1) // 1/1 = 100%
  })

  it("records mixed success and error samples", async () => {
    // 2 successes, 1 error
    await trackGeoLatency("postgis", async () => "ok1")
    await trackGeoLatency("postgis", async () => "ok2")
    await expect(
      trackGeoLatency("postgis", async () => {
        throw new Error("fail")
      }),
    ).rejects.toThrow("fail")

    const metrics = getGeoMetrics()
    expect(metrics.services.postgis.count).toBe(3)
    expect(metrics.services.postgis.errorCount).toBe(1)
    expect(metrics.services.postgis.errorRate).toBeCloseTo(0.333, 2)
  })

  it("records non-zero elapsed time", async () => {
    await trackGeoLatency("nominatim", async () => {
      // Simulate work
      await new Promise((r) => setTimeout(r, 5))
      return "done"
    })

    const metrics = getGeoMetrics()
    // Should be at least 5ms
    expect(metrics.services.nominatim.p50).toBeGreaterThanOrEqual(4)
    expect(metrics.services.nominatim.p95).toBeGreaterThanOrEqual(4)
  })

  it("re-throws the original error (preserving stack)", async () => {
    const originalError = new Error("original message")
    try {
      await trackGeoLatency("nominatim", async () => {
        throw originalError
      })
      throw new Error("should have thrown")
    } catch (e) {
      expect(e).toBe(originalError) // same reference
    }
  })

  it("handles synchronous function that throws", async () => {
    await expect(
      trackGeoLatency("nominatim", async () => {
        throw new TypeError("sync error")
      }),
    ).rejects.toThrow(TypeError)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// getGeoMetricsHistory
// ═══════════════════════════════════════════════════════════════════════════

describe("getGeoMetricsHistory", () => {
  it("returns an array (initially empty or seeded)", () => {
    const history = getGeoMetricsHistory()
    expect(Array.isArray(history)).toBe(true)
  })

  it("contains entries after getGeoMetrics is called", () => {
    recordGeoLatency("nominatim", 100)
    getGeoMetrics() // generates a snapshot

    const history = getGeoMetricsHistory()
    expect(history.length).toBeGreaterThanOrEqual(1)
  })

  it("each entry has timestamp and services", () => {
    recordGeoLatency("nominatim", 100)
    getGeoMetrics()

    const history = getGeoMetricsHistory()
    const entry = history[history.length - 1]!

    expect(entry).toHaveProperty("timestamp")
    expect(typeof entry.timestamp).toBe("number")
    expect(entry).toHaveProperty("services")
    expect(entry.services).toHaveProperty("nominatim")
    expect(entry.services.nominatim).toHaveProperty("p50")
    expect(entry.services.nominatim).toHaveProperty("p95")
    expect(entry.services.nominatim).toHaveProperty("p99")
    expect(entry.services.nominatim).toHaveProperty("count")
  })

  it("grows with each getGeoMetrics() call", () => {
    recordGeoLatency("nominatim", 50)
    getGeoMetrics()
    const len1 = getGeoMetricsHistory().length

    recordGeoLatency("nominatim", 100)
    getGeoMetrics()
    const len2 = getGeoMetricsHistory().length

    expect(len2).toBe(len1 + 1)
  })

  it("history entries reflect the metrics at the time of snapshot", () => {
    recordGeoLatency("nominatim", 200)
    recordGeoLatency("nominatim", 300)
    getGeoMetrics()

    const history = getGeoMetricsHistory()
    const entry = history[history.length - 1]!

    // With two samples [200, 300]:
    // P50 = 200 (ceil(0.5 * 2) - 1 = 0 → index 0)
    // P95 = 300 (ceil(0.95 * 2) - 1 = 1 → index 1)
    // P99 = 300 (ceil(0.99 * 2) - 1 = 1 → index 1)
    expect(entry.services.nominatim.p50).toBe(200)
    expect(entry.services.nominatim.p95).toBe(300)
    expect(entry.services.nominatim.p99).toBe(300)
    expect(entry.services.nominatim.count).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Error tracking
// ═══════════════════════════════════════════════════════════════════════════

describe("error tracking in getGeoMetrics", () => {
  it("reports errorRate = 0 when there are no errors", () => {
    recordGeoLatency("nominatim", 100)
    recordGeoLatency("nominatim", 200)
    recordGeoLatency("nominatim", 150)

    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.errorRate).toBe(0)
    expect(metrics.services.nominatim.errorCount).toBe(0)
  })

  it("reports errorRate = 1 when all samples are errors", () => {
    recordGeoLatency("viacep", 100, true)
    recordGeoLatency("viacep", 200, true)

    const metrics = getGeoMetrics()
    expect(metrics.services.viacep.errorCount).toBe(2)
    expect(metrics.services.viacep.errorRate).toBe(1)
  })

  it("computes errorRate correctly for mixed samples", () => {
    // 3 errors out of 10 → 0.3
    for (let i = 0; i < 7; i++) recordGeoLatency("postgis", 10 + i, false)
    for (let i = 0; i < 3; i++) recordGeoLatency("postgis", 100, true)

    const metrics = getGeoMetrics()
    expect(metrics.services.postgis.count).toBe(10)
    expect(metrics.services.postgis.errorCount).toBe(3)
    expect(metrics.services.postgis.errorRate).toBeCloseTo(0.3, 1)
  })

  it("returns errorRate = 0 when there are zero samples", () => {
    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.errorRate).toBe(0)
    expect(metrics.services.nominatim.errorCount).toBe(0)
    expect(metrics.services.nominatim.count).toBe(0)
  })

  it("lastSampleAt is null when no samples recorded", () => {
    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.lastSampleAt).toBeNull()
  })

  it("lastSampleAt is set when samples exist", () => {
    const before = Date.now()
    recordGeoLatency("nominatim", 100)
    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.lastSampleAt).not.toBeNull()
    expect(metrics.services.nominatim.lastSampleAt).toBeGreaterThanOrEqual(before)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// recordGeoLatency — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("recordGeoLatency — edge cases", () => {
  it("silently ignores unknown service name", () => {
    // TypeScript prevents this at compile time, but the runtime guard exists
    recordGeoLatency("invalid" as any, 100)
    // Should not throw — metrics for existing services remain unchanged
    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.count).toBe(0)
  })

  it("handles zero ms value", () => {
    recordGeoLatency("nominatim", 0)
    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.count).toBe(1)
    expect(metrics.services.nominatim.p50).toBe(0)
    expect(metrics.services.nominatim.p95).toBe(0)
  })

  it("handles very large ms value", () => {
    recordGeoLatency("nominatim", 999999)
    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.count).toBe(1)
    expect(metrics.services.nominatim.p95).toBe(999999)
  })
})
