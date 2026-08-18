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
import logger from "./logger"

// ── Request Duration Histogram ────────────────────────────────────────────

const DURATION_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, Infinity]

const requestDuration = new Map<
  string,
  { count: number; sum: number; buckets: number[] }
>()

export function recordRequestDuration(
  path: string,
  status: number,
  durationMs: number,
): void {
  const key = `${normalizePath(path)}:${status}`
  let entry = requestDuration.get(key)

  if (!entry) {
    entry = { count: 0, sum: 0, buckets: new Array(DURATION_BUCKETS.length).fill(0) }
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
    .replace(/\/c[a-z0-9]+/g, "/:id")
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

  for (const [key, entry] of requestDuration.entries()) {
    const [path, status] = key.split(":")
    for (let i = 0; i < DURATION_BUCKETS.length; i++) {
      lines.push(
        `http_request_duration_ms_bucket{path="${path}",status="${status}",le="${DURATION_BUCKETS[i] === Infinity ? "+Inf" : DURATION_BUCKETS[i]}"} ${entry.buckets[i]}`,
      )
    }
    lines.push(`http_request_duration_ms_count{path="${path}",status="${status}"} ${entry.count}`)
    lines.push(`http_request_duration_ms_sum{path="${path}",status="${status}"} ${entry.sum.toFixed(2)}`)
  }
  lines.push("")

  lines.push("# HELP http_active_connections Number of active HTTP connections")
  lines.push("# TYPE http_active_connections gauge")
  lines.push(`http_active_connections ${activeConnections}`)

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
        ? +(paymentAgg._sum.amount / totalBookings).toFixed(2)
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
        total: paymentAgg._sum.amount ?? 0,
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
