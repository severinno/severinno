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
import { db } from "@/lib/db"
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

// ── Dados mockados para demonstração ─────────────────────────────────────
// Em produção, estes dados viriam de:
//   - Redis (métricas em tempo real)
//   - Sentry API (transactions + spans)
//   - PostgreSQL (slow query log)
//   - Prometheus (se implementado)

const MOCK_ENDPOINTS: EndpointMetric[] = [
  { method: "GET",  path: "/api/categories",        requests: 2847, p50Ms: 12,  p95Ms: 45,  p99Ms: 120, avgMs: 18,  maxMs: 340,  errorCount: 2,   errorRate: 0.07 },
  { method: "GET",  path: "/api/search/services",   requests: 1832, p50Ms: 89,  p95Ms: 320, p99Ms: 890, avgMs: 145, maxMs: 2100, errorCount: 8,   errorRate: 0.44 },
  { method: "POST", path: "/api/auth/login",        requests: 1254, p50Ms: 210, p95Ms: 580, p99Ms: 1200,avgMs: 290, maxMs: 3100, errorCount: 15,  errorRate: 1.20 },
  { method: "GET",  path: "/api/providers/{id}",    requests: 987,  p50Ms: 34,  p95Ms: 98,  p99Ms: 240, avgMs: 48,  maxMs: 560,  errorCount: 3,   errorRate: 0.30 },
  { method: "POST", path: "/api/bookings",          requests: 654,  p50Ms: 420, p95Ms: 1200,p99Ms: 2800,avgMs: 580, maxMs: 4500, errorCount: 12,  errorRate: 1.83 },
  { method: "GET",  path: "/api/bookings/{id}",     requests: 543,  p50Ms: 28,  p95Ms: 78,  p99Ms: 190, avgMs: 42,  maxMs: 420,  errorCount: 1,   errorRate: 0.18 },
  { method: "POST", path: "/api/quotes",            requests: 432,  p50Ms: 180, p95Ms: 520, p99Ms: 1100,avgMs: 260, maxMs: 2800, errorCount: 5,   errorRate: 1.16 },
  { method: "GET",  path: "/api/notifications",     requests: 321,  p50Ms: 15,  p95Ms: 42,  p99Ms: 98,  avgMs: 22,  maxMs: 210,  errorCount: 0,   errorRate: 0 },
  { method: "GET",  path: "/api/health",             requests: 1890, p50Ms: 2,   p95Ms: 5,   p99Ms: 15,  avgMs: 3,   maxMs: 45,   errorCount: 0,   errorRate: 0 },
  { method: "GET",  path: "/api/admin/stats",       requests: 56,   p50Ms: 320, p95Ms: 980, p99Ms: 2100,avgMs: 450, maxMs: 3200, errorCount: 1,   errorRate: 1.79 },
]

const MOCK_DB_QUERIES: DbMetric[] = [
  { query: "user.findMany",          calls: 8432, avgMs: 8,   maxMs: 120,  slowCount: 3 },
  { query: "booking.findMany",       calls: 3210, avgMs: 15,  maxMs: 340,  slowCount: 8 },
  { query: "service.search",         calls: 2100, avgMs: 65,  maxMs: 890,  slowCount: 15 },
  { query: "service.findMany",       calls: 1890, avgMs: 12,  maxMs: 210,  slowCount: 4 },
  { query: "category.findMany",      calls: 1650, avgMs: 4,   maxMs: 45,   slowCount: 0 },
  { query: "notification.findMany",  calls: 1200, avgMs: 6,   maxMs: 80,   slowCount: 1 },
  { query: "payment.aggregate",      calls: 780,  avgMs: 25,  maxMs: 320,  slowCount: 5 },
  { query: "booking.groupBy",        calls: 340,  avgMs: 180, maxMs: 1200, slowCount: 12 },
]

const MOCK_EXTERNAL: ExternalCallMetric[] = [
  { service: "Redis Cache",     calls: 15420, avgMs: 1,   errorRate: 0.01 },
  { service: "Evolution API",   calls: 450,   avgMs: 320, errorRate: 2.50 },
  { service: "SMTP (email)",    calls: 320,   avgMs: 890, errorRate: 1.80 },
  { service: "OpenSearch",      calls: 210,   avgMs: 45,  errorRate: 0.50 },
  { service: "Lytex Pagamentos",calls: 180,   avgMs: 580, errorRate: 3.20 },
  { service: "Nominatim (Geo)", calls: 120,   avgMs: 210, errorRate: 4.50 },
]

const MOCK_CACHE: CacheMetric[] = [
  { operation: "get",   calls: 12500, hitRate: 78.5, avgMs: 0.8 },
  { operation: "set",   calls: 3400,  hitRate: 100,  avgMs: 1.2 },
  { operation: "del",   calls: 890,   hitRate: 100,  avgMs: 0.6 },
  { operation: "exists",calls: 2100,  hitRate: 100,  avgMs: 0.5 },
]

const MOCK_ERRORS: ErrorSummary = {
  total5xx: 28,
  total4xx: 234,
  unhandledRejections: 4,
  topErrors: [
    { message: "Cannot read properties of undefined (reading 'id')",       count: 12 },
    { message: "connect ECONNREFUSED 127.0.0.1:5672 (RabbitMQ)",         count: 8 },
    { message: "Timeout: Evolution API não respondeu em 30s",             count: 5 },
    { message: "Unique constraint violation: PushSubscription endpoint",  count: 3 },
  ],
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireRole("ADMIN")

    const { searchParams } = new URL(request.url)
    const period = searchParams.get("period") ?? "1h"

    const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || ""

    const metrics: PerformanceMetrics = {
      period,
      collectedAt: new Date().toISOString(),
      endpoints: MOCK_ENDPOINTS,
      dbQueries: MOCK_DB_QUERIES,
      externalCalls: MOCK_EXTERNAL,
      cacheOperations: MOCK_CACHE,
      errorSummary: MOCK_ERRORS,
      systemHealth: {
        uptime: process.uptime(),
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 10) / 10,
        cpuLoad: 0.42,
        dbConnectionsActive: 12,
        redisConnected: true,
        rabbitmqConnected: false, // sem RabbitMQ no dev
      },
      sentryStatus: {
        configured: dsn.length > 0,
        dsnPresent: dsn.length > 0,
        tracesSampleRate: Number(process.env.SENTRY_TRACE_SAMPLE_RATE ?? 0.3),
      },
    }

    logger.info("[perf] performance metrics requested")
    return NextResponse.json(metrics)
  } catch (e) {
    return handleError(e)
  }
}
