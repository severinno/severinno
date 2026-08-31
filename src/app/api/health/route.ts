import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCacheStats, getClient } from "@/lib/redis"
import { getGeoSettings } from "@/lib/geo-settings"
import { getHealth as getRabbitHealth } from "@/lib/queue"
import logger from "@/lib/logger"
import { getRequestId } from "@/lib/request-context"
import pkg from "../../../../package.json"

// In-memory cache (Redis-independent so it works even when Redis is down)
let inMemoryCache: { timestamp: number; result: HealthResponse } | null = null

const HEALTH_CACHE_TTL = 15

/**
 * Reseta o cache in-memory. Usado pelos testes e pelo POST /api/admin/settings
 * para que a próxima requisição reflita imediatamente as mudanças.
 */
export function resetHealthCache(): void {
  inMemoryCache = null
}

type ServiceStatus = "ok" | "disabled" | "error"

type HealthResponse = {
  status: "ok" | "degraded"
  timestamp: string
  uptime: number
  version: string
  requestId: string | null
  checks: {
    database: ServiceStatus
    redis: ServiceStatus
    rabbitmq: ServiceStatus
    nominatim: ServiceStatus
    viacep: ServiceStatus
    postgis: ServiceStatus
    s3: ServiceStatus
    opensearch: ServiceStatus
    tracing: ServiceStatus
  }
  details: {
    database?: string
    redis?: string
    rabbitmq?: RabbitMQDetail
    nominatim?: string
    viacep?: string
    postgis?: string
    s3?: string
    opensearch?: string
    tracing?: string
  }
  cache: {
    hits: number
    misses: number
    total: number
    hitRatio: number | null
    memoryStoreSize: number
    activeTier: string
    degradationCount: number
  }
  geo: {
    nominatim: string
    viacep: string
    postgis: string
  }
  tracing: {
    enabled: boolean
    exporter: string
    sampleRate: number
  }
}

type RabbitMQDetail = {
  status: string
  connected: boolean
  lastConnectedAt: number | null
  reconnectAttempts: number
  totalReconnectAttempts: number
  heartbeat: number
  uptimeSeconds: number | null
}

export async function GET(): Promise<NextResponse<HealthResponse>> {
  // Try in-memory cache first (fast path)
  if (inMemoryCache && Date.now() - inMemoryCache.timestamp < HEALTH_CACHE_TTL * 1000) {
    return NextResponse.json(inMemoryCache.result, {
      status: inMemoryCache.result.status === "ok" ? 200 : 503,
    })
  }

  const start = Date.now()

  // Run all checks in parallel
  const results = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
    checkRabbitMQ(),
    checkNominatim(),
    checkViaCEP(),
    checkPostGIS(),
    checkS3(),
    checkOpenSearch(),
    checkTracing(),
  ])

  const checks: HealthResponse["checks"] = {
    database: resolveStatus(results[0]),
    redis: resolveStatus(results[1]),
    rabbitmq: resolveStatus(results[2]),
    nominatim: resolveDetailStatus(results[3]),
    viacep: resolveDetailStatus(results[4]),
    postgis: resolveDetailStatus(results[5]),
    s3: resolveStatus(results[6]),
    opensearch: resolveStatus(results[7]),
    tracing: resolveDetailStatus(results[8]),
  }

  const details: HealthResponse["details"] = {
    database: resolvedDetail(results[0]),
    redis: resolvedDetail(results[1]),
    rabbitmq: resolvedObject<RabbitMQDetail>(results[2]),
    nominatim: resolvedDetail(results[3]),
    viacep: resolvedDetail(results[4]),
    postgis: resolvedDetail(results[5]),
    s3: resolvedDetail(results[6]),
    opensearch: resolvedDetail(results[7]),
    tracing: resolvedDetail(results[8]),
  }

  // "disabled" (kill-switch) não conta como degradação
  const isHealthy = (s: ServiceStatus): boolean => s === "ok" || s === "disabled"
  const allOk = Object.values(checks).every(isHealthy)

  const cacheStats = getCacheStats()

  const response: HealthResponse = {
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: pkg.version,
    requestId: getRequestId(),
    checks,
    details,
    cache: {
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      total: cacheStats.total,
      hitRatio: cacheStats.hitRatio,
      memoryStoreSize: cacheStats.memoryStoreSize,
      activeTier: cacheStats.activeTier,
      degradationCount: cacheStats.degradationCount,
    },
    geo: {
      nominatim: details.nominatim ?? "unknown",
      viacep: details.viacep ?? "unknown",
      postgis: details.postgis ?? "unknown",
    },
    tracing: {
      enabled: process.env.OTEL_ENABLED === "true",
      exporter: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "console",
      sampleRate: parseFloat(process.env.OTEL_SAMPLE_RATE || "0.1"),
    },
  }

  // Report degraded state
  if (!allOk) {
    const failedChecks = Object.entries(checks)
      .filter(([, status]) => status === "error")
      .map(([name]) => name)

    logger.error({ failedChecks }, "health check: services degraded")
  }

  // Only cache healthy responses
  if (allOk) {
    inMemoryCache = { timestamp: Date.now(), result: response }
  } else {
    inMemoryCache = null
  }

  const elapsed = Date.now() - start
  logger.info({ elapsed, status: response.status, checks: response.checks }, "health check")

  return NextResponse.json(response, {
    status: response.status === "ok" ? 200 : 503,
  })
}

