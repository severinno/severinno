/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
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
  SERVICE_LABELS,
  type GeoServiceMetrics,
  type GeoMetricsSnapshot,
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

// ═══════════════════════════════════════════════════════════════════════════
// recordGeoLatency — systematic (direct calls, not through trackGeoLatency)
// ═══════════════════════════════════════════════════════════════════════════

describe("recordGeoLatency — direct calls", () => {
  it("records a single sample for nominatim", () => {
    recordGeoLatency("nominatim", 42)
    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.count).toBe(1)
    expect(metrics.services.nominatim.p50).toBe(42)
    expect(metrics.services.nominatim.p95).toBe(42)
    expect(metrics.services.nominatim.p99).toBe(42)
  })

  it("records multiple samples and updates percentiles", () => {
    recordGeoLatency("nominatim", 10)
    recordGeoLatency("nominatim", 20)
    recordGeoLatency("nominatim", 30)

    const metrics = getGeoMetrics()
    // Sorted: [10, 20, 30]
    // P50 = ceil(0.5 * 3) - 1 = 2 - 1 = 1 → index 1 = 20
    // P95 = ceil(0.95 * 3) - 1 = 3 - 1 = 2 → index 2 = 30
    // P99 = ceil(0.99 * 3) - 1 = 3 - 1 = 2 → index 2 = 30
    expect(metrics.services.nominatim.p50).toBe(20)
    expect(metrics.services.nominatim.p95).toBe(30)
    expect(metrics.services.nominatim.p99).toBe(30)
  })

  it("records independently per service", () => {
    recordGeoLatency("nominatim", 100)
    recordGeoLatency("viacep", 200)
    recordGeoLatency("postgis", 300)

    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.p50).toBe(100)
    expect(metrics.services.viacep.p50).toBe(200)
    expect(metrics.services.postgis.p50).toBe(300)
  })

  it("does not mix error and success latencies in percentile computation", () => {
    // Errors have high latency but should be excluded from latency percentiles
    recordGeoLatency("nominatim", 10, false)
    recordGeoLatency("nominatim", 20, false)
    recordGeoLatency("nominatim", 9999, true) // error, high latency

    const metrics = getGeoMetrics()
    // Only [10, 20] are success latencies
    // P50 = ceil(0.5 * 2) - 1 = 1 - 1 = 0 → index 0 = 10
    expect(metrics.services.nominatim.p50).toBe(10)
    expect(metrics.services.nominatim.p95).toBe(20)
    expect(metrics.services.nominatim.errorCount).toBe(1)
    expect(metrics.services.nominatim.count).toBe(3) // total samples
  })

  it("counts total samples including errors", () => {
    recordGeoLatency("viacep", 10, false)
    recordGeoLatency("viacep", 20, true)
    recordGeoLatency("viacep", 30, false)
    recordGeoLatency("viacep", 40, true)

    const metrics = getGeoMetrics()
    // Total count should include ALL samples (success + error)
    expect(metrics.services.viacep.count).toBe(4)
    // Error count should only include errors
    expect(metrics.services.viacep.errorCount).toBe(2)
    // Error rate = 2/4 = 0.5
    expect(metrics.services.viacep.errorRate).toBeCloseTo(0.5, 1)
    // Only [10, 30] used for latency percentiles
    // P50 = ceil(0.5 * 2) - 1 = 1 - 1 = 0 → index 0 = 10
    expect(metrics.services.viacep.p50).toBe(10)
  })

  it("preserves timestamps for each sample", () => {
    const before = Date.now() - 1
    recordGeoLatency("nominatim", 50)
    const after = Date.now() + 1

    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.lastSampleAt).not.toBeNull()
    expect(metrics.services.nominatim.lastSampleAt!).toBeGreaterThanOrEqual(before)
    expect(metrics.services.nominatim.lastSampleAt!).toBeLessThanOrEqual(after)
  })

  it("handles concurrent records on same service", () => {
    for (let i = 0; i < 100; i++) {
      recordGeoLatency("nominatim", i)
    }

    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.count).toBe(100)
    // With 100 sorted values [0..99]:
    // P50 = ceil(0.5 * 100) - 1 = 50 - 1 = 49 → index 49 = 49
    // P95 = ceil(0.95 * 100) - 1 = 95 - 1 = 94 → index 94 = 94
    // P99 = ceil(0.99 * 100) - 1 = 99 - 1 = 98 → index 98 = 98
    expect(metrics.services.nominatim.p50).toBe(49)
    expect(metrics.services.nominatim.p95).toBe(94)
    expect(metrics.services.nominatim.p99).toBe(98)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// getGeoMetrics — snapshot structure
// ═══════════════════════════════════════════════════════════════════════════

describe("getGeoMetrics — snapshot structure", () => {
  it("returns a GeoMetricsSnapshot with all required fields", () => {
    const snapshot = getGeoMetrics()

    expect(snapshot).toHaveProperty("services")
    expect(snapshot).toHaveProperty("timestamp")
    expect(snapshot).toHaveProperty("windowSeconds")
    expect(typeof snapshot.timestamp).toBe("number")
    expect(snapshot.timestamp).toBeGreaterThan(0)
    expect(snapshot.windowSeconds).toBe(15 * 60) // 15 minutes
  })

  it("includes all three geo services", () => {
    const snapshot = getGeoMetrics()

    expect(snapshot.services).toHaveProperty("nominatim")
    expect(snapshot.services).toHaveProperty("viacep")
    expect(snapshot.services).toHaveProperty("postgis")
  })

  it("each service has the GeoServiceMetrics shape", () => {
    recordGeoLatency("nominatim", 100)
    const snapshot = getGeoMetrics()

    const checkServiceMetrics = (m: GeoServiceMetrics) => {
      expect(m).toHaveProperty("p50")
      expect(m).toHaveProperty("p95")
      expect(m).toHaveProperty("p99")
      expect(m).toHaveProperty("count")
      expect(m).toHaveProperty("errorRate")
      expect(m).toHaveProperty("lastSampleAt")
      expect(m).toHaveProperty("errorCount")
      expect(typeof m.p50).toBe("number")
      expect(typeof m.p95).toBe("number")
      expect(typeof m.p99).toBe("number")
      expect(typeof m.count).toBe("number")
      expect(typeof m.errorRate).toBe("number")
      expect(typeof m.errorCount).toBe("number")
      expect(m.errorRate).toBeGreaterThanOrEqual(0)
      expect(m.errorRate).toBeLessThanOrEqual(1)
    }

    checkServiceMetrics(snapshot.services.nominatim)
    checkServiceMetrics(snapshot.services.viacep)
    checkServiceMetrics(snapshot.services.postgis)
  })

  it("snapshot timestamp advances on each call", () => {
    const snap1 = getGeoMetrics()
    const snap2 = getGeoMetrics()

    expect(snap2.timestamp).toBeGreaterThanOrEqual(snap1.timestamp)
  })

  it("empty services return zero metrics", () => {
    const snapshot = getGeoMetrics()

    for (const svc of ["nominatim", "viacep", "postgis"] as const) {
      expect(snapshot.services[svc].count).toBe(0)
      expect(snapshot.services[svc].p50).toBe(0)
      expect(snapshot.services[svc].p95).toBe(0)
      expect(snapshot.services[svc].p99).toBe(0)
      expect(snapshot.services[svc].errorRate).toBe(0)
      expect(snapshot.services[svc].errorCount).toBe(0)
      expect(snapshot.services[svc].lastSampleAt).toBeNull()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// P50 / P95 / P99 — aggregation accuracy
// ═══════════════════════════════════════════════════════════════════════════

describe("P50 / P95 / P99 aggregation", () => {
  it("all percentiles equal single value for uniform samples", () => {
    for (let i = 0; i < 10; i++) recordGeoLatency("nominatim", 50)

    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.p50).toBe(50)
    expect(metrics.services.nominatim.p95).toBe(50)
    expect(metrics.services.nominatim.p99).toBe(50)
  })

  it("P50 < P95 < P99 for skewed distribution", () => {
    // 20 low + 5 high spikes — enough that P95 falls beyond the low values
    // Sorted: [10×20, 500, 600, 700, 800, 900] = 25 values
    // P50 = ceil(0.5 * 25) - 1 = 13 - 1 = 12 → index 12 = 10 (still in low region)
    // P95 = ceil(0.95 * 25) - 1 = 24 - 1 = 23 → index 23 = 800
    // P99 = ceil(0.99 * 25) - 1 = 25 - 1 = 24 → index 24 = 900
    for (let i = 0; i < 20; i++) recordGeoLatency("nominatim", 10)
    recordGeoLatency("nominatim", 500)
    recordGeoLatency("nominatim", 600)
    recordGeoLatency("nominatim", 700)
    recordGeoLatency("nominatim", 800)
    recordGeoLatency("nominatim", 900)

    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.p50).toBe(10)
    expect(metrics.services.nominatim.p95).toBe(800)
    expect(metrics.services.nominatim.p99).toBe(900)
  })

  it("percentiles with exactly 1 sample", () => {
    recordGeoLatency("viacep", 123)
    const metrics = getGeoMetrics()
    expect(metrics.services.viacep.p50).toBe(123)
    expect(metrics.services.viacep.p95).toBe(123)
    expect(metrics.services.viacep.p99).toBe(123)
  })

  it("percentiles with exactly 2 samples", () => {
    recordGeoLatency("postgis", 10)
    recordGeoLatency("postgis", 20)

    // Sorted: [10, 20]
    // P50 = ceil(0.5 * 2) - 1 = 1 - 1 = 0 → index 0 = 10
    // P95 = ceil(0.95 * 2) - 1 = 2 - 1 = 1 → index 1 = 20
    // P99 = ceil(0.99 * 2) - 1 = 2 - 1 = 1 → index 1 = 20
    const metrics = getGeoMetrics()
    expect(metrics.services.postgis.p50).toBe(10)
    expect(metrics.services.postgis.p95).toBe(20)
    expect(metrics.services.postgis.p99).toBe(20)
  })

  it("percentiles with exactly 100 samples", () => {
    // 0..99
    for (let i = 0; i < 100; i++) recordGeoLatency("nominatim", i)

    const metrics = getGeoMetrics()
    // P50 = ceil(0.5 * 100) - 1 = 50 - 1 = 49
    // P95 = ceil(0.95 * 100) - 1 = 95 - 1 = 94
    // P99 = ceil(0.99 * 100) - 1 = 99 - 1 = 98
    expect(metrics.services.nominatim.p50).toBe(49)
    expect(metrics.services.nominatim.p95).toBe(94)
    expect(metrics.services.nominatim.p99).toBe(98)
  })

  it("percentiles with 1000 samples match expected ranks", () => {
    // 0..999 — each value appears once
    for (let i = 0; i < 1000; i++) recordGeoLatency("viacep", i)

    const metrics = getGeoMetrics()
    // P50 = ceil(0.5 * 1000) - 1 = 500 - 1 = 499
    // P95 = ceil(0.95 * 1000) - 1 = 950 - 1 = 949
    // P99 = ceil(0.99 * 1000) - 1 = 990 - 1 = 989
    expect(metrics.services.viacep.p50).toBe(499)
    expect(metrics.services.viacep.p95).toBe(949)
    expect(metrics.services.viacep.p99).toBe(989)
  })

  it("errors are excluded from percentile computation", () => {
    // 50 success (0..49) + 50 errors (1000..1049)
    for (let i = 0; i < 50; i++) recordGeoLatency("postgis", i, false)
    for (let i = 0; i < 50; i++) recordGeoLatency("postgis", 1000 + i, true)

    const metrics = getGeoMetrics()
    expect(metrics.services.postgis.count).toBe(100)
    expect(metrics.services.postgis.errorCount).toBe(50)
    // Only successes [0..49] used for percentiles
    // P50 = ceil(0.5 * 50) - 1 = 25 - 1 = 24 → index 24 = 24
    // P95 = ceil(0.95 * 50) - 1 = 48 - 1 = 47 → index 47 = 47
    expect(metrics.services.postgis.p50).toBe(24)
    expect(metrics.services.postgis.p95).toBe(47)
  })

  it("all errors → p50/p95/p99 are 0", () => {
    for (let i = 0; i < 10; i++) recordGeoLatency("nominatim", 1000 + i, true)

    const metrics = getGeoMetrics()
    expect(metrics.services.nominatim.count).toBe(10)
    expect(metrics.services.nominatim.errorCount).toBe(10)
    expect(metrics.services.nominatim.errorRate).toBe(1)
    // No success samples → empty latency array → percentile returns 0
    expect(metrics.services.nominatim.p50).toBe(0)
    expect(metrics.services.nominatim.p95).toBe(0)
    expect(metrics.services.nominatim.p99).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE_LABELS
// ═══════════════════════════════════════════════════════════════════════════

describe("SERVICE_LABELS", () => {
  it("covers all three geo services", () => {
    expect(SERVICE_LABELS).toHaveProperty("nominatim")
    expect(SERVICE_LABELS).toHaveProperty("viacep")
    expect(SERVICE_LABELS).toHaveProperty("postgis")
  })

  it("labels are non-empty strings", () => {
    for (const label of Object.values(SERVICE_LABELS)) {
      expect(label).toBeTruthy()
      expect(typeof label).toBe("string")
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it("labels contain the service name hint", () => {
    expect(SERVICE_LABELS.nominatim.toLowerCase()).toContain("nominatim")
    expect(SERVICE_LABELS.viacep.toLowerCase()).toContain("viacep")
    expect(SERVICE_LABELS.postgis.toLowerCase()).toContain("postgis")
  })

  it("has exactly 3 entries", () => {
    expect(Object.keys(SERVICE_LABELS)).toHaveLength(3)
  })
})
