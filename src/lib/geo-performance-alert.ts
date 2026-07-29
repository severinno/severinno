import "server-only"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { captureMessage } from "@/lib/sentry"
import { getGeoMetrics, type GeoServiceName } from "@/lib/geo-metrics"
import { notifyGeoAlert } from "@/lib/geo-alert-notify"
import logger from "@/lib/logger"

/**
 * GeoPerformanceAlert — Monitors PostGIS P95 latency against the benchmark
 * baseline and sends a Sentry alert when P95 exceeds 2× the baseline.
 *
 * This is a separate concern from the availability monitor (geo-health-alert.ts):
 *   - Availability: "Is PostGIS up or down?"
 *   - Performance:  "Is PostGIS fast enough?"
 *
 * How it works:
 *   1. Loads the benchmark baseline (geo-real-baseline.json → geo-baseline.json → geo-benchmark.json)
 *   2. At each check, compares current PostGIS P95 against 2× baseline
 *   3. If exceeded, sends a structured Sentry alert with debounce (max 1 per 15 min)
 *   4. Sends a recovery notification when P95 returns below the threshold
 *
 * The baseline is the mean latency of the first PostGIS benchmark entry at
 * 100-provider scale (most representative of typical API workloads).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BaselineSource = "geo-real-baseline" | "geo-baseline" | "geo-benchmark"

export type PerformanceCheckResult = {
  /** Current PostGIS P95 from the sliding window. */
  p95: number
  /** Baseline threshold (2 × benchmark mean). */
  threshold: number
  /** Mean latency from the benchmark baseline. */
  baselineMean: number
  /** Where the baseline was loaded from. */
  baselineSource: BaselineSource | null
  /** Whether P95 crossed the threshold. */
  degraded: boolean
  /** Whether a Sentry alert was sent this cycle. */
  alerted: boolean
  /** Whether a recovery was sent this cycle. */
  recovered: boolean
  /** Number of consecutive checks P95 has been above threshold. */
  consecutiveViolations: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Alert when P95 > this multiplier × baseline mean. */
const P95_THRESHOLD_MULTIPLIER = 2

/** Debounce: max 1 alert per N milliseconds per service. */
const ALERT_DEBOUNCE_MS = 15 * 60 * 1000

/** Consecutive violations before alerting (avoids flapping on momentary spikes). */
const CONSECUTIVE_THRESHOLD = 2

/** Baseline file search order (most accurate first). */
const BASELINE_CANDIDATES: Array<{
  path: string
  source: BaselineSource
}> = [
  { path: "docs/benchmarks/geo-real-baseline.json", source: "geo-real-baseline" },
  { path: "docs/benchmarks/geo-baseline.json", source: "geo-baseline" },
  { path: "geo-benchmark.json", source: "geo-benchmark" },
]

// ---------------------------------------------------------------------------
// In-memory state (per service, resets on server restart)
// ---------------------------------------------------------------------------

const perfState = new Map<
  GeoServiceName,
  {
    consecutiveViolations: number
    lastAlertedAt: number | null
    wasDegraded: boolean
  }
>()

function getPerfState(service: GeoServiceName) {
  let s = perfState.get(service)
  if (!s) {
    s = { consecutiveViolations: 0, lastAlertedAt: null, wasDegraded: false }
    perfState.set(service, s)
  }
  return s
}

// ---------------------------------------------------------------------------
// Baseline loader
// ---------------------------------------------------------------------------

type BenchmarkEntry = {
  name: string
  label: string
  mean: number
  min: number
  max: number
  opsPerSec: number
}

type BenchmarkFile = {
  meta: { timestamp: string; platform: string; arch: string; nodeVersion: string }
  benchmarks: BenchmarkEntry[]
}

/**
 * Load the benchmark baseline, searching candidates in order of accuracy.
 * Returns the mean latency of the first PostGIS benchmark entry found,
 * or null if no baseline is available.
 */