// ── Helper: resolve PromiseSettledResult ──────────────────────────────────

function resolveStatus(result: PromiseSettledResult<unknown>): ServiceStatus {
  if (result.status === "rejected") return "error"
  const value = result.value as { status?: ServiceStatus }
  if (value === null || value === undefined) return "error"
  return value.status ?? "ok"
}

function resolveDetailStatus(result: PromiseSettledResult<unknown>): ServiceStatus {
  if (result.status === "rejected") return "error"
  const value = result.value as { status?: ServiceStatus }
  return value?.status ?? "ok"
}

function resolvedDetail(result: PromiseSettledResult<unknown>): string {
  if (result.status === "rejected") return "unreachable"
  const value = result.value as { detail?: string }
  return value?.detail ?? "ok"
}

function resolvedObject<T>(result: PromiseSettledResult<unknown>): T | undefined {
  if (result.status === "rejected") return undefined
  return result.value as T
}

// ── Individual checks ──────────────────────────────────────────────────────

async function checkDatabase(): Promise<{ status: ServiceStatus; detail: string }> {
  try {
    await db.$queryRaw`SELECT 1`
    return { status: "ok", detail: "connected" }
  } catch (err) {
    logger.error({ err }, "health: database check failed")
    return { status: "error", detail: (err as Error)?.message ?? "query failed" }
  }
}

async function checkRedis(): Promise<{ status: ServiceStatus; detail: string }> {
  try {
    const client = getClient()
    if (!client) return { status: "error", detail: "no client available" }
    await client.ping()
    return { status: "ok", detail: "pong" }
  } catch (err) {
    return { status: "error", detail: (err as Error)?.message ?? "ping failed" }
  }
}

async function checkRabbitMQ(): Promise<{ status: ServiceStatus; detail: RabbitMQDetail }> {
  try {
    const health = getRabbitHealth()
    // "disconnected" significa que ninguém chamou publish() ainda (lazy init) — isso é OK
    // "reconnecting" é degradado mas não crítico
    // "error" é falha real
    const status: ServiceStatus =
      health.status === "ok"
        ? "ok"
        : health.status === "disconnected"
          ? "ok" // RabbitMQ é opcional — sem workers, lazy init é esperado
          : health.status === "reconnecting"
            ? "error"
            : "error"
    return {
      status,
      detail: {
        status: health.status,
        connected: health.connected,
        lastConnectedAt: health.lastConnectedAt,
        reconnectAttempts: health.reconnectAttempts,
        totalReconnectAttempts: health.totalReconnectAttempts,
        heartbeat: health.heartbeat,
        uptimeSeconds: health.uptimeSeconds,
      },
    }
  } catch (_err) {
    return {
      status: "error",
      detail: {
        status: "error",
        connected: false,
        lastConnectedAt: null,
        reconnectAttempts: 0,
        totalReconnectAttempts: 0,
        heartbeat: 60,
        uptimeSeconds: null,
      },
    }
  }
}

