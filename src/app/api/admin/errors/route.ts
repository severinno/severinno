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

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"

import logger from "@/lib/logger"

import { withRoute } from "@/lib/api-route"

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

// ── Handler ───────────────────────────────────────────────────────────────

export const GET = withRoute("api.admin.errors.GET", async (request) => {
  await requireRole("ADMIN")
  const { assertRateLimit, RATE_LIMITS } = await import("@/lib/rate-limit")
  await assertRateLimit(request, RATE_LIMITS.admin)

  const { searchParams } = new URL(request.url)
  const period = searchParams.get("period") ?? "24h"

  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || ""

  // Error aggregation not yet connected — return real config + empty data
  const data: ErrorTrendsData = {
    period,
    collectedAt: new Date().toISOString(),
    summary: {
      totalErrors: 0,
      uniqueEndpoints: 0,
      uniqueUsers: 0,
      uniqueVersions: 0,
      changeFromPrevious: 0,
      avgErrorsPerHour: 0,
      peakHour: 0,
      peakCount: 0,
    },
    byEndpoint: [],
    byUser: [],
    byVersion: [],
    timeline: [],
    topErrors: [],
    sentryConfig: {
      configured: dsn.length > 0,
      dsnPresent: dsn.length > 0,
      tracesSampleRate: Number(process.env.SENTRY_TRACE_SAMPLE_RATE ?? 0.3),
      profilesSampleRate: Number(process.env.SENTRY_PROFILE_SAMPLE_RATE ?? 0.1),
      release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      environment: process.env.NODE_ENV || "development",
    },
  }

  logger.info("[errors] error trends requested (not yet aggregated)")
  return NextResponse.json(data)
})
