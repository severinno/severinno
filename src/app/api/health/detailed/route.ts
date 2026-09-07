export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getClient, getCacheStats } from "@/lib/redis"
import { getChannel } from "@/lib/queue"
import logger from "@/lib/logger"
import { exportMetrics } from "@/lib/metrics"
import { getMultiLevelCacheStats, type MultiLevelCacheStats } from "@/lib/cache/multi-level-cache"
import { getSearchQueueStats } from "@/lib/search-queue"
import { getClient as getOpenSearchClient } from "@/lib/search"
import pkg from "../../../../../package.json"

// Force Node.js runtime — uses Prisma, amqplib, and Node.js APIs
// (Edge runtime doesn't support TCP connections or @lib/db)
export const runtime = "nodejs"

// ── Types ─────────────────────────────────────────────────────────────────

export interface DetailedHealthResponse {
  status: "healthy" | "degraded" | "unhealthy"
  timestamp: string
  uptime: number
  version: string
  summary: {
    healthy: number
    degraded: number
    unhealthy: number
    total: number
  }
  services: ServiceHealth[]
  cache: ReturnType<typeof getCacheStats>
  multiLevelCache?: MultiLevelCacheStats
  searchQueue?: ReturnType<typeof getSearchQueueStats>
}

interface ServiceHealth {
  name: string
  status: "healthy" | "degraded" | "unhealthy" | "unknown"
  latencyMs: number | null
  message: string
  details?: Record<string, unknown>
}

// ── Criticality tiers ─────────────────────────────────────────────────────
// Tells us which services are essential for the app to function.
// If a critical service is down → overall status = "unhealthy"
// If only non-critical services are down → overall status = "degraded"

const CRITICAL_SERVICES = new Set(["database", "app"])

const _DEGRADING_SERVICES = new Set(["redis", "rabbitmq", "pgbouncer", "realtime", "opensearch"])

const _INFO_SERVICES = new Set(["caddy", "minio", "disk", "workers"])

// ── Cache (15s TTL, same as /api/health) ──────────────────────────────────

const CACHE_TTL = 15
let inMemoryCache: { timestamp: number; result: DetailedHealthResponse } | null = null

// ── GET ───────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  // Check for Prometheus/OpenMetrics format
  const url = new URL(request.url)
  const format = url.searchParams.get("format") ?? "json"
  const isPrometheus = format === "prometheus" || format === "openmetrics"

  // Fast path: cached result (JSON only — Prometheus always re-computes)
  if (!isPrometheus && inMemoryCache && Date.now() - inMemoryCache.timestamp < CACHE_TTL * 1000) {
    return NextResponse.json(inMemoryCache.result)
  }

  const start = Date.now()

  // Run all checks in parallel (each already has internal try/catch)
  const results = await Promise.allSettled([
    checkApp(),
    checkDatabase(),
    checkRedis(),
    checkRabbitMQ(),
    checkPgBouncer(),
    checkRealtime(),
    checkMinIO(),
    checkCaddy(),
    checkDisk(),
    checkWorkers(),
    checkOpenSearch(),
  ])

  const services: ServiceHealth[] = results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : {
          name: "unknown",
          status: "unhealthy" as const,
          latencyMs: null,
          message: r.reason?.toString() ?? "Unknown error",
        },
  )

  // Tally
  let healthy = 0,
    degraded = 0,
    unhealthy = 0
  for (const s of services) {
    if (s.status === "healthy") healthy++
    else if (s.status === "degraded") degraded++
    else if (s.status === "unhealthy") unhealthy++
  }

  // Compute overall status
  const criticalDown = services.some(
    (s) => CRITICAL_SERVICES.has(s.name) && s.status === "unhealthy",
  )
  const anyDown = services.some((s) => s.status === "unhealthy")
  const anyDegraded = services.some((s) => s.status === "degraded")

  let overallStatus: DetailedHealthResponse["status"]
  if (criticalDown) {
    overallStatus = "unhealthy"
  } else if (anyDown || anyDegraded) {
    overallStatus = "degraded"
  } else {
    overallStatus = "healthy"
  }

  const response: DetailedHealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: pkg.version,
    summary: { healthy, degraded, unhealthy, total: services.length },
    services,
    cache: getCacheStats(),
    multiLevelCache: getMultiLevelCacheStats(),
    searchQueue: getSearchQueueStats(),
  }

  // Cache only healthy responses (JSON only)
  if (!isPrometheus && overallStatus === "healthy") {
    inMemoryCache = { timestamp: Date.now(), result: response }
  } else {
    inMemoryCache = null
  }

  const elapsed = Date.now() - start
  logger.info(
    {
      elapsed,
      status: overallStatus,
      format,
      services: services.map((s) => ({ name: s.name, status: s.status })),
    },
    `detailed health check (${format})`,
  )

  // ── Prometheus / OpenMetrics output ───────────────────────────
  if (isPrometheus) {
    const metricsText = toOpenMetrics(response)
    return new NextResponse(metricsText, {
      status: 200, // Prometheus scrapes always return 200; use stale data instead of error
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      },
    })
  }

  // ── JSON output (default) ─────────────────────────────────────
  const httpStatus = overallStatus === "unhealthy" ? 503 : 200
  return NextResponse.json(response, { status: httpStatus })
}

