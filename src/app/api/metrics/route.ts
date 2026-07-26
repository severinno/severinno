/**
 * GET /api/metrics
 *
 * Operational metrics endpoint for monitoring dashboards and alerting.
 * Exposes:
 *   - Cache hit/miss ratio from Redis module
 *   - Uptime
 *   - Memory usage (process)
 *   - Active connections (approximate)
 *
 * This endpoint is intentionally lightweight and does NOT depend on
 * external services (DB, Redis) so it remains available during outages.
 *
 * Auth: publicly accessible (no auth required).
 */

import { NextResponse } from "next/server"
import { getCacheStats } from "@/lib/redis"
import logger from "@/lib/logger"

type MetricsResponse = {
  cache: {
    hits: number
    misses: number
    total: number
    hitRatio: number | null
  }
  process: {
    uptime: number
    memoryRss: number
    memoryHeapUsed: number
    memoryHeapTotal: number
    cpuUser: number
    cpuSystem: number
  }
  timestamp: string
}

export async function GET(): Promise<NextResponse<MetricsResponse>> {
  const start = Date.now()

  const cacheStats = getCacheStats()
  const memory = process.memoryUsage()
  const cpu = process.cpuUsage()

  const response: MetricsResponse = {
    cache: cacheStats,
    process: {
      uptime: Math.floor(process.uptime()),
      memoryRss: memory.rss,
      memoryHeapUsed: memory.heapUsed,
      memoryHeapTotal: memory.heapTotal,
      cpuUser: cpu.user,
      cpuSystem: cpu.system,
    },
    timestamp: new Date().toISOString(),
  }

  const elapsed = Date.now() - start
  logger.debug({ elapsed }, "metrics endpoint")

  return NextResponse.json(response)
}
