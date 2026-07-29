import "server-only"

import { captureMessage, captureError } from "./sentry"
import logger from "./logger"

export interface HealthMonitorResult {
  healthy: boolean
  overallStatus: string
  totalServices: number
  healthyCount: number
  degradedCount: number
  unhealthyCount: number
  alertsSent: number
  services: Array<{ name: string; status: string; message: string; alerted: boolean }>
  timestamp: string
}

interface ServiceHealth {
  name: string
  status: "healthy" | "degraded" | "unhealthy" | "unknown"
  latencyMs: number | null
  message: string
  details?: Record<string, unknown>
}

interface DetailedHealthResponse {
  status: "healthy" | "degraded" | "unhealthy"
  timestamp: string
  uptime: number
  version: string
  summary: { healthy: number; degraded: number; unhealthy: number; total: number }
  services: ServiceHealth[]
  cache: { hits: number; misses: number; total: number }
}

const THRESHOLDS = {
  RSS_MB_WARN: 400, RSS_MB_CRIT: 600,
  HEAP_MB_WARN: 200, HEAP_MB_CRIT: 350,
  DB_LATENCY_WARN_MS: 2000, DB_LATENCY_CRIT_MS: 5000,
  QUEUE_DEPTH_WARN: 100, QUEUE_DEPTH_CRIT: 500,
  CACHE_HIT_RATIO_WARN: 0.5,
} as const

const CRITICAL_SERVICES = new Set(["database", "app"])

const alertState = new Map<string, number>()
const ALERT_DEBOUNCE_COUNT = 3

function trackThresholdViolation(key: string): boolean {
  const count = (alertState.get(key) ?? 0) + 1
  alertState.set(key, count)
  return count >= ALERT_DEBOUNCE_COUNT
}

function resetThresholdViolation(key: string) {
  alertState.set(key, 0)
}

// ── Severity mapping ───────────────────────────────────────────────────────

const STATUS_SEVERITY: Record<string, "error" | "warn" | "info"> = {
  unhealthy: "error",
  degraded: "warn",
  healthy: "info",
  unknown: "warn",
}

// ── Self-reachable URL ─────────────────────────────────────────────────────

function getBaseUrl(): string {
  // In Docker, use the internal hostname. In dev, use localhost.
  // PORT is set by Next.js (default 3000), fallback for dev.
  const port = process.env.PORT ?? "3000"
  return process.env.APP_INTERNAL_URL ?? `http://127.0.0.1:${port}`
}

// ── Health monitor ─────────────────────────────────────────────────────────

/**
 * Run a full health monitor check against the internal /api/health/detailed.
 *
 * Returns a detailed result object and sends Sentry events for any services
 * that are not healthy. Idempotent — no side effects beyond logging and Sentry.
 */
