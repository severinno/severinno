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
import { requireUser } from "@/lib/auth"
import { getGeoMetrics, SERVICE_LABELS } from "@/lib/geo-metrics"

export type GeoMetricsResponse = ReturnType<typeof getGeoMetrics> & {
  labels: Record<string, string>
}

export async function GET() {
  try {
    const session = await requireUser()
    if (session.role !== "ADMIN") {
      return NextResponse.json({ error: "Não autorizado" }, { status: 403 })
    }
    const snapshot = getGeoMetrics()
    return NextResponse.json({
      ...snapshot,
      labels: SERVICE_LABELS,
    })
  } catch {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }
}