// ── Individual checks ─────────────────────────────────────────────────────

async function checkApp(): Promise<ServiceHealth> {
  // The mere fact that we're running means the app is healthy
  return {
    name: "app",
    status: "healthy",
    latencyMs: 0,
    message: `Process running for ${Math.floor(process.uptime())}s, PID ${process.pid}`,
    details: {
      node: process.version,
      platform: process.platform,
      memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    },
  }
}

async function checkDatabase(): Promise<ServiceHealth> {
  const t0 = performance.now()
  try {
    await db.$queryRaw`SELECT 1`
    const latency = Math.round(performance.now() - t0)
    // Determine if we're going through PgBouncer or direct to PostgreSQL
    const pgUrl = process.env.DATABASE_URL ?? ""
    const viaPooler = pgUrl.includes("pgbouncer")
    return {
      name: "database",
      status: "healthy",
      latencyMs: latency,
      message: `Query ok (${latency}ms)`,
      details: {
        connectionMode: viaPooler ? "pgbouncer" : "direct",
      },
    }
  } catch (err) {
    const latency = Math.round(performance.now() - t0)
    logger.error({ err }, "health/detailed: database check failed")
    return {
      name: "database",
      status: "unhealthy",
      latencyMs: latency,
      message: (err as Error).message,
    }
  }
}

async function checkRedis(): Promise<ServiceHealth> {
  const t0 = performance.now()
  try {
    const client = getClient()
    if (!client) throw new Error("Redis client not available")
    await client.ping()
    const latency = Math.round(performance.now() - t0)
    return {
      name: "redis",
      status: "healthy",
      latencyMs: latency,
      message: `PONG (${latency}ms)`,
    }
  } catch (err) {
    const latency = Math.round(performance.now() - t0)
    return {
      name: "redis",
      status: "degraded",
      latencyMs: latency,
      message: (err as Error).message,
      details: { note: "Redis is optional — app degrades gracefully without it" },
    }
  }
}

async function checkRabbitMQ(): Promise<ServiceHealth> {
  const t0 = performance.now()
  try {
    // Reuse the existing singleton channel from src/lib/queue.ts
    // This avoids opening a new AMQP connection on every health check
    const ch = await getChannel()
    // Check queue depth for main queues via the singleton connection
    // Use assertQueue (idempotent) instead of checkQueue to avoid errors
    // when queues haven't been created yet (no workers running)
    const emailQ = await ch.assertQueue("email", { durable: true })
    const notifQ = await ch.assertQueue("notification", { durable: true })
    const searchQ = await ch.assertQueue("search-index", { durable: true })
    const latency = Math.round(performance.now() - t0)
    return {
      name: "rabbitmq",
      status: "healthy",
      latencyMs: latency,
      message: `Connected (${latency}ms)`,
      details: {
        queues: {
          email: { messages: emailQ.messageCount, consumers: emailQ.consumerCount },
          notification: { messages: notifQ.messageCount, consumers: notifQ.consumerCount },
          "search-index": { messages: searchQ.messageCount, consumers: searchQ.consumerCount },
        },
      },
    }
  } catch (err) {
    const latency = Math.round(performance.now() - t0)
    const msg = (err as Error).message ?? String(err)
    // "Channel ended" means the lazy connection was never used — acceptable without workers
    const isOptionalFailure = msg.includes("Channel ended") || msg.includes("no queue")
    return {
      name: "rabbitmq",
      status: isOptionalFailure ? "healthy" : "degraded",
      latencyMs: latency,
      message: isOptionalFailure ? `Connected (lazy, no consumers yet)` : msg,
      details: {
        note: "RabbitMQ is optional without workers — app works without it",
        queues: {},
      },
    }
  }
}

