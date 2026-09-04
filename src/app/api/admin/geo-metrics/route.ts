export const dynamic = "force-dynamic"

import { handleError } from "@/lib/api-server"
/**
 * GET /api/admin/geo-metrics
 *
 * Returns P50 / P95 / P99 latency metrics for geo services (Nominatim,
 * ViaCEP, PostGIS). Requires admin authentication.
 *
 * Response shape:
 * ```json
 * {
 *   "services": {
 *     "nominatim": { "p50": 142, "p95": 890, "p99": 1200, "count": 847, "errorRate": 0.02, "lastSampleAt": 1700000000000, "errorCount": 17 },
 *     "viacep":    { "p50": 85,  "p95": 430, "p99": 600,  "count": 312, "errorRate": 0.01, "lastSampleAt": 1700000000000, "errorCount": 3 },
 *     "postgis":   { "p50": 12,  "p95": 45,  "p99": 120,  "count": 2301, "errorRate": 0.005, "lastSampleAt": 1700000000000, "errorCount": 11 }
 *   },
 *   "timestamp": 1700000000000,
 *   "windowSeconds": 900
 * }
 * ```
 */

import { NextResponse } from "next/server"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { requireRole } from "@/lib/auth"
import { getP95Baselines } from "@/lib/geo-baselines"
import {
  getGeoMetrics,
  getGeoMetricsHistory,
  SERVICE_LABELS,
  type GeoServiceName,
} from "@/lib/geo-metrics"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BenchmarkData = {
  meta: {
    timestamp: string
    platform: string
    nodeVersion: string
    centerLabel: string
  }
  comparisons: Array<{
    label: string
    scale: number
    haversine: { mean: number; opsPerSec: number }
    postgis: { mean: number; opsPerSec: number }
    ratio: number
  }>
  analysis: {
    note: string
    avgHaversinePerProvider: number
  }
}

export type GeoMetricsResponse = ReturnType<typeof getGeoMetrics> & {
  labels: Record<string, string>
  /** Real benchmark data from geo-benchmark.json */
  benchmark: BenchmarkData | null
  /** Historical snapshot timeline for P50/P95/P99 evolution */
  history: Array<{
    timestamp: number
    services: Record<GeoServiceName, { p50: number; p95: number; p99: number; count: number }>
  }>
  /** P95 baseline thresholds per service (configurable via env vars) */
  baselines: Record<string, number>
}

// ---------------------------------------------------------------------------
// Benchmark loader
// ---------------------------------------------------------------------------

function loadBenchmarkData(): BenchmarkData | null {
  try {
    // Baseline versionado em docs/benchmarks — o geo-benchmark.json da raiz
    // foi removido (08/2026); o shape é o mesmo (meta/benchmarks/analysis).
    const p = join(process.cwd(), "docs", "benchmarks", "geo-benchmark.json")
    if (!existsSync(p)) return null
    const raw = readFileSync(p, "utf-8")
    const parsed = JSON.parse(raw) as {
      meta: {
        timestamp: string
        platform: string
        nodeVersion: string
        centerLabel: string
      }
      benchmarks: Array<{
        label: string
        name: string
        mean: number
        opsPerSec: number
      }>
      analysis: {
        note: string
        avgHaversinePerProvider: number
      }
    }

    // Group haversine_* and postgis_model_* by provider count
    const h100 = parsed.benchmarks.find((b) => b.label === "haversine_100")
    const h1000 = parsed.benchmarks.find((b) => b.label === "haversine_1000")
    const h10000 = parsed.benchmarks.find((b) => b.label === "haversine_10000")
    const p100 = parsed.benchmarks.find((b) => b.label === "postgis_model_100")
    const p1000 = parsed.benchmarks.find((b) => b.label === "postgis_model_1000")
    const p10000 = parsed.benchmarks.find((b) => b.label === "postgis_model_10000")

    const comparisons: BenchmarkData["comparisons"] = []
    const scales = [
      { label: "100 providers", scale: 100, h: h100, p: p100 },
      { label: "1 000 providers", scale: 1000, h: h1000, p: p1000 },
      { label: "10 000 providers", scale: 10000, h: h10000, p: p10000 },
    ]

    for (const s of scales) {
      if (s.h && s.p) {
        comparisons.push({
          label: s.label,
          scale: s.scale,
          haversine: { mean: s.h.mean, opsPerSec: s.h.opsPerSec },
          postgis: { mean: s.p.mean, opsPerSec: s.p.opsPerSec },
          ratio: s.h.mean > 0 ? +(s.p.mean / s.h.mean).toFixed(1) : 0,
        })
      }
    }

    return {
      meta: {
        timestamp: parsed.meta.timestamp,
        platform: parsed.meta.platform,
        nodeVersion: parsed.meta.nodeVersion,
        centerLabel: parsed.meta.centerLabel,
      },
      comparisons,
      analysis: {
        note: parsed.analysis.note,
        avgHaversinePerProvider: parsed.analysis.avgHaversinePerProvider,
      },
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    await requireRole("ADMIN")
    const snapshot = getGeoMetrics()
    const benchmark = loadBenchmarkData()
    const history = getGeoMetricsHistory()

    return NextResponse.json({
      ...snapshot,
      labels: SERVICE_LABELS,
      benchmark,
      history,
      baselines: getP95Baselines(),
    })
  } catch (_e) {
    return handleError(_e)
  }
}
