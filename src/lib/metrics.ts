/**
 * metrics.ts
 *
 * In-memory metrics collector for Prometheus export.
 *
 * Tracks:
 *   - Request duration (histogram)
 *   - Request count by status code
 *   - Active connections
 *   - Business metrics (DB-based)
 *
 * The collector is designed to be lightweight and thread-safe.
 * Metrics are aggregated in memory and exported on each scrape.
 */

import "server-only"
import { db } from "./db"
import { toMoneyNumber } from "./money"
import logger from "./logger"
import { getAllCircuitBreakersStats } from "./circuit-breaker"
import { webVitalsRegistry } from "./web-vitals-registry"

// ── Request Duration Histogram ────────────────────────────────────────────

const DURATION_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, Infinity]

const requestDuration = new Map<
  string,
  { path: string; status: number; count: number; sum: number; buckets: number[] }
>()

export function recordRequestDuration(path: string, status: number, durationMs: number): void {
  const normalized = normalizePath(path)
  const key = `${normalized}:${status}`
  let entry = requestDuration.get(key)

  if (!entry) {
    entry = {
      path: normalized,
      status,
      count: 0,
      sum: 0,
      buckets: new Array(DURATION_BUCKETS.length).fill(0),
    }
    requestDuration.set(key, entry)
  }

  entry.count++
  entry.sum += durationMs

  for (let i = 0; i < DURATION_BUCKETS.length; i++) {
    if (durationMs <= DURATION_BUCKETS[i]) {
      entry.buckets[i]++
    }
  }
}

function normalizePath(path: string): string {
  const clean = path.split("?")[0]
  return clean
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
    .replace(/\/\d+/g, "/:id")
    .replace(/\/c[a-z0-9]{20,32}/gi, "/:id")
}

// ── Active Connections Counter ────────────────────────────────────────────

let activeConnections = 0

export function incrementActiveConnections(): void {
  activeConnections++
}

export function decrementActiveConnections(): void {
  activeConnections = Math.max(0, activeConnections - 1)
}

// ── Export for Prometheus ─────────────────────────────────────────────────

export function exportMetrics(): string {
  const lines: string[] = []

  lines.push("# HELP http_request_duration_ms Request duration in milliseconds")
  lines.push("# TYPE http_request_duration_ms histogram")

  for (const entry of requestDuration.values()) {
    const { path, status } = entry
    for (let i = 0; i < DURATION_BUCKETS.length; i++) {
      lines.push(
        `http_request_duration_ms_bucket{path="${path}",status="${status}",le="${DURATION_BUCKETS[i] === Infinity ? "+Inf" : DURATION_BUCKETS[i]}"} ${entry.buckets[i]}`,
      )
    }
    lines.push(`http_request_duration_ms_count{path="${path}",status="${status}"} ${entry.count}`)
    lines.push(
      `http_request_duration_ms_sum{path="${path}",status="${status}"} ${entry.sum.toFixed(2)}`,
    )
  }
  lines.push("")

  lines.push("# HELP http_active_connections Number of active HTTP connections")
  lines.push("# TYPE http_active_connections gauge")
  lines.push(`http_active_connections ${activeConnections}`)
  lines.push("")

  // Circuit Breakers SRE metrics
  const circuitStats = getAllCircuitBreakersStats()
  if (circuitStats.length > 0) {
    lines.push(
      "# HELP severinno_circuit_breaker_state Circuit breaker state (0=closed, 1=half-open, 2=open)",
    )
    lines.push("# TYPE severinno_circuit_breaker_state gauge")
    for (const cb of circuitStats) {
      const code = cb.state === "closed" ? 0 : cb.state === "half-open" ? 1 : 2
      lines.push(`severinno_circuit_breaker_state{circuit="${cb.name}"} ${code}`)
    }
    lines.push("")

    lines.push("# HELP severinno_circuit_breaker_failures Consecutive failure count")
    lines.push("# TYPE severinno_circuit_breaker_failures gauge")
    for (const cb of circuitStats) {
      lines.push(`severinno_circuit_breaker_failures{circuit="${cb.name}"} ${cb.failures}`)
    }
    lines.push("")

    lines.push("# HELP severinno_circuit_breaker_uptime_ratio Availability ratio (0.0 to 1.0)")
    lines.push("# TYPE severinno_circuit_breaker_uptime_ratio gauge")
    for (const cb of circuitStats) {
      lines.push(
        `severinno_circuit_breaker_uptime_ratio{circuit="${cb.name}"} ${(cb.uptimePercent / 100).toFixed(3)}`,
      )
    }
    lines.push("")
  }

  // Core Web Vitals telemetry metrics
  try {
    const webVitalsSummary = webVitalsRegistry.getSummary()
    lines.push(
      "# HELP severinno_web_vitals_compliance_score Core Web Vitals overall compliance percentage (0-100)",
    )
    lines.push("# TYPE severinno_web_vitals_compliance_score gauge")
    lines.push(`severinno_web_vitals_compliance_score ${webVitalsSummary.complianceScore}`)
    lines.push("")

    lines.push(
      "# HELP severinno_web_vitals_p75 75th percentile of Web Vitals metrics in milliseconds or unit",
    )
    lines.push("# TYPE severinno_web_vitals_p75 gauge")
    for (const [metric, stats] of Object.entries(webVitalsSummary.metrics)) {
      if (stats.count > 0) {
        lines.push(`severinno_web_vitals_p75{metric="${metric}"} ${stats.p75}`)
      }
    }
    lines.push("")
  } catch {
    // Registry not initialized
  }

  // Node.js process metrics
  const mem = process.memoryUsage()
  lines.push("# HELP severinno_process_memory_rss_bytes Resident Set Size in bytes")
  lines.push("# TYPE severinno_process_memory_rss_bytes gauge")
  lines.push(`severinno_process_memory_rss_bytes ${mem.rss}`)

  lines.push("# HELP severinno_process_memory_heap_used_bytes Heap used in bytes")
  lines.push("# TYPE severinno_process_memory_heap_used_bytes gauge")
  lines.push(`severinno_process_memory_heap_used_bytes ${mem.heapUsed}`)

  lines.push("# HELP severinno_process_uptime_seconds Process uptime in seconds")
  lines.push("# TYPE severinno_process_uptime_seconds counter")
  lines.push(`severinno_process_uptime_seconds ${Math.floor(process.uptime())}`)
  lines.push("")

  return lines.join("\n") + "\n"
}

