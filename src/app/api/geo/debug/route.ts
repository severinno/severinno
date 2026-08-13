/**
 * GET /api/geo/debug
 *
 * Debug endpoint that exposes internal geo module state for quick diagnosis
 * without SSH access to the server.
 *
 * All data is read from in-process memory — no external API calls, no DB
 * queries, no Redis operations.  Fast and safe (sub-ms response).
 *
 * This endpoint is NOT authenticated because it's designed to help debug
 * auth issues.  In production, restrict it via middleware or firewall.
 *
 * Response shape:
 * ```json
 * {
 *   "server": {
 *     "uptime": 12345,
 *     "platform": "linux",
 *     "nodeVersion": "v22.14.0",
 *     "timestamp": "2026-04-13T10:00:00.000Z"
 *   },
 *   "redis": {
 *     "available": true,
 *     "hits": 1200,
 *     "misses": 80,
 *     "hitRatio": 0.9375,
 *     "memoryStoreSize": 45
 *   },
 *   "queryLog": {
 *     "totalSearches": 5000,
 *     "uniqueSearches": 320,
 *     "totalCEPs": 1000,
 *     "uniqueCEPs": 150,
 *     "totalReverses": 200,
 *     "pendingChanges": 0,
 *     "topSearches": [ ... ],
 *     "topCEPs": [ ... ],
 *     "topReverses": [ ... ]
 *   },
 *   "cacheWarm": {
 *     "cities": 25,
 *     "neighborhoods": 5,
 *     "missingCapitals": 6,
 *     "ceps": 15,
 *     "coords": 8,
 *     "totalQueries": 59
 *   },
 *   "rateLimits": {
 *     "search": { "max": 30, "windowMs": 60000 },
 *     "cep": { "max": 60, "windowMs": 60000 },
 *     "reverse": { "max": 30, "windowMs": 60000 }
 *   },
 *   "env": {
 *     "REDIS_CLUSTER_MODE": false,
 *     "GEO_QUERY_LOG_PATH": "...",
 *     "hasRedisUrl": true
 *   }
 * }
 * ```
 */

import { NextResponse } from "next/server"
import { getCacheStats, getMemoryCacheDiagnostics, isRedisAvailable } from "@/lib/redis"
import {
  getQueryLogDiagnostics,
  getTopSearches,
  getTopCEPs,
  getTopReverses,
} from "@/lib/geo-query-log"
import { getWarmConfig, getLastWarmResult, type WarmResult } from "@/lib/geo-cache-warm"
import { GEO_LIMITS } from "@/lib/geo-rate-limit"

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

type DebugResponse = {
  server: {
    uptime: number
    platform: string
    nodeVersion: string
    timestamp: string
  }
  redis: {
    available: boolean | null
    hits: number
    misses: number
    total: number
    hitRatio: number | null
    memoryStoreSize: number
    memoryStoreMaxAgeMs: number | null
  }
  queryLog: {
    totalSearches: number
    uniqueSearches: number
    totalCEPs: number
    uniqueCEPs: number
    totalReverses: number
    uniqueReverses: number
    pendingChanges: number
    logPath: string
    topSearches: Array<{ query: string; count: number }>
    topCEPs: Array<{ cep: string; count: number }>
    topReverses: Array<{ coords: string; count: number }>
  }
  cacheWarm: {
    cities: number
    neighborhoods: number
    missingCapitals: number
    ceps: number
    coords: number
    totalQueries: number
    /** Runtime result of the last warmGeoCache() run, or null if never run. */
    lastRun: (WarmResult & { completedAt: string }) | null
  }
  rateLimits: Record<string, { max: number; windowMs: number }>
  env: {
    REDIS_CLUSTER_MODE: boolean
    hasGeoQueryLogPath: boolean
    hasRedisUrl: boolean
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse<DebugResponse>> {
  // ── Server info (always available, zero-cost) ──────────────────────
  const server = {
    uptime: Math.floor(process.uptime()),
    platform: process.platform,
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  }

  // ── Redis & cache diagnostics ──────────────────────────────────────
  const cacheStats = getCacheStats()
  const memCache = getMemoryCacheDiagnostics()

  const redis = {
    available: isRedisAvailable(),
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    total: cacheStats.total,
    hitRatio: cacheStats.hitRatio,
    memoryStoreSize: cacheStats.memoryStoreSize,
    memoryStoreMaxAgeMs: memCache.maxAgeMs,
  }

  // ── Query log diagnostics ──────────────────────────────────────────
  const logDiag = getQueryLogDiagnostics()

  const queryLog = {
    totalSearches: logDiag.totalSearches,
    uniqueSearches: logDiag.uniqueSearches,
    totalCEPs: logDiag.totalCEPs,
    uniqueCEPs: logDiag.uniqueCEPs,
    totalReverses: logDiag.totalReverses,
    uniqueReverses: logDiag.uniqueReverses,
    pendingChanges: logDiag.pendingChanges,
    logPath: logDiag.logPath,
    topSearches: getTopSearches(10),
    topCEPs: getTopCEPs(10),
    topReverses: getTopReverses(5),
  }

  // ── Cache warming config + runtime status ──────────────────────────
  const cacheWarmConfig = getWarmConfig()
  const cacheWarmLastRun = getLastWarmResult()

  const cacheWarm = {
    ...cacheWarmConfig,
    lastRun: cacheWarmLastRun,
  }

  // ── Rate limit config ──────────────────────────────────────────────
  const rateLimits = Object.fromEntries(
    Object.entries(GEO_LIMITS).map(([key, val]) => [key, { max: val.max, windowMs: val.windowMs }]),
  )

  // ── Relevant env vars (values stripped for security) ───────────────
  const env = {
    REDIS_CLUSTER_MODE: process.env.REDIS_CLUSTER_MODE === "true",
    hasGeoQueryLogPath: !!process.env.GEO_QUERY_LOG_PATH,
    hasRedisUrl: !!process.env.REDIS_URL,
  }

  const response: DebugResponse = {
    server,
    redis,
    queryLog,
    cacheWarm,
    rateLimits,
    env,
  }

  return NextResponse.json(response, {
    headers: {
      // Allow caching for 5s to avoid hammering on rapid refresh,
      // but stale data is better than no data for debugging.
      "Cache-Control": "public, max-age=5, s-maxage=5",
    },
  })
}
