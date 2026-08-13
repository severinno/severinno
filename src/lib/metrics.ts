import "server-only"
import { db } from "./db"
import logger from "./logger"

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
    const _admins = userCounts.find((u) => u.role === "ADMIN")
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