export function resetMetrics(): void {
  requestDuration.clear()
  activeConnections = 0
}

// ── Business Metrics (DB-based) — original implementation ─────────────────

export type BusinessMetrics = {
  periodStart: string
  periodEnd: string
  users: {
    total: number
    clients: number
    providers: number
    verifiedProviders: number
    newLast30d: number
  }
  bookings: {
    total: number
    byStatus: Record<string, number>
    completed: number
    cancelled: number
    conversionRate: number | null
  }
  quotes: {
    total: number
    byStatus: Record<string, number>
    responded: number
    conversionToBooking: number | null
  }
  reviews: {
    total: number
    avgRating: number | null
  }
  revenue: {
    total: number
    paid: number
    pending: number
    avgBookingValue: number | null
  }
}

export async function getBusinessMetrics(days = 30): Promise<BusinessMetrics> {
  const since = new Date(Date.now() - days * 86400000)

  try {
    const [
      userCounts,
      newUsers,
      bookingCounts,
      bookingByStatus,
      quoteCounts,
      quoteByStatus,
      reviewAgg,
      paymentAgg,
      quoteBookings,
    ] = await Promise.all([
      db.user.groupBy({
        by: ["role"],
        _count: { id: true },
      }),
      db.user.count({ where: { createdAt: { gte: since } } }),
      db.booking.count(),
      db.booking.groupBy({
        by: ["status"],
        _count: { id: true },
      }),
      db.quoteRequest.count(),
      db.quoteRequest.groupBy({
        by: ["status"],
        _count: { id: true },
      }),
      db.review.aggregate({
        _avg: { rating: true },
        _count: { id: true },
      }),
      db.payment.aggregate({
        _sum: { amount: true },
        _count: { id: true },
        where: { status: "PAID" },
      }),
      db.booking.count({
        where: { quoteId: { not: null } },
      }),
    ])

    const clients = userCounts.find((u) => u.role === "CLIENT")
    const providers = userCounts.find((u) => u.role === "PROVIDER")
    const totalUsers = userCounts.reduce((acc, u) => acc + u._count.id, 0)

    const verifiedProviders = await db.user.count({
      where: { role: "PROVIDER", verified: true },
    })

    const bookingStatusMap: Record<string, number> = {}
    let completedBookings = 0
    let cancelledBookings = 0
    for (const b of bookingByStatus) {
      bookingStatusMap[b.status] = b._count.id
      if (b.status === "COMPLETED") completedBookings = b._count.id
      if (b.status === "CANCELLED") cancelledBookings = b._count.id
    }

    const quoteStatusMap: Record<string, number> = {}
    let respondedQuotes = 0
    for (const q of quoteByStatus) {
      quoteStatusMap[q.status] = q._count.id
      if (q.status === "RESPONDED" || q.status === "APPROVED") respondedQuotes += q._count.id
    }

    const totalBookings = bookingCounts
    const totalQuotes = quoteCounts
    const conversionRate = totalQuotes > 0 ? +(totalBookings / totalQuotes).toFixed(3) : null
    const quoteToBookingRate = totalQuotes > 0 ? +(quoteBookings / totalQuotes).toFixed(3) : null
    const avgBookingValue =
      totalBookings > 0 && paymentAgg._sum.amount
        ? +(toMoneyNumber(paymentAgg._sum.amount) / totalBookings).toFixed(2)
        : null

    return {
      periodStart: since.toISOString(),
      periodEnd: new Date().toISOString(),
      users: {
        total: totalUsers,
        clients: clients?._count.id ?? 0,
        providers: providers?._count.id ?? 0,
        verifiedProviders,
        newLast30d: newUsers,
      },
      bookings: {
        total: totalBookings,
        byStatus: bookingStatusMap,
        completed: completedBookings,
        cancelled: cancelledBookings,
        conversionRate,
      },
      quotes: {
        total: totalQuotes,
        byStatus: quoteStatusMap,
        responded: respondedQuotes,
        conversionToBooking: quoteToBookingRate,
      },
      reviews: {
        total: reviewAgg._count.id,
        avgRating: reviewAgg._avg.rating ? +reviewAgg._avg.rating.toFixed(2) : null,
      },
      revenue: {
        total: toMoneyNumber(paymentAgg._sum.amount),
        paid: paymentAgg._count.id,
        pending: await db.payment.count({ where: { status: "PENDING" } }),
        avgBookingValue,
      },
    }
  } catch (e) {
    logger.error({ err: e }, "failed to fetch business metrics")
    throw e
  }
}