export async function runHealthMonitor(): Promise<HealthMonitorResult> {
  const startedAt = Date.now()
  const result: HealthMonitorResult = {
    healthy: true,
    overallStatus: "healthy",
    totalServices: 0,
    healthyCount: 0,
    degradedCount: 0,
    unhealthyCount: 0,
    alertsSent: 0,
    services: [],
    timestamp: new Date().toISOString(),
  }

  try {
    // ── Fetch health data ──────────────────────────────────────────
    const baseUrl = getBaseUrl()
    const url = `${baseUrl}/api/health/detailed`

    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/json" },
    })

    if (!response.ok) {
      // The endpoint itself is failing entirely
      const body = await response.text().catch(() => "no body")
      const msg = `Health endpoint returned HTTP ${response.status}: ${body.slice(0, 200)}`
      captureError(new Error(msg), { url, status: response.status, monitorElapsed: Date.now() - startedAt })
      logger.error({ url, status: response.status, body: body.slice(0, 300) }, "health-monitor: endpoint unreachable")

      result.healthy = false
      result.overallStatus = "unhealthy"
      result.services.push({
        name: "health-endpoint",
        status: "unhealthy",
        message: msg,
        alerted: true,
      })
      return result
    }

    const health: DetailedHealthResponse = await response.json()
    const elapsed = Date.now() - startedAt

    // ── Populate result fields ─────────────────────────────────────
    result.overallStatus = health.status
    result.totalServices = health.summary.total
    result.healthyCount = health.summary.healthy
    result.degradedCount = health.summary.degraded
    result.unhealthyCount = health.summary.unhealthy
    result.healthy = health.status === "healthy"

    const unhealthyServices = health.services.filter((s) => s.status === "unhealthy")
    const degradedServices = health.services.filter((s) => s.status === "degraded")
    const criticalDown = health.services.some(
      (s) => CRITICAL_SERVICES.has(s.name) && s.status === "unhealthy",
    )

    // ── Alert per service ──────────────────────────────────────────
    // Each unhealthy/degraded service gets its own Sentry event so that
    // GlitchTip can create separate issues per service, and alert rules
    // can filter by service name via tags.

    for (const svc of unhealthyServices) {
      const context: Record<string, unknown> = {
        service: svc.name,
        status: svc.status,
        message: svc.message,
        latencyMs: svc.latencyMs,
        uptime: health.uptime,
        version: health.version,
        monitorElapsed: elapsed,
      }
      if (svc.details) context.details = svc.details

      captureMessage(
        `[HealthMonitor] 🛑 Service unhealthy: ${svc.name} — ${svc.message}`,
        "error",
        context,
      )
      result.alertsSent++
    }

    for (const svc of degradedServices) {
      const context: Record<string, unknown> = {
        service: svc.name,
        status: svc.status,
        message: svc.message,
        latencyMs: svc.latencyMs,
        uptime: health.uptime,
        version: health.version,
        monitorElapsed: elapsed,
      }
      if (svc.details) context.details = svc.details

      captureMessage(
        `[HealthMonitor] ⚠️ Service degraded: ${svc.name} — ${svc.message}`,
        "warn",
        context,
      )
      result.alertsSent++
    }

    // ═════════════════════════════════════════════════════════════════
    // THRESHOLD CHECKS — alertas baseados em métricas quantitativas
    // ═════════════════════════════════════════════════════════════════
    // Esses alertas são disparados quando métricas específicas excedem
    // limites pré-definidos (com debounce de N checks consecutivos).
    // ═════════════════════════════════════════════════════════════════

    // ── Memory thresholds ──────────────────────────────────────────
    const diskSvc = health.services.find((s) => s.name === "disk")
    if (diskSvc?.details) {
      const rssStr = String(diskSvc.details.rss ?? "").replace("MB", "")
      const heapStr = String(diskSvc.details.heapUsed ?? "").replace("MB", "")
      const rssMB = parseInt(rssStr, 10)
      const heapMB = parseInt(heapStr, 10)

      if (!isNaN(rssMB) && rssMB > THRESHOLDS.RSS_MB_CRIT) {
        if (trackThresholdViolation("memory_rss_crit")) {
          captureMessage(
            `[HealthMonitor] 🛑 RSS memory critical: ${rssMB}MB (limit: ${THRESHOLDS.RSS_MB_CRIT}MB)`,
            "error",
            { service: "memory", metric: "rss", value: rssMB, threshold: THRESHOLDS.RSS_MB_CRIT, unit: "MB" },
          )
          result.alertsSent++
        }
      } else if (!isNaN(rssMB) && rssMB > THRESHOLDS.RSS_MB_WARN) {
        if (trackThresholdViolation("memory_rss_warn")) {
          captureMessage(
            `[HealthMonitor] ⚠️ RSS memory high: ${rssMB}MB (warn: ${THRESHOLDS.RSS_MB_WARN}MB)`,
            "warn",
            { service: "memory", metric: "rss", value: rssMB, threshold: THRESHOLDS.RSS_MB_WARN, unit: "MB" },
          )
          result.alertsSent++
        }
      } else {
        resetThresholdViolation("memory_rss_crit")
        resetThresholdViolation("memory_rss_warn")
      }

      if (!isNaN(heapMB) && heapMB > THRESHOLDS.HEAP_MB_CRIT) {
        if (trackThresholdViolation("memory_heap_crit")) {
          captureMessage(
            `[HealthMonitor] 🛑 Heap memory critical: ${heapMB}MB (limit: ${THRESHOLDS.HEAP_MB_CRIT}MB)`,
            "error",
            { service: "memory", metric: "heap", value: heapMB, threshold: THRESHOLDS.HEAP_MB_CRIT, unit: "MB" },
          )
          result.alertsSent++
        }
      } else if (!isNaN(heapMB) && heapMB > THRESHOLDS.HEAP_MB_WARN) {
        if (trackThresholdViolation("memory_heap_warn")) {
          captureMessage(
            `[HealthMonitor] ⚠️ Heap memory high: ${heapMB}MB (warn: ${THRESHOLDS.HEAP_MB_WARN}MB)`,
            "warn",
            { service: "memory", metric: "heap", value: heapMB, threshold: THRESHOLDS.HEAP_MB_WARN, unit: "MB" },
          )
          result.alertsSent++
        }
      } else {
        resetThresholdViolation("memory_heap_crit")
        resetThresholdViolation("memory_heap_warn")
      }
    }

    const dbSvc = health.services.find((s) => s.name === "database")
    if (dbSvc?.latencyMs != null) {
      result.alertsSent += checkThreshold("database", "latency", "latency", THRESHOLDS.DB_LATENCY_WARN_MS, THRESHOLDS.DB_LATENCY_CRIT_MS, { ["latency"]: `${dbSvc.latencyMs}` }, "ms")
    }

    const workersSvc = health.services.find((s) => s.name === "workers")
    if (workersSvc?.details?.queueDepths) {
      const qDepths = workersSvc.details.queueDepths as Record<string, number>
      for (const [qName, qDepth] of Object.entries(qDepths)) {
        result.alertsSent += checkThreshold("queue", qName, "depth", THRESHOLDS.QUEUE_DEPTH_WARN, THRESHOLDS.QUEUE_DEPTH_CRIT, { ["depth"]: String(qDepth) }, "messages")
      }
    }

    if (health.cache.total > 0) {
      const hitRatio = health.cache.hits / health.cache.total
      if (hitRatio < THRESHOLDS.CACHE_HIT_RATIO_WARN && trackThresholdViolation("cache_hit_ratio")) {
        result.alertsSent += captureAndCount("warn", `Cache hit ratio low: ${(hitRatio * 100).toFixed(1)}%`, "cache", { metric: "hit_ratio", value: hitRatio, threshold: THRESHOLDS.CACHE_HIT_RATIO_WARN })
      } else {
        resetThresholdViolation("cache_hit_ratio")
      }
    }

    // ── Summary event if degraded/unhealthy ─────────────────────────
    if (health.status !== "healthy" || criticalDown) {
      const summaryContext: Record<string, unknown> = {
        overallStatus: health.status,
        healthy: health.summary.healthy,
        degraded: health.summary.degraded,
        unhealthy: health.summary.unhealthy,
        total: health.summary.total,
        uptime: health.uptime,
        version: health.version,
        monitorElapsed: elapsed,
        criticalServicesDown: Array.from(
          new Set(health.services.filter((s) => CRITICAL_SERVICES.has(s.name) && s.status === "unhealthy").map((s) => s.name)),
        ),
        unhealthyServices: unhealthyServices.map((s) => ({ name: s.name, message: s.message })),
        degradedServices: degradedServices.map((s) => ({ name: s.name, message: s.message })),
      }

      const severity = criticalDown ? "error" : "warn" as const
      captureMessage(
        `[HealthMonitor] 📊 System ${health.status} — ${health.summary.healthy}/${health.summary.total} services healthy`,
        severity,
        summaryContext,
      )
      result.alertsSent++
    }

    // ── Build service list with alert status ───────────────────────
    for (const svc of health.services) {
      result.services.push({
        name: svc.name,
        status: svc.status,
        message: svc.message,
        alerted: svc.status === "unhealthy" || svc.status === "degraded",
      })
    }

    logger.info(
      {
        overallStatus: health.status,
        healthy: health.summary.healthy,
        degraded: health.summary.degraded,
        unhealthy: health.summary.unhealthy,
        total: health.summary.total,
        alertsSent: result.alertsSent,
        elapsed,
      },
      "health-monitor: check complete",
    )
  } catch (err) {
    // The fetch itself failed (timeout, DNS, connection refused, etc.)
    const msg = (err as Error).message
    captureError(err, { component: "health-monitor", elapsed: Date.now() - startedAt })

    result.healthy = false
    result.overallStatus = "unhealthy"
    result.services.push({
      name: "health-monitor",
      status: "unhealthy",
      message: msg,
      alerted: true,
    })

    logger.error(
      { err: msg, elapsed: Date.now() - startedAt },
      "health-monitor: fetch failed",
    )
  }

  return result
}

export default runHealthMonitor
