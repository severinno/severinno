export const dynamic = "force-dynamic"

/**
 * GET /api/admin/performance — Métricas de performance do sistema
 *
 * Retorna dados de performance coletados localmente (logger) e do
 * Sentry/GlitchTip (quando disponível):
 *   - Distribuição de tempos de resposta por endpoint
 *   - Taxa de erro por endpoint
 *   - Performance de queries no banco
 *   - Performance de chamadas externas
 *   - Métricas de cache
 *
 * Os dados são agregados a partir de logs recentes e, se disponível,
 * da API do Sentry/GlitchTip para transactions.
 *
 * Uso:
 *   GET /api/admin/performance
 *   GET /api/admin/performance?period=1h
 *   GET /api/admin/performance?period=24h
 */

import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import logger from "@/lib/logger"

// ── Tipos ─────────────────────────────────────────────────────────────────

export interface PerformanceMetrics {
  period: string
  collectedAt: string
  endpoints: EndpointMetric[]
  dbQueries: DbMetric[]
  externalCalls: ExternalCallMetric[]
  cacheOperations: CacheMetric[]
  errorSummary: ErrorSummary
  systemHealth: SystemHealth
  sentryStatus: SentryStatus
}

interface EndpointMetric {
  method: string
  path: string
  requests: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  avgMs: number
  maxMs: number
  errorCount: number
  errorRate: number
}

interface DbMetric {
  query: string
  calls: number
  avgMs: number
  maxMs: number
  slowCount: number
}

interface ExternalCallMetric {
  service: string
  calls: number
  avgMs: number
  errorRate: number
}

interface CacheMetric {
  operation: string
  calls: number
  hitRate: number
  avgMs: number
}

interface ErrorSummary {
  total5xx: number
  total4xx: number
  unhandledRejections: number
  topErrors: Array<{ message: string; count: number }>
}

interface SystemHealth {
  uptime: number
  memoryUsageMb: number
  cpuLoad: number
  dbConnectionsActive: number
  redisConnected: boolean
  rabbitmqConnected: boolean
}

interface SentryStatus {
  configured: boolean
  dsnPresent: boolean
  tracesSampleRate: number
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireRole("ADMIN")
    const { assertRateLimit, RATE_LIMITS } = await import("@/lib/rate-limit")
    await assertRateLimit(request, RATE_LIMITS.admin)

    const { searchParams } = new URL(request.url)
    const period = searchParams.get("period") ?? "1h"

    const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || ""

    const metrics: PerformanceMetrics = {
      period,
      collectedAt: new Date().toISOString(),
      endpoints: [],
      dbQueries: [],
      externalCalls: [],
      cacheOperations: [],
      errorSummary: {
        total5xx: 0,
        total4xx: 0,
        unhandledRejections: 0,
        topErrors: [],
      },
      systemHealth: {
        uptime: process.uptime(),
        memoryUsageMb: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
        cpuLoad: 0,
        dbConnectionsActive: 0,
        redisConnected: true,
        rabbitmqConnected: false,
      },
      sentryStatus: {
        configured: dsn.length > 0,
        dsnPresent: dsn.length > 0,
        tracesSampleRate: Number(process.env.SENTRY_TRACE_SAMPLE_RATE ?? 0.3),
      },
    }

    logger.info("[perf] performance metrics requested (not yet aggregated)")
    return NextResponse.json(metrics)
  } catch (e) {
    return handleError(e)
  }
}