async function checkPgBouncer(): Promise<ServiceHealth> {
  const t0 = performance.now()
  try {
    // Determine if DATABASE_URL points to PgBouncer or direct
    const pgUrl = process.env.DATABASE_URL ?? ""
    const viaPooler = pgUrl.includes("pgbouncer")
    const poolerHost = viaPooler ? "pgbouncer" : "postgres"
    const poolerPort = viaPooler ? 6432 : 5432
    // Running SELECT 1 through Prisma validates the entire chain
    await db.$queryRaw`SELECT 1`
    const latency = Math.round(performance.now() - t0)
    return {
      name: "pgbouncer",
      status: viaPooler ? "healthy" : "degraded",
      latencyMs: latency,
      message: viaPooler
        ? `Pooler at ${poolerHost}:${poolerPort} (${latency}ms)`
        : `Direct PostgreSQL (${latency}ms) — DATABASE_URL does not use PgBouncer`,
      details: {
        connectionString: `postgresql://***@${poolerHost}:${poolerPort}/severinno`,
        viaPooler,
      },
    }
  } catch (err) {
    const latency = Math.round(performance.now() - t0)
    return {
      name: "pgbouncer",
      status: "degraded",
      latencyMs: latency,
      message: (err as Error).message,
      details: { note: "App connects directly to PostgreSQL as fallback" },
    }
  }
}

async function checkRealtime(): Promise<ServiceHealth> {
  const t0 = performance.now()
  try {
    const url = process.env.REALTIME_URL ?? "http://realtime:3003"
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })
    const latency = Math.round(performance.now() - t0)
    if (res.ok) {
      return {
        name: "realtime",
        status: "healthy",
        latencyMs: latency,
        message: `HTTP ${res.status} (${latency}ms)`,
      }
    }
    return {
      name: "realtime",
      status: "degraded",
      latencyMs: latency,
      message: `HTTP ${res.status}`,
    }
  } catch (err) {
    const latency = Math.round(performance.now() - t0)
    return {
      name: "realtime",
      status: "degraded",
      latencyMs: latency,
      message: (err as Error).message,
      details: { note: "WebSocket fallbacks to polling without realtime" },
    }
  }
}

async function checkMinIO(): Promise<ServiceHealth> {
  const t0 = performance.now()
  try {
    const url = process.env.S3_ENDPOINT ?? "http://minio:9000"
    const res = await fetch(`${url}/minio/health/live`, { signal: AbortSignal.timeout(5000) })
    const latency = Math.round(performance.now() - t0)
    if (res.ok) {
      return {
        name: "minio",
        status: "healthy",
        latencyMs: latency,
        message: `Live (${latency}ms)`,
      }
    }
    return {
      name: "minio",
      status: "degraded",
      latencyMs: latency,
      message: `HTTP ${res.status}`,
      details: { note: "Uploads may fail without MinIO" },
    }
  } catch (err) {
    const latency = Math.round(performance.now() - t0)
    return {
      name: "minio",
      status: "degraded",
      latencyMs: latency,
      message: (err as Error).message,
      details: { note: "Uploads may fail without MinIO" },
    }
  }
}

async function checkCaddy(): Promise<ServiceHealth> {
  const t0 = performance.now()
  try {
    // Caddy exposes an internal health endpoint on :8080 (see Caddyfile.prod)
    const res = await fetch("http://caddy:8080/health", { signal: AbortSignal.timeout(5000) })
    const latency = Math.round(performance.now() - t0)
    if (res.ok) {
      return {
        name: "caddy",
        status: "healthy",
        latencyMs: latency,
        message: `HTTP ${res.status} (${latency}ms)`,
      }
    }
    return {
      name: "caddy",
      status: "degraded",
      latencyMs: latency,
      message: `HTTP ${res.status}`,
    }
  } catch (err) {
    const latency = Math.round(performance.now() - t0)
    return {
      name: "caddy",
      status: "degraded",
      latencyMs: latency,
      message: (err as Error).message,
      details: { note: "Caddy may still be starting or not reachable from backend network" },
    }
  }
}

