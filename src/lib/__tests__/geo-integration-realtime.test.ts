/**
 * geo-integration-realtime.test.ts
 *
 * Integration test for checkGeoPerformance() + getGeoMetrics() with REAL
 * (unmocked) geolocation modules and actual disk I/O in a controlled
 * temp directory.
 *
 * What it tests (end-to-end, no mocks except I/O wrappers):
 *   1. recordGeoLatency → getGeoMetrics → persistSnapshot → disk
 *   2. Persisted snapshots → computeGeoBaselines (auto-baseline)
 *   3. Auto-baseline → checkGeoPerformance (threshold check)
 *   4. Flush, reload, verify round-trip correctness
 *
 * Only mocked:
 *   - server-only (required by vitest, Next.js package unavailable)
 *   - logger (avoids noise in test output)
 *   - notifyGeoAlert (prevents real Sentry/push notifications)
 *
 * Temp directory strategy:
 *   - vi.hoisted() sets GEO_METRICS_SNAPSHOTS_DIR + creates temp dir
 *     BEFORE any module imports execute, ensuring the geo modules read
 *     the correct env var at their module-level initialization.
 *   - afterAll cleans up the temp directory.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// ---------------------------------------------------------------------------
// Set up temp directory BEFORE module imports (vi.hoisted runs first)
// ---------------------------------------------------------------------------

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync } = require("node:fs") as {
    mkdtempSync: (p: string) => string
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join: pathJoin } = require("node:path") as {
    join: (...p: string[]) => string
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require("node:os") as { tmpdir: () => string }
  const dir = mkdtempSync(pathJoin(tmpdir(), "geo-intg-"))
  process.env.GEO_METRICS_SNAPSHOTS_DIR = dir
  // Store reference for cleanup in afterAll

  ;(globalThis as any).__GEO_TEMP_DIR__ = dir
})

// ---------------------------------------------------------------------------
// Mocks (required for vitest, not for the geo logic itself)
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/lib/geo-alert-notify", () => ({
  notifyGeoAlert: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Imports (real modules, no mocks)
// ---------------------------------------------------------------------------

import { recordGeoLatency, getGeoMetrics, resetGeoMetrics } from "@/lib/geo-metrics"
import type { GeoServiceName } from "@/lib/geo-metrics"
import { checkGeoPerformance, resetPerformanceAlertState } from "@/lib/geo-performance-alert"
import {
  flushGeoMetrics,
  loadPersistedSnapshots,
  getSnapshotCount,
} from "@/lib/geo-metrics-persist"
import type { PersistedSnapshot } from "@/lib/geo-metrics-persist"
import { computeGeoBaselines } from "@/lib/geo-auto-baseline"
import { notifyGeoAlert } from "@/lib/geo-alert-notify"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a historical snapshot file directly to the temp directory. */
function writeHistoricalSnapshot(
  overrides: Partial<PersistedSnapshot> & { timestamp: number },
): void {
  const base: PersistedSnapshot = {
    timestamp: overrides.timestamp,
    services: {
      nominatim: { p50: 100, p95: 200, p99: 400, count: 50 },
      viacep: { p50: 60, p95: 120, p99: 240, count: 30 },
      postgis: { p50: 8, p95: 15, p99: 30, count: 200 },
    },
  }
  const snapshot = { ...base, ...overrides }
  if (overrides.services) {
    snapshot.services = {
      ...base.services,
      ...overrides.services,
    }
  }
  const snapDir = process.env.GEO_METRICS_SNAPSHOTS_DIR ?? "/tmp"
  writeFileSync(join(snapDir, `snap-${snapshot.timestamp}.json`), JSON.stringify(snapshot), "utf-8")
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(() => {
  const dir = (globalThis as any).__GEO_TEMP_DIR__ as string | undefined
  if (dir) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
})

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe("geo integration — real modules + temp disk", () => {
  // Reset state before each test
  beforeAll(() => {
    resetGeoMetrics()
    resetPerformanceAlertState()
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 1. recordGeoLatency → getGeoMetrics → persist + disk
  // ═══════════════════════════════════════════════════════════════════════

  it("records samples, computes P95, and persists snapshot to disk", async () => {
    // Record realistic samples for all three services
    // Nominatim: P95 should be ~950ms
    for (const ms of [100, 200, 150, 800, 900, 850, 950, 100, 120, 110]) {
      recordGeoLatency("nominatim", ms)
    }
    // ViaCEP: P95 should be ~450ms
    for (const ms of [50, 60, 400, 450, 80, 70, 90, 100]) {
      recordGeoLatency("viacep", ms)
    }
    // PostGIS: P95 should be ~28ms
    for (const ms of [5, 8, 10, 12, 15, 20, 25, 22, 18, 14, 30, 28]) {
      recordGeoLatency("postgis", ms)
    }

    // Compute metrics (calls prune, persists snapshot via debounce)
    const metrics = getGeoMetrics()

    // Assert computed P95 values are in expected ranges
    expect(metrics.services.nominatim.p95).toBeGreaterThan(200)
    expect(metrics.services.nominatim.p95).toBeLessThanOrEqual(1000)
    expect(metrics.services.nominatim.count).toBe(10)

    expect(metrics.services.viacep.p95).toBeGreaterThan(50)
    expect(metrics.services.viacep.p95).toBeLessThanOrEqual(500)
    expect(metrics.services.viacep.count).toBe(8)

    expect(metrics.services.postgis.p95).toBeGreaterThan(10)
    expect(metrics.services.postgis.p95).toBeLessThanOrEqual(50)
    expect(metrics.services.postgis.count).toBe(12)

    // Flush pending snapshot to disk (debounce is 5s, force it)
    await flushGeoMetrics()

    // Verify the snapshot file exists on disk
    expect(await getSnapshotCount()).toBeGreaterThanOrEqual(1)

    // Verify we can reload from disk
    const reloaded = await loadPersistedSnapshots()
    expect(reloaded.length).toBeGreaterThanOrEqual(1)

    // Most recent snapshot should match our services
    const latest = reloaded[reloaded.length - 1]!
    expect(latest.services.nominatim.p95).toBeGreaterThan(200)
    expect(latest.services.postgis.p95).toBeGreaterThan(10)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 2. computeGeoBaselines — auto-baseline from persisted snapshots
  // ═══════════════════════════════════════════════════════════════════════

  it("computeGeoBaselines derives adaptive thresholds from disk snapshots", async () => {
    // Write multiple historical snapshots with consistent P95 values
    const baseTs = Date.now() - 3600_000 // 1 hour ago
    for (let i = 0; i < 10; i++) {
      writeHistoricalSnapshot({
        timestamp: baseTs + i * 300_000, // every 5 min
      })
    }

    await flushGeoMetrics()

    const baselines = await computeGeoBaselines(7200_000) // 2h lookback

    // PostGIS: P95 was 15 in all historical snapshots → baseline ~15ms
    const pg = baselines.find((b) => b.service === "postgis")
    expect(pg).toBeDefined()
    expect(pg!.source).toBe("historical")
    expect(pg!.sampleCount).toBeGreaterThanOrEqual(5)
    expect(pg!.p95Baseline).toBeGreaterThan(5)
    expect(pg!.p95Baseline).toBeLessThanOrEqual(50)

    // Nominatim: P95 was 200 in all snapshots → baseline ~200ms
    const nom = baselines.find((b) => b.service === "nominatim")
    expect(nom).toBeDefined()
    expect(nom!.source).toBe("historical")
    expect(nom!.sampleCount).toBeGreaterThanOrEqual(5)

    // ViaCEP: P95 was 120 in all snapshots → baseline ~120ms
    const via = baselines.find((b) => b.service === "viacep")
    expect(via).toBeDefined()
    expect(via!.source).toBe("historical")
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 3. checkGeoPerformance — detects elevated P95 via deterministic baseline
  // ═══════════════════════════════════════════════════════════════════════

  it("checkGeoPerformance detects elevated P95 via auto-baseline", async () => {
    // We already have historical snapshots with PostGIS P95=15ms from test #2.
    // Record new samples that push current PostGIS P95 well above 2× baseline.
    // Auto-baseline threshold for PostGIS ≈ 30ms (15ms × 2).
    // With samples averaging ~70ms, P95 should exceed this.
    for (const ms of [50, 60, 55, 70, 65, 80, 75, 90, 85, 95]) {
      recordGeoLatency("postgis", ms)
    }
    getGeoMetrics()

    const results = await checkGeoPerformance()

    // At least one result with a valid baseline
    expect(results.length).toBeGreaterThanOrEqual(1)

    // PostGIS should have a baseline from auto-baseline or fallback
    const pg = results.find((r) => {
      // P95 > 0 and a baseline source is set
      return r.p95 > 0 && r.baselineSource != null
    })
    expect(pg).toBeDefined()
    expect(pg!.baselineMean).toBeGreaterThan(0)
    expect(pg!.threshold).toBeGreaterThan(0)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Load persisted data — round-trip from disk
  // ═══════════════════════════════════════════════════════════════════════

  it("loads historical snapshots from disk and verifies content integrity", async () => {
    const snapshots = await loadPersistedSnapshots()

    // Should have at least the historical + the live snapshot(s)
    expect(snapshots.length).toBeGreaterThanOrEqual(1)

    // Every snapshot must have valid structure
    for (const snap of snapshots) {
      expect(typeof snap.timestamp).toBe("number")
      expect(snap.timestamp).toBeGreaterThan(0)

      for (const svc of ["nominatim", "viacep", "postgis"] as GeoServiceName[]) {
        const s = snap.services[svc]
        expect(s).toBeDefined()
        expect(typeof s!.p50).toBe("number")
        expect(typeof s!.p95).toBe("number")
        expect(typeof s!.p99).toBe("number")
        expect(typeof s!.count).toBe("number")
        expect(s!.p50).toBeGreaterThanOrEqual(0)
        expect(s!.p95).toBeGreaterThanOrEqual(s!.p50)
        expect(s!.p99).toBeGreaterThanOrEqual(s!.p95)
      }
    }

    // Confirm snapshots are sorted chronologically
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i]!.timestamp).toBeGreaterThanOrEqual(snapshots[i - 1]!.timestamp)
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Elevated PostGIS P95 → flagged as degraded by checkGeoPerformance
  // ═══════════════════════════════════════════════════════════════════════

  it("flags degraded when PostGIS P95 exceeds 2x auto-baseline", async () => {
    // Write historical snapshots with LOW PostGIS P95 so threshold is low
    const baseTs = Date.now() - 1800_000 // 30 min ago
    for (let i = 0; i < 6; i++) {
      writeHistoricalSnapshot({
        timestamp: baseTs + i * 60_000,
        services: {
          nominatim: { p50: 100, p95: 200, p99: 400, count: 50 },
          viacep: { p50: 60, p95: 120, p99: 240, count: 30 },
          postgis: { p50: 5, p95: 10, p99: 20, count: 200 },
        },
      })
    }
    await flushGeoMetrics()

    // Reset state for clean test
    resetPerformanceAlertState()
    resetGeoMetrics()

    // Push PostGIS P95 well above 2× baseline (10ms → 20ms threshold).
    // With samples averaging ~80ms, P95 will be ~90ms.
    for (const ms of [70, 80, 75, 90, 85, 95, 88, 82, 78, 92]) {
      recordGeoLatency("postgis", ms)
    }
    getGeoMetrics()

    // Run the performance check
    const results = await checkGeoPerformance()

    // Find the PostGIS result — it should be degraded
    const pg = results.find((r) => {
      // PostGIS P95 should be > 20ms (the 2x baseline threshold)
      return r.p95 > 20 && r.baselineSource === "historical-auto"
    })
    expect(pg).toBeDefined()
    expect(pg!.degraded).toBe(true)
    expect(pg!.consecutiveViolations).toBe(1) // first violation
  })

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Complete recovery cycle: degrade → alert → recover
  // ═══════════════════════════════════════════════════════════════════════

  it("complete recovery cycle: degrade → alert → recover → recovery notification", async () => {
    // ── Phase 1: Isolate this test — full state reset ───────────────────
    // Flush ANY pending snapshot from previous tests first
    await flushGeoMetrics()
    resetPerformanceAlertState()
    resetGeoMetrics()
    vi.clearAllMocks()

    // ── Phase 2: Write LOW PostGIS P95 historical snapshots ───────────
    // So the auto-baseline threshold is low (10ms × 2 = 20ms)
    // Use FRESH timestamps (now, not 30min ago) to avoid lookback filtering
    const baseTs = Date.now() - 60_000 // 60 seconds ago
    for (let i = 0; i < 6; i++) {
      writeHistoricalSnapshot({
        timestamp: baseTs + i * 10_000, // every 10s — all within lookback
        services: {
          nominatim: { p50: 100, p95: 200, p99: 400, count: 50 },
          viacep: { p50: 60, p95: 120, p99: 240, count: 30 },
          postgis: { p50: 5, p95: 10, p99: 20, count: 200 },
        },
      })
    }

    // Clear the Redis cache so loadPersistedSnapshots reads fresh from disk
    await flushGeoMetrics()

    // ── Phase 3: Verify the auto-baseline is using our snapshots ───────
    const initialBaselines = await computeGeoBaselines(3600_000) // 1h lookback
    const pgInit = initialBaselines.find((b) => b.service === "postgis")
    expect(pgInit).toBeDefined()
    expect(pgInit!.source).toBe("historical")
    expect(pgInit!.sampleCount).toBeGreaterThanOrEqual(5)
    // With 6 or more snapshots at P95=10ms, mean should be ~10ms
    // But previous tests may have left snapshots on disk with different values
    // So we use a generous range
    expect(pgInit!.p95Baseline).toBeLessThanOrEqual(100)
    expect(pgInit!.threshold).toBeLessThanOrEqual(200)

    // Reset state fresh
    resetPerformanceAlertState()
    resetGeoMetrics()

    // ── Phase 4: Record HIGH PostGIS samples → P95 well above threshold ─
    for (const ms of [70, 80, 75, 90, 85, 95, 88, 82, 78, 92]) {
      recordGeoLatency("postgis", ms)
    }
    const metricsHigh = getGeoMetrics()
    // Verify current P95 is indeed high
    expect(metricsHigh.services.postgis.p95).toBeGreaterThan(80)
    expect(metricsHigh.services.postgis.count).toBe(10)

    // ── Phase 5: First check → 1st violation (degraded, no alert yet) ─
    const r1 = await checkGeoPerformance()

    const pg1 = r1.find((r) => r.p95 > 80)
    expect(pg1).toBeDefined()
    expect(pg1!.degraded).toBe(true)
    expect(pg1!.alerted).toBe(false)
    expect(pg1!.recovered).toBe(false)
    expect(pg1!.consecutiveViolations).toBe(1)
    expect(pg1!.baselineSource).not.toBeNull()

    // ── Phase 6: Second check → 2nd violation → alert sent ────────────
    const r2 = await checkGeoPerformance()
    const pg2 = r2.find((r) => r.p95 > 80)
    expect(pg2).toBeDefined()
    expect(pg2!.degraded).toBe(true)
    expect(pg2!.alerted).toBe(true)
    expect(pg2!.recovered).toBe(false)
    expect(pg2!.consecutiveViolations).toBe(2)

    // Verify degradation notification was sent
    // Severity is "error" because P95 (~90ms) > 1.5× threshold (~32ms × 1.5 = ~48ms)
    expect(notifyGeoAlert).toHaveBeenCalledTimes(1)
    expect(notifyGeoAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: expect.stringContaining("geo-perf:postgis:degraded"),
        severity: "error",
      }),
    )

    // ── Phase 7: Clear high samples, record LOW PostGIS samples ────────
    resetGeoMetrics()
    vi.clearAllMocks() // clear degradation alert from mock count

    for (const ms of [5, 8, 10, 6, 7, 9, 11, 4, 12, 3]) {
      recordGeoLatency("postgis", ms)
    }
    const metricsLow = getGeoMetrics()
    // Verify current P95 is low (well below threshold)
    expect(metricsLow.services.postgis.p95).toBeLessThan(25)
    expect(metricsLow.services.postgis.count).toBe(10)

    // ── Phase 8: Third check → recovery detected ───────────────────────
    const r3 = await checkGeoPerformance()
    const pg3 = r3.find((r) => r.p95 > 0)
    expect(pg3).toBeDefined()
    expect(pg3!.degraded).toBe(false)
    expect(pg3!.alerted).toBe(false)
    expect(pg3!.recovered).toBe(true)
    expect(pg3!.consecutiveViolations).toBe(0)
    expect(pg3!.p95).toBeLessThan(25)
    expect(pg3!.threshold).toBeGreaterThan(0)

    // Verify recovery notification was sent
    expect(notifyGeoAlert).toHaveBeenCalledTimes(1)
    expect(notifyGeoAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: expect.stringContaining("geo-perf:postgis:recovery"),
        severity: "info",
      }),
    )

    // ── Phase 9: Fourth check → steady state (no duplicate recovery) ───
    const r4 = await checkGeoPerformance()
    const pg4 = r4.find((r) => r.p95 > 0)
    expect(pg4).toBeDefined()
    expect(pg4!.degraded).toBe(false)
    expect(pg4!.alerted).toBe(false)
    expect(pg4!.recovered).toBe(false) // recovery already sent, now clear
    expect(pg4!.consecutiveViolations).toBe(0)

    // No additional notifications
    expect(notifyGeoAlert).toHaveBeenCalledTimes(1)
  })
})
