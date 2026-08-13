/**
 * GET /api/admin/geo-snapshots-summary
 *
 * Aggregates all persisted geo metrics snapshots (from docs/benchmarks/metrics/)
 * into daily and weekly averages for the admin dashboard.
 *
 * Instead of showing every individual snapshot (up to 1000 data points),
 * this endpoint groups them by day and week, computing the average
 * P50 / P95 / P99 for each geo service (Nominatim, ViaCEP, PostGIS)
 * within each time bucket.
 *
 * Authentication: Requires ADMIN role.
 *
 * Query params:
 *   days  — optional, number of recent days to include (default: all).
 *           Example: ?days=7 returns only the last 7 days.
 *
 * Response:
 *   daily   — Array of daily aggregates (one entry per day with data)
 *   weekly  — Array of weekly aggregates (Monday-start weeks)
 *   totals  — Summary stats (snapshot count, service count, date range)
 *
 * @example
 *   GET /api/admin/geo-snapshots-summary?days=30
 *   → 200 { daily: [...], weekly: [...], totals: {...} }
 */

import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import {
  loadPersistedSnapshots,
  getSnapshotCount,
  getSnapshotsDir,
  resetCacheFlags,
  wasSnapshotCacheHit,
  wasCountCacheHit,
} from "@/lib/geo-metrics-persist"
import type { PersistedSnapshot } from "@/lib/geo-metrics-persist"
import type { GeoServiceName } from "@/lib/geo-metrics"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single time-bucket aggregate for one service. */
export interface ServiceAggregate {
  p50: number
  p95: number
  p99: number
  /** How many raw snapshots contributed to this aggregate. */
  count: number
}

/** A single time-bucket aggregate. */
export interface TimeBucket {
  /** ISO-8601 date string for the start of the bucket. */
  date: string
  /** Unix ms timestamp for the start of the bucket. */
  timestamp: number
  /** Aggregated service data (only services that had data). */
  services: Partial<Record<GeoServiceName, ServiceAggregate>>
  /** Number of snapshots in this bucket. */
  snapshotCount: number
}

export interface SnapshotsSummaryResponse {
  daily: TimeBucket[]
  weekly: TimeBucket[]
  totals: {
    totalSnapshots: number
    dailyBuckets: number
    weeklyBuckets: number
    dateRange: {
      from: string | null
      to: string | null
    }
    snapshotDir: string
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the start of the day (UTC) for a given timestamp. */
function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime()
}

/** Return the start of the ISO week (Monday 00:00 UTC) for a given timestamp. */
function startOfWeek(ts: number): number {
  const d = new Date(ts)
  const day = d.getUTCDay() // 0 = Sunday, 1 = Monday, ...
  const diff = day === 0 ? 6 : day - 1 // days since Monday
  d.setUTCDate(d.getUTCDate() - diff)
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime()
}

/** Compute the average of an array of numbers. Returns 0 for empty arrays. */
function avg(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Round to 1 decimal place. */
function roundOneDecimal(v: number): number {
  return Math.round(v * 10) / 10
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Group snapshots by a bucket key function and compute per-service averages.
 */
function aggregateByBucket(
  snapshots: PersistedSnapshot[],
  bucketFn: (ts: number) => number,
): TimeBucket[] {
  // Group snapshots by bucket key
  const buckets = new Map<number, PersistedSnapshot[]>()

  for (const snap of snapshots) {
    const key = bucketFn(snap.timestamp)
    if (!buckets.has(key)) {
      buckets.set(key, [])
    }
    buckets.get(key)!.push(snap)
  }

  const services: GeoServiceName[] = ["nominatim", "viacep", "postgis"]

  // Compute averages per bucket
  const results: TimeBucket[] = []

  for (const [key, bucketSnaps] of buckets) {
    const aggregated: Partial<Record<GeoServiceName, ServiceAggregate>> = {}

    for (const svc of services) {
      const entries = bucketSnaps.filter((s) => s.services[svc]?.p50 != null)

      if (entries.length === 0) continue

      aggregated[svc] = {
        p50: roundOneDecimal(avg(entries.map((e) => e.services[svc]!.p50))),
        p95: roundOneDecimal(avg(entries.map((e) => e.services[svc]!.p95))),
        p99: roundOneDecimal(avg(entries.map((e) => e.services[svc]!.p99))),
        count: entries.length,
      }
    }

    results.push({
      date: new Date(key).toISOString(),
      timestamp: key,
      services: aggregated,
      snapshotCount: bucketSnaps.length,
    })
  }

  // Sort chronologically
  results.sort((a, b) => a.timestamp - b.timestamp)

  return results
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireRole("ADMIN")

    const { searchParams } = request.nextUrl
    const daysParam = searchParams.get("days")

    // Reset cache flags before this request's calls
    resetCacheFlags()

    let snapshots = await loadPersistedSnapshots()

    // Filter by recency if ?days=N is provided
    if (daysParam) {
      const days = Number(daysParam)
      if (Number.isFinite(days) && days > 0) {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
        snapshots = snapshots.filter((s) => s.timestamp >= cutoff)
      }
    }

    const daily = aggregateByBucket(snapshots, startOfDay)
    const weekly = aggregateByBucket(snapshots, startOfWeek)

    const from = snapshots.length > 0 ? new Date(snapshots[0]!.timestamp).toISOString() : null
    const to =
      snapshots.length > 0
        ? new Date(snapshots[snapshots.length - 1]!.timestamp).toISOString()
        : null

    const totalSnapshots = await getSnapshotCount()

    const response: SnapshotsSummaryResponse = {
      daily,
      weekly,
      totals: {
        totalSnapshots,
        dailyBuckets: daily.length,
        weeklyBuckets: weekly.length,
        dateRange: { from, to },
        snapshotDir: getSnapshotsDir(),
      },
    }

    // Determine cache status for debug/monitoring
    const snapCache = wasSnapshotCacheHit()
    const cntCache = wasCountCacheHit()
    const cacheLabel =
      snapCache === null && cntCache === null
        ? "MISS" // neither was called (shouldn't happen)
        : snapCache === true && cntCache === true
          ? "HIT"
          : "PARTIAL"

    const jsonResponse = NextResponse.json(response)
    jsonResponse.headers.set("X-Snapshots-Cache", cacheLabel)
    return jsonResponse
  } catch (e) {
    return handleError(e)
  }
}