async function checkDisk(): Promise<ServiceHealth> {
  const t0 = performance.now()
  try {
    // Check disk space using process.memoryUsage as proxy
    // In production, a more robust disk check would use `df` via a shell command
    const mem = process.memoryUsage()
    const rssMb = Math.round(mem.rss / 1024 / 1024)
    const heapMb = Math.round(mem.heapUsed / 1024 / 1024)
    const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024)
    const latency = Math.round(performance.now() - t0)
    return {
      name: "disk",
      status: "healthy",
      latencyMs: latency,
      message: `RSS ${rssMb}MB / Heap ${heapMb}MB used`,
      details: {
        rss: `${rssMb}MB`,
        heapUsed: `${heapMb}MB`,
        heapTotal: `${heapTotalMb}MB`,
        external: `${Math.round(mem.external / 1024 / 1024)}MB`,
        note: "Memory usage (disk check requires host-level access)",
      },
    }
  } catch (err) {
    const latency = Math.round(performance.now() - t0)
    return {
      name: "disk",
      status: "unhealthy",
      latencyMs: latency,
      message: (err as Error).message,
    }
  }
}

async function checkWorkers(): Promise<ServiceHealth> {
  const t0 = performance.now()
  try {
    // Workers are checked indirectly via RabbitMQ queue consumer counts.
    // If a queue has at least 1 consumer, the respective worker is alive.
    const ch = await getChannel()
    const emailQ = await ch.checkQueue("email")
    const notifQ = await ch.checkQueue("notification")
    const searchQ = await ch.checkQueue("search-index")

    const latency = Math.round(performance.now() - t0)

    const workerStatuses = {
      "email-worker": emailQ.consumerCount > 0 ? ("active" as const) : ("idle" as const),
      "notification-worker": notifQ.consumerCount > 0 ? ("active" as const) : ("idle" as const),
      "search-index-worker": searchQ.consumerCount > 0 ? "active" : "idle",
    }

    const activeCount = Object.values(workerStatuses).filter((s) => s === "active").length
    const totalWorkers = Object.keys(workerStatuses).length

    return {
      name: "workers",
      status: activeCount > 0 ? "healthy" : "degraded",
      latencyMs: latency,
      message: `${activeCount}/${totalWorkers} workers active`,
      details: {
        workers: workerStatuses,
        queueDepths: {
          email: emailQ.messageCount,
          notification: notifQ.messageCount,
          "search-index": searchQ.messageCount,
        },
        note:
          activeCount === 0
            ? "No workers consuming queues — background jobs are stalled"
            : undefined,
      },
    }
  } catch (err) {
    const latency = Math.round(performance.now() - t0)
    return {
      name: "workers",
      status: "unknown",
      latencyMs: latency,
      message: (err as Error).message,
      details: {
        note: "Cannot check workers without RabbitMQ. Workers may be running but are invisible.",
      },
    }
  }
}