export function loadGeoBaseline(): {
  mean: number
  source: BaselineSource
  timestamp: string
} | null {
  for (const candidate of BASELINE_CANDIDATES) {
    try {
      const fullPath = join(process.cwd(), candidate.path)
      if (!existsSync(fullPath)) continue

      const raw = readFileSync(fullPath, "utf-8")
      const parsed = JSON.parse(raw) as BenchmarkFile

      if (!Array.isArray(parsed.benchmarks) || parsed.benchmarks.length === 0) {
        continue
      }

      // Find the first PostGIS entry (model or real)
      const postgisEntry = parsed.benchmarks.find(
        (b) => b.label.startsWith("postgis_") || b.name.toLowerCase().includes("postgis"),
      )

      if (postgisEntry && postgisEntry.mean > 0) {
        return {
          mean: postgisEntry.mean,
          source: candidate.source,
          timestamp: parsed.meta.timestamp,
        }
      }
    } catch {
      // File corrupt or unreadable — try next candidate
      continue
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Performance check
// ---------------------------------------------------------------------------

/**
 * Check PostGIS P95 against the benchmark baseline and send Sentry alerts
 * when the threshold is exceeded.
 *
 * @param services - Optional: which services to check (default: ["postgis"])
 * @returns Array of per-service check results
 */
export function checkGeoPerformance(
  services: GeoServiceName[] = ["postgis"],
): PerformanceCheckResult[] {
  const baseline = loadGeoBaseline()
  const metrics = getGeoMetrics()

  if (!baseline) {
    logger.warn("geo-performance-alert: no baseline available — skipping check")
    return services.map((svc) => ({
      p95: 0,
      threshold: 0,
      baselineMean: 0,
      baselineSource: null,
      degraded: false,
      alerted: false,
      recovered: false,
      consecutiveViolations: 0,
    }))
  }

  const threshold = baseline.mean * P95_THRESHOLD_MULTIPLIER

  const results: PerformanceCheckResult[] = []

  for (const svc of services) {
    const svcMetrics = metrics.services[svc]
    if (!svcMetrics) {
      results.push(createEmptyResult(svc))
      continue
    }

    const p95 = svcMetrics.p95
    const state = getPerfState(svc)
    const isDegraded = p95 > threshold && svcMetrics.count > 0

    // Track consecutive violations
    if (isDegraded) {
      state.consecutiveViolations++
    } else {
      // Recovery: was degraded, now back within threshold
      const isRecovery = state.wasDegraded && state.consecutiveViolations >= CONSECUTIVE_THRESHOLD

      if (isRecovery) {
        // Sentry + push notification
        notifyGeoAlert({
          title: `P95 Recuperado — ${Math.round(p95)}ms`,
          body: `${svc.toUpperCase()} P95 voltou ao normal (${Math.round(p95)}ms, limiar: ${Math.round(threshold)}ms).`,
          severity: "info",
          url: "/admin/geo-metrics",
          tag: `geo-perf:${svc}:recovery`,
          source: "geo-performance-alert",
          context: {
            service: svc,
            metric: "p95",
            value: Math.round(p95),
            threshold: Math.round(threshold),
            baselineMean: Math.round(baseline.mean),
            baselineSource: baseline.source,
            unit: "ms",
          },
        }).catch(() => {})

        logger.info(
          { service: svc, p95, threshold, baselineMean: baseline.mean },
          "geo-performance-alert: recovery",
        )
      }

      state.consecutiveViolations = 0
      state.wasDegraded = false

      results.push({
        p95,
        threshold,
        baselineMean: baseline.mean,
        baselineSource: baseline.source,
        degraded: false,
        alerted: false,
        recovered: isRecovery,
        consecutiveViolations: 0,
      })

      continue
    }

    // Check if we should alert
    const shouldAlert =
      state.consecutiveViolations >= CONSECUTIVE_THRESHOLD &&
      (state.lastAlertedAt === null || Date.now() - state.lastAlertedAt > ALERT_DEBOUNCE_MS)

    if (shouldAlert) {
      state.lastAlertedAt = Date.now()
      state.wasDegraded = true

      const severity: "warn" | "error" =
        p95 > baseline.mean * P95_THRESHOLD_MULTIPLIER * 1.5 ? "error" : "warn"

      // Sentry + push notification to admins
      notifyGeoAlert({
        title: `P95 ${Math.round(p95)}ms — ${((p95 / threshold) * 100).toFixed(0)}% do limiar`,
        body: `${svc.toUpperCase()} P95 ultrapassou ${P95_THRESHOLD_MULTIPLIER}× o baseline. ` +
          `Atual: ${Math.round(p95)}ms, Limiar: ${Math.round(threshold)}ms, Baseline: ${Math.round(baseline.mean)}ms. ` +
          `Amostras na janela: ${svcMetrics.count}.`,
        severity: severity === "error" ? "error" : "warning",
        url: "/admin/geo-metrics",
        tag: `geo-perf:${svc}:degraded`,
        source: "geo-performance-alert",
        context: {
          service: svc,
          metric: "p95",
          value: Math.round(p95),
          threshold: Math.round(threshold),
          baselineMean: Math.round(baseline.mean),
          baselineSource: baseline.source,
          baselineTimestamp: baseline.timestamp,
          multiplier: P95_THRESHOLD_MULTIPLIER,
          unit: "ms",
          sampleCount: svcMetrics.count,
          p50: Math.round(svcMetrics.p50),
          p99: Math.round(svcMetrics.p99),
        },
      }).catch(() => {})

      logger.warn(
        {
          service: svc,
          p95,
          threshold,
          baselineMean: baseline.mean,
          baselineSource: baseline.source,
          consecutiveViolations: state.consecutiveViolations,
        },
        "geo-performance-alert: P95 exceeded threshold",
      )

      results.push({
        p95,
        threshold,
        baselineMean: baseline.mean,
        baselineSource: baseline.source,
        degraded: true,
        alerted: true,
        recovered: false,
        consecutiveViolations: state.consecutiveViolations,
      })
    } else {
      results.push({
        p95,
        threshold,
        baselineMean: baseline.mean,
        baselineSource: baseline.source,
        degraded: true,
        alerted: false,
        recovered: false,
        consecutiveViolations: state.consecutiveViolations,
      })
    }
  }

  return results
}

/**
 * Reset all performance alert state. Useful for testing.
 */
export function resetPerformanceAlertState(): void {
  perfState.clear()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEmptyResult(svc: GeoServiceName): PerformanceCheckResult {
  return {
    p95: 0,
    threshold: 0,
    baselineMean: 0,
    baselineSource: null,
    degraded: false,
    alerted: false,
    recovered: false,
    consecutiveViolations: 0,
  }
}
