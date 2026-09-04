export const dynamic = "force-dynamic"

/**
 * GET /api/admin/geo-cache-diagnostics
 *
 * Returns comprehensive Redis cache diagnostics for geo queries:
 *   - Hit/miss ratio (from cacheGet/cacheSet counters)
 *   - In-memory store size and max TTL remaining
 *   - Top queries by frequency from the persistent query log
 *   - Geo metrics snapshot per endpoint (Nominatim, ViaCEP, PostGIS)
 *   - TTL remaining for common cache keys (if Redis is available)
 *
 * Requires admin authentication.
 */

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { getCacheStats, getMemoryCacheDiagnostics, getClient, isRedisAvailable } from "@/lib/redis"
import { getGeoMetrics, SERVICE_LABELS, type GeoServiceName } from "@/lib/geo-metrics"
import {
  getTopSearches,
  getTopCEPs,
  getTopReverses,
  getQueryLogDiagnostics,
} from "@/lib/geo-query-log"
import { handleError } from "@/lib/api-server"
import { getWarmConfig } from "@/lib/geo-cache-warm"

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    await requireRole("ADMIN")

    const cacheStats = getCacheStats()
    const memoryDiag = getMemoryCacheDiagnostics()
    const geoMetrics = getGeoMetrics()
    const queryLogDiag = getQueryLogDiagnostics()
    const warmConfig = getWarmConfig()

    // Top queries from the persistent log
    const topSearches = getTopSearches(10).map((s) => ({
      query: s.query,
      count: s.count,
    }))
    const topCEPs = getTopCEPs(10).map((c) => ({
      cep: c.cep,
      count: c.count,
    }))
    const topReverses = getTopReverses(5).map((r) => ({
      coords: r.coords,
      count: r.count,
    }))

    // Try to read TTL for common cache keys from Redis
    let keyTTLs: Array<{ key: string; ttlSeconds: number | null }> = []
    if (isRedisAvailable()) {
      try {
        const client = getClient()
        if (client) {
          const probeKeys = [
            "geo:search:são paulo, sp:5",
            "geo:search:rio de janeiro, rj:5",
            "geo:cep:01310100",
            "geo:cep:20040002",
            "geo:reverse:-23.5505,-46.6333",
          ]
          const results = await Promise.allSettled(
            probeKeys.map(async (key) => {
              const ttl = await client.ttl(key)
              return { key, ttlSeconds: ttl >= 0 ? ttl : null }
            }),
          )
          keyTTLs = results
            .filter((r) => r.status === "fulfilled")
            .map(
              (r) =>
                (r as PromiseFulfilledResult<{ key: string; ttlSeconds: number | null }>).value,
            )
        }
      } catch {
        // Redis TTL read failed — skip
      }
    }

    // Heatmap data: per-service call counts over the last 15 min window
    const heatmap = Object.entries(geoMetrics.services).map(([key, metrics]) => ({
      service: key as GeoServiceName,
      label: SERVICE_LABELS[key as GeoServiceName] ?? key,
      calls: metrics.count,
      errors: metrics.errorCount,
      errorRate: metrics.errorRate,
      p50: metrics.p50,
      p95: metrics.p95,
      p99: metrics.p99,
      lastSampleAt: metrics.lastSampleAt,
    }))

    return NextResponse.json({
      cacheStats,
      memoryDiag,
      queryLogDiag,
      warmConfig,
      topSearches,
      topCEPs,
      topReverses,
      keyTTLs,
      heatmap,
      geoMetrics: {
        services: geoMetrics.services,
        timestamp: geoMetrics.timestamp,
        windowSeconds: geoMetrics.windowSeconds,
      },
      timestamp: Date.now(),
    })
  } catch (_e) {
    return handleError(_e)
  }
}

// ---------------------------------------------------------------------------
// Response type (exported for the client component)
// ---------------------------------------------------------------------------

export type GeoCacheDiagnosticsResponse = {
  cacheStats: ReturnType<typeof getCacheStats>
  memoryDiag: ReturnType<typeof getMemoryCacheDiagnostics>
  queryLogDiag: ReturnType<typeof getQueryLogDiagnostics>
  warmConfig: ReturnType<typeof getWarmConfig>
  topSearches: Array<{ query: string; count: number }>
  topCEPs: Array<{ cep: string; count: number }>
  topReverses: Array<{ coords: string; count: number }>
  keyTTLs: Array<{ key: string; ttlSeconds: number | null }>
  heatmap: Array<{
    service: GeoServiceName
    label: string
    calls: number
    errors: number
    errorRate: number
    p50: number
    p95: number
    p99: number
    lastSampleAt: number | null
  }>
  geoMetrics: {
    services: Record<
      GeoServiceName,
      {
        p50: number
        p95: number
        p99: number
        count: number
        errorRate: number
        lastSampleAt: number | null
        errorCount: number
      }
    >
    timestamp: number
    windowSeconds: number
  }
  timestamp: number
}