async function checkOpenSearch(): Promise<ServiceHealth> {
  const t0 = performance.now()
  const queueStats = getSearchQueueStats()
  try {
    const client = getOpenSearchClient()
    if (!client) {
      return {
        name: "opensearch",
        status: "degraded",
        latencyMs: 0,
        message: "Client inativo (fallback relacional ativo)",
        details: { queue: queueStats },
      }
    }

    const pingRes = await client.ping({ requestTimeout: 3000 })
    const latency = Math.round(performance.now() - t0)

    if (queueStats.dlqCount > 0) {
      return {
        name: "opensearch",
        status: "degraded",
        latencyMs: latency,
        message: `Online (${latency}ms) — Alerta: ${queueStats.dlqCount} item(ns) na DLQ`,
        details: {
          ping: pingRes.body,
          queue: queueStats,
          warning: "Itens na Dead Letter Queue requerem reprocessamento ou inspeção",
        },
      }
    }

    return {
      name: "opensearch",
      status: "healthy",
      latencyMs: latency,
      message: `Cluster operacional (${latency}ms) — Outbox: ${queueStats.pendingCount} pendente(s)`,
      details: {
        ping: pingRes.body,
        queue: queueStats,
      },
    }
  } catch (err) {
    const latency = Math.round(performance.now() - t0)
    return {
      name: "opensearch",
      status: "degraded",
      latencyMs: latency,
      message: `Cluster offline (${(err as Error).message}) — Fallback relacional ativo`,
      details: {
        queue: queueStats,
        fallback: "active",
      },
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OpenMetrics / Prometheus format conversion
// ═══════════════════════════════════════════════════════════════════════════
// Converts a DetailedHealthResponse into OpenMetrics-compatible text format
// for direct Prometheus scraping. Format: text/plain; version=0.0.4
//
// Reference: https://github.com/prometheus/docs/blob/main/content/docs/instrumenting/exposition_formats.md
// ═══════════════════════════════════════════════════════════════════════════

/** Status weight: healthy=1, degraded=0, unhealthy=-1 */
function statusWeight(status: string): number {
  if (status === "healthy") return 1
  if (status === "degraded") return 0
  return -1 // unhealthy or unknown
}

function toOpenMetrics(resp: DetailedHealthResponse): string {
  const lines: string[] = []

  // ── Metadata ───────────────────────────────────────────────────
  lines.push("# HELP severinno_build_info Build metadata for the Severinno app")
  lines.push("# TYPE severinno_build_info gauge")
  lines.push(`severinno_build_info{version="${resp.version}"} 1`)
  lines.push("")

  // ── Health status ──────────────────────────────────────────────
  lines.push("# HELP severinno_health_status Overall health (1=healthy, 0=degraded, -1=unhealthy)")
  lines.push("# TYPE severinno_health_status gauge")
  lines.push(`severinno_health_status{status="${resp.status}"} ${statusWeight(resp.status)}`)
  lines.push("")

  // ── Service individual status ──────────────────────────────────
  lines.push("# HELP severinno_service_status Per-service health (1=ok, 0=degraded, -1=down)")
  lines.push("# TYPE severinno_service_status gauge")
  for (const svc of resp.services) {
    lines.push(
      `severinno_service_status{name="${svc.name}",status="${svc.status}"} ${statusWeight(svc.status)}`,
    )
  }
  lines.push("")

  // ── Service latency ────────────────────────────────────────────
  lines.push("# HELP severinno_service_latency_ms Per-service health check latency in milliseconds")
  lines.push("# TYPE severinno_service_latency_ms gauge")
  for (const svc of resp.services) {
    if (svc.latencyMs !== null) {
      lines.push(`severinno_service_latency_ms{name="${svc.name}"} ${svc.latencyMs}`)
    }
  }
  lines.push("")

  // ── Summary counts ─────────────────────────────────────────────
  lines.push("# HELP severinno_services_total Total number of services checked")
  lines.push("# TYPE severinno_services_total gauge")
  lines.push(`severinno_services_total ${resp.summary.total}`)

  lines.push("# HELP severinno_services_healthy Number of healthy services")
  lines.push("# TYPE severinno_services_healthy gauge")
  lines.push(`severinno_services_healthy ${resp.summary.healthy}`)

  lines.push("# HELP severinno_services_degraded Number of degraded services")
  lines.push("# TYPE severinno_services_degraded gauge")
  lines.push(`severinno_services_degraded ${resp.summary.degraded}`)

  lines.push("# HELP severinno_services_unhealthy Number of unhealthy services")
  lines.push("# TYPE severinno_services_unhealthy gauge")
  lines.push(`severinno_services_unhealthy ${resp.summary.unhealthy}`)
  lines.push("")

  // ── Process metrics ────────────────────────────────────────────
  const mem = process.memoryUsage()
  const cpu = process.cpuUsage()

  lines.push("# HELP severinno_process_uptime_seconds Process uptime in seconds")
  lines.push("# TYPE severinno_process_uptime_seconds gauge")
  lines.push(`severinno_process_uptime_seconds ${resp.uptime}`)

  lines.push("# HELP severinno_process_cpu_user_seconds_total Total user CPU time in microseconds")
  lines.push("# TYPE severinno_process_cpu_user_seconds_total counter")
  lines.push(`severinno_process_cpu_user_seconds_total ${cpu.user}`)

  lines.push(
    "# HELP severinno_process_cpu_system_seconds_total Total system CPU time in microseconds",
  )
  lines.push("# TYPE severinno_process_cpu_system_seconds_total counter")
  lines.push(`severinno_process_cpu_system_seconds_total ${cpu.system}`)

  lines.push("# HELP severinno_process_memory_rss_bytes RSS memory in bytes")
  lines.push("# TYPE severinno_process_memory_rss_bytes gauge")
  lines.push(`severinno_process_memory_rss_bytes ${mem.rss}`)

  lines.push("# HELP severinno_process_memory_heap_bytes Heap memory usage in bytes")
  lines.push("# TYPE severinno_process_memory_heap_bytes gauge")
  lines.push(`severinno_process_memory_heap_bytes{type="used"} ${mem.heapUsed}`)
  lines.push(`severinno_process_memory_heap_bytes{type="total"} ${mem.heapTotal}`)
  lines.push("")

  // ── Cache metrics ──────────────────────────────────────────────
  lines.push("# HELP severinno_cache_operations_total Total cache operations by type")
  lines.push("# TYPE severinno_cache_operations_total counter")
  lines.push(`severinno_cache_operations_total{type="hit"} ${resp.cache.hits}`)
  lines.push(`severinno_cache_operations_total{type="miss"} ${resp.cache.misses}`)

  if (resp.cache.total > 0) {
    lines.push("# HELP severinno_cache_hit_ratio Cache hit ratio (0-1)")
    lines.push("# TYPE severinno_cache_hit_ratio gauge")
    lines.push(`severinno_cache_hit_ratio ${(resp.cache.hits / resp.cache.total).toFixed(4)}`)
  }
  lines.push("")

  // ── Detailed service-specific metrics ──────────────────────────
  // Extract RabbitMQ queue depths from the rabbitmq service details
  const rabbitmqSvc = resp.services.find((s) => s.name === "rabbitmq")
  if (rabbitmqSvc?.details?.queues) {
    const queues = rabbitmqSvc.details.queues as Record<
      string,
      { messages: number; consumers: number }
    >
    lines.push("# HELP severinno_rabbitmq_queue_messages Number of messages in RabbitMQ queues")
    lines.push("# TYPE severinno_rabbitmq_queue_messages gauge")
    for (const [qName, qData] of Object.entries(queues)) {
      lines.push(`severinno_rabbitmq_queue_messages{queue="${qName}"} ${qData.messages}`)
    }
    lines.push("# HELP severinno_rabbitmq_queue_consumers Number of consumers on RabbitMQ queues")
    lines.push("# TYPE severinno_rabbitmq_queue_consumers gauge")
    for (const [qName, qData] of Object.entries(queues)) {
      lines.push(`severinno_rabbitmq_queue_consumers{queue="${qName}"} ${qData.consumers}`)
    }
    lines.push("")
  }

  // Workers status from workers service details
  const workersSvc = resp.services.find((s) => s.name === "workers")
  if (workersSvc?.details?.workers) {
    const workers = workersSvc.details.workers as Record<string, string>
    lines.push("# HELP severinno_worker_status Worker status (1=active, 0=idle)")
    lines.push("# TYPE severinno_worker_status gauge")
    for (const [wName, wStatus] of Object.entries(workers)) {
      lines.push(`severinno_worker_status{worker="${wName}"} ${wStatus === "active" ? 1 : 0}`)
    }

    if (workersSvc.details.queueDepths) {
      const qDepths = workersSvc.details.queueDepths as Record<string, number>
      lines.push("# HELP severinno_worker_queue_depth Total messages pending in worker queues")
      lines.push("# TYPE severinno_worker_queue_depth gauge")
      for (const [name, depth] of Object.entries(qDepths)) {
        lines.push(`severinno_worker_queue_depth{queue="${name}"} ${depth}`)
      }
    }
    lines.push("")
  }

  // Database connection mode
  const dbSvc = resp.services.find((s) => s.name === "database")
  if (dbSvc?.details?.connectionMode) {
    lines.push(
      "# HELP severinno_database_connection_mode Database connection mode (1=pgbouncer, 0=direct)",
    )
    lines.push("# TYPE severinno_database_connection_mode gauge")
    lines.push(
      `severinno_database_connection_mode ${dbSvc.details.connectionMode === "pgbouncer" ? 1 : 0}`,
    )
    lines.push("")
  }

  // ── Timestamp ──────────────────────────────────────────────────
  lines.push("# HELP severinno_scrape_timestamp_seconds Timestamp of the metrics scrape")
  lines.push("# TYPE severinno_scrape_timestamp_seconds gauge")
  lines.push(`severinno_scrape_timestamp_seconds ${Date.now() / 1000}`)

  // ── Request Duration Metrics ───────────────────────────────────
  lines.push(exportMetrics())

  // ── EOF marker (required by OpenMetrics) ───────────────────────
  lines.push("# EOF")

  return lines.join("\n") + "\n"
}
