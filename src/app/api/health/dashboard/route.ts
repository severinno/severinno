/**
 * Consolidated Health Dashboard — single endpoint for all system health
 */
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getClient, getCacheStats } from "@/lib/redis"
import { exportMetrics } from "@/lib/metrics"
import { getSlowQueryMetrics } from "@/lib/db-query-monitor"
import { getErrorBudget } from "@/lib/error-budget"
import { getGeoMetrics } from "@/lib/geo-metrics"
import { nominatimBreaker, viacepBreaker, osrmBreaker, osrmTableBreaker } from "@/lib/geo-circuit-breakers"
import { evolutionBreaker, pushBreaker, emailBreaker } from "@/lib/external-circuit-breakers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const start = Date.now()

  const [dbOk, redisOk] = await Promise.allSettled([
    (async () => { await db.$queryRaw`SELECT 1`; return true })(),
    Promise.resolve(getClient()?.ping()).then(() => true).catch(() => false),
  ])

  const latencyMs = Date.now() - start

  const dbStatus = dbOk.status === "fulfilled" && dbOk.value ? "healthy" : "unhealthy"
  const redisStatus = redisOk.status === "fulfilled" && redisOk.value ? "healthy" : "degraded"

  type HealthStatus = "healthy" | "degraded" | "unhealthy"

  const overallStatus: HealthStatus = dbStatus === "unhealthy"
    ? "unhealthy"
    : redisStatus === "degraded"
      ? "degraded"
      : "healthy"

  const dashboard = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    latencyMs,
    services: {
      database: { status: dbStatus as HealthStatus },
      redis: { status: redisStatus as HealthStatus },
    },
    metrics: exportMetrics(),
    slowQueries: getSlowQueryMetrics(),
    circuitBreakers: {
      geo: {
        nominatim: nominatimBreaker.getStats(),
        viacep: viacepBreaker.getStats(),
        osrm: osrmBreaker.getStats(),
        osrmTable: osrmTableBreaker.getStats(),
      },
      external: {
        evolution: evolutionBreaker.getStats(),
        push: pushBreaker.getStats(),
        email: emailBreaker.getStats(),
      },
    },
    errorBudget: getErrorBudget(),
    geo: getGeoMetrics(),
    cache: getCacheStats(),
  }

  return NextResponse.json(dashboard, {
    status: overallStatus === "unhealthy" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  })
}
