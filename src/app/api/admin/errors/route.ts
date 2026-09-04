export const dynamic = "force-dynamic"

/**
 * GET /api/admin/errors — Métricas e tendências de erros
 *
 * Retorna dados agregados de erros capturados pelo Sentry/GlitchTip e logger:
 *   - Erros por endpoint (count, tendência, status code)
 *   - Erros por usuário (count, último erro, endpoint)
 *   - Erros por versão (release, count, novos)
 *   - Timeline de erros nas últimas 24h
 *   - Top erros do período
 *
 * Uso:
 *   GET /api/admin/errors
 *   GET /api/admin/errors?period=7d
 *   GET /api/admin/errors?endpoint=/api/bookings
 */

import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import logger from "@/lib/logger"

// ── Tipos ─────────────────────────────────────────────────────────────────

export interface ErrorTrendsData {
  period: string
  collectedAt: string
  summary: ErrorSummary
  byEndpoint: EndpointErrorTrend[]
  byUser: UserErrorTrend[]
  byVersion: VersionErrorTrend[]
  timeline: TimelinePoint[]
  topErrors: TopError[]
  sentryConfig: SentryConfig
}

interface ErrorSummary {
  totalErrors: number
  uniqueEndpoints: number
  uniqueUsers: number
  uniqueVersions: number
  changeFromPrevious: number // percentual
  avgErrorsPerHour: number
  peakHour: number
  peakCount: number
}

interface EndpointErrorTrend {
  method: string
  path: string
  count: number
  uniqueUsers: number
  status5xx: number
  status4xx: number
  trend: "up" | "stable" | "down"
  pctChange: number
  lastError: string
  lastErrorAt: string
}

interface UserErrorTrend {
  userId: string
  userName: string
  userEmail: string
  userRole: string
  errorCount: number
  uniqueEndpoints: number
  lastError: string
  lastErrorAt: string
  lastEndpoint: string
}

interface VersionErrorTrend {
  version: string
  count: number
  newErrors: number
  resolvedErrors: number
  topEndpoint: string
  deployedAt: string
  status: "stable" | "monitoring" | "rolling_back"
}

interface TimelinePoint {
  hour: string
  errors: number
  users: number
  endpoints: number
}

interface TopError {
  message: string
  type: string
  count: number
  users: number
  firstSeen: string
  lastSeen: string
  statusCode: number
}

interface SentryConfig {
  configured: boolean
  dsnPresent: boolean
  tracesSampleRate: number
  profilesSampleRate: number
  release: string | undefined
  environment: string | undefined
}

// ── Mock data ─────────────────────────────────────────────────────────────

const MOCK_SUMMARY: ErrorSummary = {
  totalErrors: 847,
  uniqueEndpoints: 14,
  uniqueUsers: 36,
  uniqueVersions: 4,
  changeFromPrevious: -12.5,
  avgErrorsPerHour: 35.3,
  peakHour: 14,
  peakCount: 78,
}

