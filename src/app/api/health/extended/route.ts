import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { RedisGeoCache } from "@/lib/redis-geo"
import { AlertingService } from "@/lib/alerting-service"

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
    const osrmUrl = process.env.OSRM_URL || process.env.OSRM_BASE_URL || "http://127.0.0.1:5000"
    const res = await fetch(
      `${osrmUrl}/route/v1/driving/-41.9484,-18.8414;-41.9443,-18.8546?overview=false`,
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

  // 4. WhatsApp Session Heartbeat Check (Evolution API)
  try {
    const { checkWhatsAppSessionHeartbeat } = await import("@/lib/evolution")
    const waHeartbeat = await checkWhatsAppSessionHeartbeat()
    checks.whatsappSession = {
      status: waHeartbeat.connected
        ? "UP"
        : waHeartbeat.status === "unconfigured"
          ? "DEGRADED"
          : "DOWN",
      latencyMs: waHeartbeat.latencyMs,
      details: waHeartbeat.connected
        ? `Conectado (Instância: ${waHeartbeat.instanceName})`
        : `Desconectado (Status: ${waHeartbeat.status})${waHeartbeat.error ? ` - ${waHeartbeat.error}` : ""}`,
    }
  } catch (err) {
    checks.whatsappSession = {
      status: "DEGRADED",
      latencyMs: 0,
      details: err instanceof Error ? err.message : "Falha ao consultar Evolution API",
    }
  }

  // 5. External Integrations Readiness Check
  const hasLytex = !!(
    process.env.LYTEX_CLIENT_ID &&
    (process.env.LYTEX_SECRET || process.env.LYTEX_CLIENT_SECRET)
  )
  const hasEvolution = !!(process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_INSTANCE)
  const hasSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_PASS)
  checks.externalIntegrations = {
    status: hasLytex && hasEvolution && hasSmtp ? "UP" : "DEGRADED",
    latencyMs: 0,
    details: [
      hasLytex ? "Lytex: pronto" : "Lytex: pendente credenciais",
      hasEvolution ? "WhatsApp: pronto" : "WhatsApp: pendente credenciais",
      hasSmtp ? "SMTP: pronto" : "SMTP: pendente credenciais",
    ].join(" | "),
  }

  // 6. Local AI Contingency Health Probe (Ollama / LocalAI)
  try {
    const { checkLocalAiHealth } = await import("@/lib/ai-client")
    const aiProbe = await checkLocalAiHealth()
    checks.localAi = {
      status: aiProbe.status,
      latencyMs: aiProbe.latencyMs,
      details: aiProbe.details,
    }
  } catch (err) {
    checks.localAi = {
      status: "DEGRADED",
      latencyMs: 0,
      details: err instanceof Error ? err.message : "Falha ao consultar Ollama local",
    }
  }

  // 7. Circuit Breakers Status
  try {
    const { getAllCircuitBreakersStats } = await import("@/lib/circuit-breaker")
    const cbStats = getAllCircuitBreakersStats()
    const openCircuits = cbStats.filter((c) => c.state === "open")
    if (openCircuits.length > 0) {
      hasDegradation = true
      checks.circuitBreakers = {
        status: "DEGRADED",
        latencyMs: 0,
        details: `${openCircuits.length} circuito(s) aberto(s): ${openCircuits.map((c) => c.name).join(", ")}`,
      }
    } else {
      checks.circuitBreakers = {
        status: "UP",
        latencyMs: 0,
        details: `${cbStats.length} circuitos saudáveis (CLOSED)`,
      }
    }
  } catch {
    // circuit breaker module load failed
  }

  // 8. Core Web Vitals SLA
  try {
    const { webVitalsRegistry } = await import("@/lib/web-vitals-registry")
    const wv = webVitalsRegistry.getSummary()
    checks.webVitals = {
      status: wv.complianceScore >= 70 ? "UP" : "DEGRADED",
      latencyMs: 0,
      details: `Compliance SLA: ${wv.complianceScore}% (${wv.totalSamples} amostras)`,
    }
  } catch {
    // web vitals module load failed
  }

  // 9. Memory & Process Stats
  const mem = process.memoryUsage()
  const memoryStats = {
    rssMb: Math.round(mem.rss / 1024 / 1024),
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
  }

  const overallStatus = hasFailure ? "UNHEALTHY" : hasDegradation ? "DEGRADED" : "HEALTHY"
  const totalDurationMs = Math.round(performance.now() - startTime)

  if (hasFailure) {
    void AlertingService.reportOutage(
      "Database/Core",
      checks.database?.details ?? "Falha crítica na infraestrutura",
    )
  }

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