async function checkNominatim(): Promise<{ status: ServiceStatus; detail: string }> {
  try {
    const settings = await getGeoSettings()
    if (!settings.nominatimEnabled) {
      return { status: "disabled", detail: "kill-switch nominatim_enabled=false" }
    }
    const res = await fetch(`${settings.nominatimBaseUrl}/status.php?format=json`, {
      headers: { "User-Agent": settings.userAgent },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { status: "error", detail: `HTTP ${res.status}` }
    const data = (await res.json()) as { status?: number; message?: string }
    if (data.status === 0) return { status: "ok", detail: "online" }
    return { status: "error", detail: data.message || `status ${data.status}` }
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : "timeout" }
  }
}

async function checkViaCEP(): Promise<{ status: ServiceStatus; detail: string }> {
  try {
    const settings = await getGeoSettings()
    if (!settings.viacepEnabled) {
      return { status: "disabled", detail: "kill-switch viacep_enabled=false" }
    }
    const res = await fetch(`${settings.viacepBaseUrl}/ws/01310100/json/`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { status: "error", detail: `HTTP ${res.status}` }
    const data = (await res.json()) as { erro?: boolean }
    if (data.erro) return { status: "error", detail: "unexpected error response" }
    return { status: "ok", detail: "online" }
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : "timeout" }
  }
}

async function checkPostGIS(): Promise<{ status: ServiceStatus; detail: string }> {
  try {
    const rows = await db.$queryRaw<Array<{ available: boolean }>>`
      SELECT true AS available
      FROM pg_extension
      WHERE extname = 'postgis'
    `
    if (rows.length > 0 && rows[0]?.available === true) {
      return { status: "ok", detail: "available" }
    }
    return { status: "error", detail: "extension not found" }
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : "query failed" }
  }
}

/**
 * Check S3-compatible storage (MinIO / Cloudflare R2 / AWS S3).
 * Attempts to list the configured bucket. If S3 is not configured, reports disabled.
 */
async function checkS3(): Promise<{ status: ServiceStatus; detail: string }> {
  const endpoint = process.env.S3_ENDPOINT
  const bucket = process.env.S3_BUCKET
  const accessKey = process.env.S3_ACCESS_KEY
  const secretKey = process.env.S3_SECRET_KEY

  if (!endpoint || !bucket) {
    return { status: "disabled", detail: "S3 not configured (S3_ENDPOINT or S3_BUCKET missing)" }
  }

  if (!accessKey || !secretKey) {
    return { status: "disabled", detail: "S3 credentials not configured" }
  }

  try {
    // Try MinIO-specific health endpoint first (no auth needed)
    const baseUrl = endpoint.replace(/\/$/, "")
    const healthUrl = `${baseUrl}/minio/health/live`
    const res = await fetch(healthUrl, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Severinno-HealthCheck/1.0" },
    })

    if (res.ok) {
      return { status: "ok", detail: `reachable (bucket: ${bucket})` }
    }

    // Fallback: HEAD on bucket (may return 403 without auth — still means reachable)
    const bucketUrl = `${baseUrl}/${bucket}`
    const bucketRes = await fetch(bucketUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Severinno-HealthCheck/1.0" },
    })

    if (bucketRes.ok || bucketRes.status === 403) {
      return { status: "ok", detail: `reachable (bucket: ${bucket})` }
    }

    return { status: "error", detail: `HTTP ${bucketRes.status}` }
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : "timeout" }
  }
}

/**
 * Check OpenSearch cluster availability.
 * If OPENSEARCH_URL is not configured, reports disabled.
 */
async function checkOpenSearch(): Promise<{ status: ServiceStatus; detail: string }> {
  const opensearchUrl = process.env.OPENSEARCH_URL
  if (!opensearchUrl) {
    return { status: "disabled", detail: "OPENSEARCH_URL not configured" }
  }

  try {
    const res = await fetch(`${opensearchUrl}/_cluster/health`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "Accept": "application/json",
        ...(process.env.OPENSEARCH_USERNAME
          ? { Authorization: `Basic ${Buffer.from(
              `${process.env.OPENSEARCH_USERNAME}:${process.env.OPENSEARCH_PASSWORD ?? ""}`,
            ).toString("base64")}` }
          : {}),
      },
    })

    if (!res.ok) return { status: "error", detail: `HTTP ${res.status}` }

    const data = (await res.json()) as {
      status?: string
      cluster_name?: string
      number_of_nodes?: number
    } | null

    if (!data) return { status: "error", detail: "empty response" }

    // OpenSearch cluster status: green, yellow, or red
    // green = all good, yellow = degraded (replicas not assigned), red = critical
    if (data.status === "green" || data.status === "yellow") {
      return {
        status: "ok",
        detail: `cluster=${data.cluster_name ?? "unknown"} nodes=${data.number_of_nodes ?? "?"} status=${data.status}`,
      }
    }

    return { status: "error", detail: `cluster status=${data.status}` }
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : "timeout" }
  }
}

async function checkTracing(): Promise<{ status: ServiceStatus; detail: string }> {
  try {
    const enabled = process.env.OTEL_ENABLED === "true"
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    if (!enabled) return { status: "disabled", detail: "OTEL_ENABLED=false" }
    if (!endpoint) return { status: "error", detail: "OTEL_EXPORTER_OTLP_ENDPOINT not set" }
    return { status: "ok", detail: `endpoint=${endpoint}` }
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : "check failed" }
  }
}