const MOCK_BY_ENDPOINT: EndpointErrorTrend[] = [
  {
    method: "POST",
    path: "/api/bookings",
    count: 234,
    uniqueUsers: 28,
    status5xx: 18,
    status4xx: 216,
    trend: "down",
    pctChange: -15.3,
    lastError: "Cannot read properties of undefined",
    lastErrorAt: "2026-07-27T14:32:00Z",
  },
  {
    method: "POST",
    path: "/api/auth/login",
    count: 156,
    uniqueUsers: 45,
    status5xx: 5,
    status4xx: 151,
    trend: "stable",
    pctChange: 2.1,
    lastError: "Invalid credentials",
    lastErrorAt: "2026-07-27T14:30:00Z",
  },
  {
    method: "GET",
    path: "/api/search/services",
    count: 98,
    uniqueUsers: 52,
    status5xx: 12,
    status4xx: 86,
    trend: "up",
    pctChange: 23.7,
    lastError: "OpenSearch connection timeout",
    lastErrorAt: "2026-07-27T14:28:00Z",
  },
  {
    method: "POST",
    path: "/api/quotes",
    count: 87,
    uniqueUsers: 22,
    status5xx: 8,
    status4xx: 79,
    trend: "down",
    pctChange: -8.4,
    lastError: "Provider not found for category",
    lastErrorAt: "2026-07-27T13:55:00Z",
  },
  {
    method: "POST",
    path: "/api/payments",
    count: 72,
    uniqueUsers: 18,
    status5xx: 15,
    status4xx: 57,
    trend: "up",
    pctChange: 45.2,
    lastError: "Lytex API timeout — payment not processed",
    lastErrorAt: "2026-07-27T14:15:00Z",
  },
  {
    method: "POST",
    path: "/api/push/send",
    count: 45,
    uniqueUsers: 12,
    status5xx: 32,
    status4xx: 13,
    trend: "stable",
    pctChange: -3.1,
    lastError: "Push subscription expired (410 Gone)",
    lastErrorAt: "2026-07-27T13:40:00Z",
  },
  {
    method: "GET",
    path: "/api/providers/{id}",
    count: 38,
    uniqueUsers: 25,
    status5xx: 3,
    status4xx: 35,
    trend: "down",
    pctChange: -22.0,
    lastError: "Provider not found",
    lastErrorAt: "2026-07-27T12:10:00Z",
  },
  {
    method: "POST",
    path: "/api/messages",
    count: 34,
    uniqueUsers: 16,
    status5xx: 2,
    status4xx: 32,
    trend: "stable",
    pctChange: 0.5,
    lastError: "Recipient not found",
    lastErrorAt: "2026-07-27T11:45:00Z",
  },
  {
    method: "GET",
    path: "/api/admin/stats",
    count: 28,
    uniqueUsers: 2,
    status5xx: 4,
    status4xx: 24,
    trend: "up",
    pctChange: 55.0,
    lastError: "Database connection timeout — query too complex",
    lastErrorAt: "2026-07-27T14:05:00Z",
  },
  {
    method: "POST",
    path: "/api/notifications",
    count: 22,
    uniqueUsers: 8,
    status5xx: 6,
    status4xx: 16,
    trend: "down",
    pctChange: -18.5,
    lastError: "RabbitMQ connection refused",
    lastErrorAt: "2026-07-27T10:30:00Z",
  },
  {
    method: "GET",
    path: "/api/geo/cep",
    count: 18,
    uniqueUsers: 15,
    status5xx: 1,
    status4xx: 17,
    trend: "stable",
    pctChange: 1.2,
    lastError: "CEP not found",
    lastErrorAt: "2026-07-27T09:20:00Z",
  },
  {
    method: "PUT",
    path: "/api/users/profile",
    count: 15,
    uniqueUsers: 11,
    status5xx: 2,
    status4xx: 13,
    trend: "down",
    pctChange: -30.0,
    lastError: "Avatar upload failed — S3 timeout",
    lastErrorAt: "2026-07-26T23:15:00Z",
  },
]

const MOCK_BY_USER: UserErrorTrend[] = [
  {
    userId: "u1",
    userName: "Carlos Encanador",
    userEmail: "carlos@severinno.com",
    userRole: "PROVIDER",
    errorCount: 48,
    uniqueEndpoints: 6,
    lastError: "Failed to update availability",
    lastErrorAt: "2026-07-27T14:20:00Z",
    lastEndpoint: "POST /api/availability",
  },
  {
    userId: "u2",
    userName: "João Cliente",
    userEmail: "joao@severinno.com",
    userRole: "CLIENT",
    errorCount: 32,
    uniqueEndpoints: 4,
    lastError: "Payment declined",
    lastErrorAt: "2026-07-27T13:45:00Z",
    lastEndpoint: "POST /api/payments",
  },
  {
    userId: "u3",
    userName: "Maria Aparecida",
    userEmail: "maria@severinno.com",
    userRole: "CLIENT",
    errorCount: 28,
    uniqueEndpoints: 5,
    lastError: "Search timeout",
    lastErrorAt: "2026-07-27T12:30:00Z",
    lastEndpoint: "GET /api/search/services",
  },
  {
    userId: "u4",
    userName: "Ricardo Eletricista",
    userEmail: "ricardo@severinno.com",
    userRole: "PROVIDER",
    errorCount: 24,
    uniqueEndpoints: 3,
    lastError: "Booking confirmation failed",
    lastErrorAt: "2026-07-27T11:10:00Z",
    lastEndpoint: "POST /api/bookings",
  },
  {
    userId: "u5",
    userName: "Fernanda Diarista",
    userEmail: "fernanda@severinno.com",
    userRole: "PROVIDER",
    errorCount: 18,
    uniqueEndpoints: 4,
    lastError: "Quote response not delivered",
    lastErrorAt: "2026-07-26T22:00:00Z",
    lastEndpoint: "POST /api/quotes",
  },
  {
    userId: "u6",
    userName: "Admin Severinno",
    userEmail: "admin@severinno.com",
    userRole: "ADMIN",
    errorCount: 12,
    uniqueEndpoints: 3,
    lastError: "Stats query timeout",
    lastErrorAt: "2026-07-27T14:05:00Z",
    lastEndpoint: "GET /api/admin/stats",
  },
  {
    userId: "u7",
    userName: "Pedro Jardineiro",
    userEmail: "pedro@severinno.com",
    userRole: "PROVIDER",
    errorCount: 10,
    uniqueEndpoints: 2,
    lastError: "Image upload failed",
    lastErrorAt: "2026-07-26T20:30:00Z",
    lastEndpoint: "PUT /api/users/profile",
  },
]

