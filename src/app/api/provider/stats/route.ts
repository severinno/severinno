import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { startOfDay, subDays, startOfMonth, endOfMonth, startOfYear } from "date-fns"

export async function GET() {
  try {
    const session = await requireUser()
    if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Apenas prestadores podem acessar estas estatísticas" },
        { status: 403 },
      )
    }

    const userId = session.userId
    const today = new Date()
    const todayStart = startOfDay(today)
    const weekAgo = subDays(today, 7)
    const monthStart = startOfMonth(today)
    const monthEnd = endOfMonth(today)
    const yearStart = startOfYear(today)

    const [
      totalBookings,
      bookingsToday,
      bookingsThisWeek,
      bookingsByStatus,
      revenueAllTime,
      revenueThisMonth,
      revenueThisYear,
      totalReviews,
      reviewsAvg,
      pendingQuotes,
      pendingQuoteItems,
    ] = await Promise.all([
      db.booking.count({ where: { providerId: userId } }),
      db.booking.count({
        where: { providerId: userId, scheduledAt: { gte: todayStart }, status: { not: "CANCELLED" } },
      }),
      db.booking.count({
        where: { providerId: userId, scheduledAt: { gte: weekAgo }, status: { not: "CANCELLED" } },
      }),
      db.booking.groupBy({
        by: ["status"],
        where: { providerId: userId },
        _count: { id: true },
      }),
      db.booking.aggregate({
        where: { providerId: userId, paymentStatus: "PAID" },
        _sum: { amount: true },
      }),
      db.booking.aggregate({
        where: { providerId: userId, paymentStatus: "PAID", scheduledAt: { gte: monthStart, lte: monthEnd } },
        _sum: { amount: true },
      }),
      db.booking.aggregate({
        where: { providerId: userId, paymentStatus: "PAID", scheduledAt: { gte: yearStart } },
        _sum: { amount: true },
      }),
      db.review.count({ where: { providerId: userId } }),
      db.review.aggregate({ where: { providerId: userId }, _avg: { rating: true } }),
      db.quoteRequest.count({ where: { providerId: userId, status: "PENDING" } }),
      db.quoteItem.count({ where: { providerId: userId, status: "PENDING" } }),
    ])

    const averageRating = reviewsAvg._avg.rating ?? 0
    const revenueAll = revenueAllTime._sum.amount ?? 0
    const revenueMonth = revenueThisMonth._sum.amount ?? 0
    const revenueYear = revenueThisYear._sum.amount ?? 0

    return NextResponse.json({
      bookings: {
        total: totalBookings,
        today: bookingsToday,
        thisWeek: bookingsThisWeek,
        byStatus: bookingsByStatus.reduce(
          (acc, b) => {
            acc[b.status] = b._count.id
            return acc
          },
          {} as Record<string, number>,
        ),
      },
      revenue: {
        allTime: Number(revenueAll),
        thisMonth: Number(revenueMonth),
        thisYear: Number(revenueYear),
      },
      reviews: {
        total: totalReviews,
        average: Number(averageRating.toFixed(1)),
      },
      quotes: {
        pending: pendingQuotes,
        pendingItems: pendingQuoteItems,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
