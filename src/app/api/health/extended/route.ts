import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { RedisGeoCache } from "@/lib/redis-geo"

export const dynamic = "force-dynamic"

export async function GET() {
  const startTime = performance.now()
  const checks: Record<
    string,
    { status: "UP" | "DOWN" | "DEGRADED"; latencyMs: number; details?: string }
  > = {}

  let hasFailure = false
  let hasDegradation = false

  // 1. PostgreSQL + PostGIS Check
  const dbStart = performance.now()
  try {
    const userCount = await db.user.count()
    const postgisCheck: Array<{ extname: string; extversion: string }> = await db.$queryRaw`
      SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis';
    `
    const dbLatency = Math.round(performance.now() - dbStart)
    const hasPostGIS = postgisCheck && postgisCheck.length > 0

    checks.database = {
      status: "UP",
      latencyMs: dbLatency,
      details: `${userCount} usuários indexados. PostGIS ${hasPostGIS ? `v${postgisCheck[0].extversion}` : "inativo (fallback ativo)"}`,
    }
  } catch (err) {
    const dbLatency = Math.round(performance.now() - dbStart)
    hasFailure = true
    checks.database = {
      status: "DOWN",
      latencyMs: dbLatency,
      details: err instanceof Error ? err.message : "Falha na conexão PostgreSQL",
    }
  }

  // 2. Redis GEO Subsystem Check
  const redisStart = performance.now()
  try {
    const redisStats = await RedisGeoCache.getStats()
    const redisLatency = Math.round(performance.now() - redisStart)

    checks.redisGeo = {
      status: "UP",
      latencyMs: redisLatency,
      details: `${redisStats.cachedLocations} coordenadas no grid. Tipo: ${redisStats.engine}`,
    }
  } catch {
    const redisLatency = Math.round(performance.now() - redisStart)
    hasDegradation = true
    checks.redisGeo = {
      status: "DEGRADED",
      latencyMs: redisLatency,
      details: "Em fallback in-memory",
    }
  }

  // 3. OSRM Road Routing Check
  const osrmStart = performance.now()
  try {
    const osrmUrl = process.env.OSRM_URL || "http://router.project-osrm.org"
    const res = await fetch(
      `${osrmUrl}/route/v1/driving/-46.6565,-23.5615;-46.6855,-23.5670?overview=false`,
      {
        signal: AbortSignal.timeout(2500),
      },
    )
    const osrmLatency = Math.round(performance.now() - osrmStart)

    if (res.ok) {
      checks.osrmRouting = {
        status: "UP",
        latencyMs: osrmLatency,
        details: "Servidor de rotas operando normalmente",
      }
    } else {
      hasDegradation = true
      checks.osrmRouting = {
        status: "DEGRADED",
        latencyMs: osrmLatency,
        details: `HTTP ${res.status}. Fallback Haversine ativo`,
      }
    }
  } catch {
    const osrmLatency = Math.round(performance.now() - osrmStart)
    hasDegradation = true
    checks.osrmRouting = {
      status: "DEGRADED",
      latencyMs: osrmLatency,
      details: "Fallback Haversine urbano ativo",
    }
  }

  // 4. Memory & Process Stats
  const mem = process.memoryUsage()
  const memoryStats = {
    rssMb: Math.round(mem.rss / 1024 / 1024),
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
  }

  const overallStatus = hasFailure ? "UNHEALTHY" : hasDegradation ? "DEGRADED" : "HEALTHY"
  const totalDurationMs = Math.round(performance.now() - startTime)

  return NextResponse.json(
    {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      totalDurationMs,
      services: checks,
      system: {
        memory: memoryStats,
        nodeVersion: process.version,
        env: process.env.NODE_ENV || "development",
      },
    },
    {
      status: hasFailure ? 503 : 200,
    },
  )
}
