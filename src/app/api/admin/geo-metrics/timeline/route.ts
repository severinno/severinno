/**
 * GET /api/admin/geo-metrics/timeline
 *
 * Time-series query endpoint for geo metrics history.
 * Returns aggregated P50/P95/P99 data points over a time range with
 * configurable granularity — similar to a simplified time-series DB.
 *
 * Query params:
 *   from         (number, optional) — Unix ms timestamp, default: 24h ago
 *   to           (number, optional) — Unix ms timestamp, default: now
 *   granularity  (string, optional) — Aggregation window:
 *                  "raw"  — return individual snapshots (no aggregation)
 *                  "1m"   — 1-minute buckets
 *                  "5m"   — 5-minute buckets  (default)
 *                  "15m"  — 15-minute buckets
 *                  "1h"   — 1-hour buckets
 *                  "1d"   — 1-day buckets
 *
 * Response shape:
 * ```json
 * {
 *   "meta": {
 *     "from": 1700000000000,
 *     "to": 1700000000000,
 *     "granularity": "15m",
 *     "windowMs": 900000,
 *     "totalSnapshots": 847,
 *     "aggregatedPoints": 96
 *   },
 *   "points": [
 *     {
 *       "windowStart": 1700000000000,
 *       "windowEnd": 1700000000000,
 *       "count": 30,
 *       "services": {
 *         "nominatim": {
 *           "p50": { "mean": 140.2, "min": 100, "max": 200 },
 *           "p95": { "mean": 890.5, "min": 400, "max": 1200 },
 *           "p99": { "mean": 1100, "min": 600, "max": 2000 },
 *           "count": 30
 *         },
 *         "viacep": { ... },
 *         "postgis": { ... }
 *       }
 *     }
 *   ],
 *   "labels": {
 *     "nominatim": "Nominatim (OSM)",
 *     "viacep": "ViaCEP",
 *     "postgis": "PostGIS"
 *   }
 * }
 * ```
 *
 * Authentication: admin only (same pattern as GET /api/admin/geo-metrics).
 */

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { loadPersistedSnapshots } from "@/lib/geo-metrics-persist"
import { SERVICE_LABELS, type GeoServiceName } from "@/lib/geo-metrics"
import { handleError } from "@/lib/api-server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Granularity = "raw" | "1m" | "5m" | "15m" | "1h" | "1d"

type ServiceTimelineData = {
  p50: { mean: number; min: number; max: number }
  p95: { mean: number; min: number; max: number }
  p99: { mean: number; min: number; max: number }
  count: number
}

type TimelinePoint = {
  windowStart: number
  windowEnd: number
  count: number
  services: Record<GeoServiceName, ServiceTimelineData>
}

// ---------------------------------------------------------------------------
// Granularity config
// ---------------------------------------------------------------------------

const GRANULARITY_MS: Record<Granularity, number> = {
  raw: 0,
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
}

const DEFAULT_GRANULARITY: Granularity = "5m"

function parseGranularity(value: string | null): Granularity {
  if (value && value in GRANULARITY_MS) return value as Granularity
  return DEFAULT_GRANULARITY
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

/** Compute mean, min, max from an array of numbers. */
function aggregate(values: number[]): { mean: number; min: number; max: number } {
  if (values.length === 0) return { mean: 0, min: 0, max: 0 }
  let sum = 0
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    sum += v
    if (v < min) min = v
    if (v > max) max = v
  }
  return {
    mean: +(sum / values.length).toFixed(1),
    min: Math.round(min),
    max: Math.round(max),
  }
}

/** Group snapshots into buckets by window size. */
function bucketKey(timestamp: number, windowMs: number): number {
  return Math.floor(timestamp / windowMs) * windowMs
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")

    const url = new URL(request.url)
    const now = Date.now()

    // ── Parse query params ───────────────────────────────────────────
    const fromRaw = url.searchParams.get("from")
    const toRaw = url.searchParams.get("to")
    const granularity = parseGranularity(url.searchParams.get("granularity"))

    const from = fromRaw ? Number(fromRaw) : now - 86_400_000 // default: 24h ago
    const to = toRaw ? Number(toRaw) : now
    const windowMs = GRANULARITY_MS[granularity]

    // Validate
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return NextResponse.json(
        { error: "Parâmetros from/to inválidos — devem ser timestamps Unix em ms" },
        { status: 400 },
      )
    }

    // ── Load and filter snapshots ────────────────────────────────────
    const allSnapshots = await loadPersistedSnapshots()

    const filtered = allSnapshots.filter((s) => s.timestamp >= from && s.timestamp <= to)

    // ── Aggregate ────────────────────────────────────────────────────
    let points: TimelinePoint[]

    if (granularity === "raw" || windowMs === 0) {
      // Return individual snapshots (no aggregation)
      points = filtered.map((snap) => {
        const services = {} as Record<GeoServiceName, ServiceTimelineData>
        for (const [key, val] of Object.entries(snap.services)) {
          const svc = key as GeoServiceName
          services[svc] = {
            p50: { mean: val.p50, min: val.p50, max: val.p50 },
            p95: { mean: val.p95, min: val.p95, max: val.p95 },
            p99: { mean: val.p99, min: val.p99, max: val.p99 },
            count: val.count,
          }
        }
        return {
          windowStart: snap.timestamp,
          windowEnd: snap.timestamp,
          count: 1,
          services,
        }
      })
    } else {
      // Group by time bucket and aggregate
      // Initialize per-service accumulators
      const perServiceBuckets = new Map<
        number,
        Map<
          GeoServiceName,
          {
            p50Values: number[]
            p95Values: number[]
            p99Values: number[]
            count: number
          }
        >
      >()

      for (const snap of filtered) {
        const bk = bucketKey(snap.timestamp, windowMs)

        let svcMap = perServiceBuckets.get(bk)
        if (!svcMap) {
          svcMap = new Map()
          perServiceBuckets.set(bk, svcMap)
        }

        for (const [key, val] of Object.entries(snap.services)) {
          const svc = key as GeoServiceName
          let acc = svcMap.get(svc)
          if (!acc) {
            acc = { p50Values: [], p95Values: [], p99Values: [], count: 0 }
            svcMap.set(svc, acc)
          }
          acc.p50Values.push(val.p50)
          acc.p95Values.push(val.p95)
          acc.p99Values.push(val.p99)
          acc.count += val.count
        }
      }

      // Build points from buckets
      points = Array.from(perServiceBuckets.entries())
        .map(([bk, svcMap]) => {
          const services = {} as Record<GeoServiceName, ServiceTimelineData>
          let totalCount = 0

          for (const [svc, acc] of svcMap) {
            services[svc] = {
              p50: aggregate(acc.p50Values),
              p95: aggregate(acc.p95Values),
              p99: aggregate(acc.p99Values),
              count: acc.count,
            }
            totalCount += acc.count
          }

          return {
            windowStart: bk,
            windowEnd: bk + windowMs,
            count: totalCount,
            services,
          }
        })
        .sort((a, b) => a.windowStart - b.windowStart) // chronological
    }

    return NextResponse.json({
      meta: {
        from: Math.round(from),
        to: Math.round(to),
        granularity,
        windowMs,
        totalSnapshots: filtered.length,
        aggregatedPoints: points.length,
      },
      points,
      labels: SERVICE_LABELS,
    })
  } catch (e) {
    return handleError(e)
  }
}