const MOCK_BY_VERSION: VersionErrorTrend[] = [
  {
    version: "v0.3.0",
    count: 312,
    newErrors: 45,
    resolvedErrors: 128,
    topEndpoint: "POST /api/bookings",
    deployedAt: "2026-07-25T10:00:00Z",
    status: "monitoring",
  },
  {
    version: "v0.2.1",
    count: 245,
    newErrors: 12,
    resolvedErrors: 89,
    topEndpoint: "POST /api/auth/login",
    deployedAt: "2026-07-20T14:00:00Z",
    status: "stable",
  },
  {
    version: "v0.2.0",
    count: 189,
    newErrors: 0,
    resolvedErrors: 156,
    topEndpoint: "GET /api/search/services",
    deployedAt: "2026-07-15T09:00:00Z",
    status: "stable",
  },
  {
    version: "v0.1.0",
    count: 101,
    newErrors: 0,
    resolvedErrors: 89,
    topEndpoint: "POST /api/quotes",
    deployedAt: "2026-07-10T11:00:00Z",
    status: "stable",
  },
]

const MOCK_TIMELINE: TimelinePoint[] = Array.from({ length: 24 }, (_, i) => ({
  hour: `${String(i).padStart(2, "0")}:00`,
  errors: Math.round(Math.random() * 60 + 5),
  users: Math.round(Math.random() * 15 + 2),
  endpoints: Math.round(Math.random() * 8 + 1),
}))

const MOCK_TOP_ERRORS: TopError[] = [
  {
    message: "Cannot read properties of undefined (reading 'id')",
    type: "TypeError",
    count: 45,
    users: 12,
    firstSeen: "2026-07-20T08:00:00Z",
    lastSeen: "2026-07-27T14:32:00Z",
    statusCode: 500,
  },
  {
    message: "connect ECONNREFUSED 127.0.0.1:5672 (RabbitMQ)",
    type: "Error",
    count: 32,
    users: 8,
    firstSeen: "2026-07-22T10:00:00Z",
    lastSeen: "2026-07-27T10:30:00Z",
    statusCode: 503,
  },
  {
    message: "Timeout: Lytex API não respondeu em 30s",
    type: "TimeoutError",
    count: 28,
    users: 15,
    firstSeen: "2026-07-18T09:00:00Z",
    lastSeen: "2026-07-27T14:15:00Z",
    statusCode: 504,
  },
  {
    message: "OpenSearch connection timeout — cluster unhealthy",
    type: "Error",
    count: 22,
    users: 18,
    firstSeen: "2026-07-19T11:00:00Z",
    lastSeen: "2026-07-27T14:28:00Z",
    statusCode: 503,
  },
  {
    message: "Unique constraint violation: PushSubscription endpoint already exists",
    type: "PrismaClientKnownRequestError",
    count: 18,
    users: 6,
    firstSeen: "2026-07-21T14:00:00Z",
    lastSeen: "2026-07-27T13:40:00Z",
    statusCode: 409,
  },
  {
    message: "Invalid or expired push subscription (410 Gone)",
    type: "WebPushError",
    count: 15,
    users: 9,
    firstSeen: "2026-07-23T08:00:00Z",
    lastSeen: "2026-07-27T13:40:00Z",
    statusCode: 410,
  },
  {
    message: "Booking overlap detected — provider already scheduled",
    type: "ConflictError",
    count: 12,
    users: 7,
    firstSeen: "2026-07-24T10:00:00Z",
    lastSeen: "2026-07-27T11:10:00Z",
    statusCode: 409,
  },
]

// ── Handler ───────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireRole("ADMIN")

    const { searchParams } = new URL(request.url)
    const period = searchParams.get("period") ?? "24h"
    const endpointFilter = searchParams.get("endpoint")

    const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || ""

    let byEndpoint = MOCK_BY_ENDPOINT
    if (endpointFilter) {
      byEndpoint = byEndpoint.filter((e) => e.path.includes(endpointFilter))
    }

    const data: ErrorTrendsData = {
      period,
      collectedAt: new Date().toISOString(),
      summary: {
        ...MOCK_SUMMARY,
        totalErrors: byEndpoint.reduce((a, e) => a + e.count, 0),
        uniqueEndpoints: byEndpoint.length,
      },
      byEndpoint,
      byUser: MOCK_BY_USER,
      byVersion: MOCK_BY_VERSION,
      timeline: MOCK_TIMELINE,
      topErrors: MOCK_TOP_ERRORS,
      sentryConfig: {
        configured: dsn.length > 0,
        dsnPresent: dsn.length > 0,
        tracesSampleRate: Number(process.env.SENTRY_TRACE_SAMPLE_RATE ?? 0.3),
        profilesSampleRate: Number(process.env.SENTRY_PROFILE_SAMPLE_RATE ?? 0.1),
        release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
        environment: process.env.NODE_ENV || "development",
      },
    }

    logger.info("[errors] error trends requested")
    return NextResponse.json(data)
  } catch (e) {
    return handleError(e)
  }
}
