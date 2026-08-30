/**
 * observability-alerts.ts
 *
 * Automatic alerting when key metrics cross thresholds.
 * Checks are lightweight (in-memory) and fire at most once per cooldown period.
 *
 * Monitored thresholds:
 *   - Circuit breaker opened (any service)
 *   - Cache hit ratio < 80%
 *   - Fallback rate > 20% (Nominatim/ViaCEP going down)
 *   - Geo latency P95 > 2000ms
 */

import logger from "./logger"
import { sendAlertWebhook } from "./alert-webhook"

// ── Types ──────────────────────────────────────────────────────────────────

type AlertSeverity = "warning" | "critical"

interface Alert {
  severity: AlertSeverity
  title: string
  message: string
  metric: string
  value: number
  threshold: number
}

// ── Cooldown (prevent alert flooding) ──────────────────────────────────────

const lastAlertAt = new Map<string, number>()
const COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes between same alert

function shouldAlert(key: string): boolean {
  const last = lastAlertAt.get(key) ?? 0
  if (Date.now() - last < COOLDOWN_MS) return false
  lastAlertAt.set(key, Date.now())
  return true
}

// ── Alert handlers ─────────────────────────────────────────────────────────

function fireAlert(alert: Alert): void {
  const key = `${alert.metric}:${alert.severity}`
  if (!shouldAlert(key)) return

  const logFn = alert.severity === "critical" ? logger.error : logger.warn
  logFn(
    { severity: alert.severity, metric: alert.metric, value: alert.value, threshold: alert.threshold },
    `[ALERT] ${alert.title}: ${alert.message}`,
  )
  sendAlertWebhook({ severity: alert.severity, title: alert.title, message: alert.message, metric: alert.metric }).catch(() => {})
}

// ── Check functions (call periodically) ────────────────────────────────────

/**
 * Check circuit breaker states and alert on opens.
 * Call this with the circuit breaker stats from /api/geo/debug.
 */
export function checkCircuitBreakers(
  breakers: Record<string, { state: string; name: string }>,
): void {
  for (const [key, cb] of Object.entries(breakers)) {
    if (cb.state === "open") {
      fireAlert({
        severity: "critical",
        title: `Circuit Breaker OPEN: ${cb.name}`,
        message: `O circuit breaker "${cb.name}" está aberto. Requests estão sendo rejeitados instantaneamente.`,
        metric: `circuit-breaker.${key}`,
        value: 1,
        threshold: 0,
      })
    } else if (cb.state === "half-open") {
      fireAlert({
        severity: "warning",
        title: `Circuit Breaker HALF-OPEN: ${cb.name}`,
        message: `O circuit breaker "${cb.name}" está testando recovery.`,
        metric: `circuit-breaker.${key}.half-open`,
        value: 1,
        threshold: 0,
      })
    }
  }
}

/**
 * Check cache hit ratio and alert if too low.
 */
export function checkCacheHitRatio(hits: number, misses: number): void {
  const total = hits + misses
  if (total < 100) return // not enough data

  const ratio = hits / total
  if (ratio < 0.8) {
    fireAlert({
      severity: ratio < 0.5 ? "critical" : "warning",
      title: "Cache hit ratio baixo",
      message: `Hit ratio: ${(ratio * 100).toFixed(1)}% (${hits} hits, ${misses} misses)`,
      metric: "cache.hit-ratio",
      value: ratio,
      threshold: 0.8,
    })
  }
}

/**
 * Check geo fallback rates and alert if external APIs are failing.
 */
export function checkFallbackRates(
  operations: Record<string, { calls: number; fallbacks: number; fallbackRate: number | null }>,
): void {
  for (const [op, stats] of Object.entries(operations)) {
    if (stats.fallbackRate !== null && stats.fallbackRate > 20 && stats.calls > 10) {
      fireAlert({
        severity: stats.fallbackRate > 50 ? "critical" : "warning",
        title: `Fallback rate elevado: ${op}`,
        message: `${stats.fallbackRate}% das chamadas "${op}" estão caindo pro fallback local (${stats.fallbacks}/${stats.calls})`,
        metric: `geo.fallback.${op}`,
        value: stats.fallbackRate,
        threshold: 20,
      })
    }
  }
}

/**
 * Check geo latency and alert if P95 is too high.
 */
export function checkGeoLatency(
  services: Record<string, { p95: number; name?: string }>,
): void {
  for (const [name, metrics] of Object.entries(services)) {
    if (metrics.p95 > 2000) {
      fireAlert({
        severity: metrics.p95 > 5000 ? "critical" : "warning",
        title: `Latência alta: ${name}`,
        message: `P95 de ${name} é ${metrics.p95}ms (threshold: 2000ms)`,
        metric: `geo.latency.${name}.p95`,
        value: metrics.p95,
        threshold: 2000,
      })
    }
  }
}

/**
 * Run all checks (call from a periodic interval or admin endpoint).
 */
export function runObservabilityChecks(debugData: {
  circuitBreakers: Record<string, { state: string; name: string }>
  redis: { hits: number; misses: number }
  geoMetrics: {
    calls: Record<string, { calls: number; fallbacks: number; fallbackRate: number | null }>
    latency: Record<string, { p95: number }>
  }
}): void {
  checkCircuitBreakers(debugData.circuitBreakers)
  checkCacheHitRatio(debugData.redis.hits, debugData.redis.misses)
  checkFallbackRates(debugData.geoMetrics.calls)
  checkGeoLatency(debugData.geoMetrics.latency)
}
