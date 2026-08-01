import "server-only"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { getGeoMetrics, type GeoServiceName } from "@/lib/geo-metrics"
import { notifyGeoAlert } from "@/lib/geo-alert-notify"
import { computeGeoBaselines } from "./geo-auto-baseline"
import logger from "@/lib/logger"

/**
 * GeoPerformanceAlert — Monitors P95 latency for ALL geo services
 * (Nominatim, ViaCEP, PostGIS) against an adaptive auto-baseline and
 * sends Sentry + push alerts when P95 exceeds 2× the baseline.
 *
 * This is a separate concern from the availability monitor (geo-health-alert.ts):
 *   - Availability: "Is the service up or down?"
 *   - Performance:  "Is the service fast enough?"
 *
 * How it works:
 *   1. Derives per-service P95 baselines from historical snapshots
 *      (auto-baseline adaptativo, 24h lookback via geo-auto-baseline.ts).
 *   2. Falls back to benchmark file (geo-benchmark.json) for PostGIS when
 *      no history is available.
 *   3. At each check, compares current P95 against 2× baseline per service.
 *   4. If exceeded, sends a structured alert with debounce (max 1 per 15 min).
 *   5. Sends a recovery notification when P95 returns below the threshold.
 *
 * The auto-baseline adapts to real operating conditions without manual
 * recalibration — times of day, network variability, API changes.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BaselineSource =
  "geo-real-baseline" | "geo-baseline" | "geo-benchmark" | "historical-auto"

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
 * Check P95 for all geo services against adaptive auto-baselines.
 *
 * For each service, the baseline is derived from historical snapshots
 * (24h lookback) or falls back to sensible defaults when no history exists.
 *
 * @param services - Optional: which services to check (default: all three)
 * @returns Array of per-service check results
 */
export async function checkGeoPerformance(
  services: GeoServiceName[] = ["nominatim", "viacep", "postgis"],
): Promise<PerformanceCheckResult[]> {
  const metrics = getGeoMetrics()

  // Derive adaptive baselines from historical snapshots
  const autoBaselines = await computeGeoBaselines()

  // Also load benchmark baseline for reference (PostGIS only, fallback)
  const benchmarkBaseline = loadGeoBaseline()

  const results: PerformanceCheckResult[] = []

  for (const svc of services) {
    const svcMetrics = metrics.services[svc]
    if (!svcMetrics) {
      results.push(createEmptyResult(svc))
      continue
    }

    const p95 = svcMetrics.p95
    const state = getPerfState(svc)

    // Use auto-baseline when available, fall back to benchmark for PostGIS
    const autoBaseline = autoBaselines.find((b) => b.service === svc)
    let threshold: number
    let baselineMean: number
    let baselineSource: BaselineSource | null

    if (autoBaseline && autoBaseline.source === "historical") {
      // Auto-baseline from historical data
      threshold = autoBaseline.threshold
      baselineMean = autoBaseline.p95Baseline
      baselineSource = "historical-auto"
    } else if (svc === "postgis" && benchmarkBaseline) {
      // Fallback to benchmark file for PostGIS
      threshold = benchmarkBaseline.mean * P95_THRESHOLD_MULTIPLIER
      baselineMean = benchmarkBaseline.mean
      baselineSource = benchmarkBaseline.source
    } else {
      // No baseline available — use a generous default to avoid false positives
      threshold = 2000 // 2s
      baselineMean = 0
      baselineSource = null
    }

    const isDegraded = p95 > threshold && svcMetrics.count > 0

    // Track consecutive violations
    if (isDegraded) {
      state.consecutiveViolations++
    } else {
      // Recovery: was degraded, now back within threshold
      const isRecovery = state.wasDegraded && state.consecutiveViolations >= CONSECUTIVE_THRESHOLD

      if (isRecovery) {
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
            baselineMean: Math.round(baselineMean),
            baselineSource: baselineSource ?? "unknown",
            unit: "ms",
          },
        }).catch(() => {})

        logger.info(
          { service: svc, p95, threshold, baselineMean },
          "geo-performance-alert: recovery",
        )
      }

      state.consecutiveViolations = 0
      state.wasDegraded = false

      results.push({
        p95,
        threshold,
        baselineMean,
        baselineSource,
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

      const severity: "warn" | "error" = p95 > threshold * 1.5 ? "error" : "warn"

      notifyGeoAlert({
        title: `P95 ${Math.round(p95)}ms — ${((p95 / threshold) * 100).toFixed(0)}% do limiar`,
        body:
          `${svc.toUpperCase()} P95 ultrapassou ${P95_THRESHOLD_MULTIPLIER}× o baseline. ` +
          `Atual: ${Math.round(p95)}ms, Limiar: ${Math.round(threshold)}ms, Baseline: ${Math.round(baselineMean)}ms. ` +
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
          baselineMean: Math.round(baselineMean),
          baselineSource: baselineSource ?? "unknown",
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
          baselineMean,
          baselineSource,
          consecutiveViolations: state.consecutiveViolations,
        },
        "geo-performance-alert: P95 exceeded threshold",
      )

      results.push({
        p95,
        threshold,
        baselineMean,
        baselineSource,
        degraded: true,
        alerted: true,
        recovered: false,
        consecutiveViolations: state.consecutiveViolations,
      })
    } else {
      results.push({
        p95,
        threshold,
        baselineMean,
        baselineSource,
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

function createEmptyResult(_svc: GeoServiceName): PerformanceCheckResult {
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
