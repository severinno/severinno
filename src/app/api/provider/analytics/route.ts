export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"
import { toMoneyNumber } from "@/lib/money"
import { subMonths, startOfMonth, endOfMonth, subDays } from "date-fns"

/**
 * GET /api/provider/analytics
 * Provider analytics dashboard metrics:
 * - Escrow balance currently retained awaiting completion/release
 * - Quote proposal acceptance and conversion rate
 * - Peak demand hours in the provider's region
 * - Monthly revenue & completed jobs trends
 */
export const GET = withRoute("api.provider.analytics.GET", async (_request) => {
  const session = await requireUser()
  if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Apenas prestadores podem acessar estas métricas" },
      { status: 403 },
    )
  }

  const userId = session.userId

  // 1. Escrow balance currently retained awaiting service completion & release
  const escrowBookings = await db.booking.findMany({
    where: {
      providerId: userId,
      paymentStatus: "PAID",
      escrowReleasedAt: null,
      status: { notIn: ["CANCELLED"] },
    },
    select: { amount: true, id: true, status: true, scheduledAt: true },
  })

  const escrowRetainedAmount = escrowBookings.reduce((sum, b) => sum + toMoneyNumber(b.amount), 0)

  // 2. Quote Conversion & Funnel
  const [totalQuotes, acceptedQuotes, rejectedQuotes, pendingQuotes] = await Promise.all([
    db.quoteRequest.count({ where: { providerId: userId } }),
    db.quoteRequest.count({ where: { providerId: userId, status: "APPROVED" } }),
    db.quoteRequest.count({ where: { providerId: userId, status: "REJECTED" } }),
    db.quoteRequest.count({ where: { providerId: userId, status: "PENDING" } }),
  ])

  const conversionRate =
    totalQuotes > 0 ? Number(((acceptedQuotes / totalQuotes) * 100).toFixed(1)) : 0

  // 3. Peak Demand Hours (distribution of bookings created in the last 60 days)
  const recentBookings = await db.booking.findMany({
    where: {
      providerId: userId,
      createdAt: { gte: subDays(new Date(), 60) },
    },
    select: { createdAt: true },
  })

  const hourCounts: Record<number, number> = {}
  for (let h = 0; h < 24; h++) {
    hourCounts[h] = 0
  }

  for (const b of recentBookings) {
    const hour = new Date(b.createdAt).getHours()
    hourCounts[hour] = (hourCounts[hour] || 0) + 1
  }

  const peakDemandHours = Object.entries(hourCounts).map(([hourStr, count]) => {
    const hour = Number(hourStr)
    return {
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      count,
    }
  })

  const topPeakHours = [...peakDemandHours]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .filter((h) => h.count > 0)
    .map((h) => h.label)

  // 4. Monthly Trend (last 6 months)
  const now = new Date()
  const monthlyTrends: Array<{
    month: string
    revenue: number
    completedJobs: number
    avgTicket: number
  }> = []

  const startOf6MonthsAgo = startOfMonth(subMonths(now, 5))
  const endOfCurrentMonth = endOfMonth(now)

  const sixMonthsBookings = await db.booking.findMany({
    where: {
      providerId: userId,
      status: "COMPLETED",
      paymentStatus: "PAID",
      scheduledAt: { gte: startOf6MonthsAgo, lte: endOfCurrentMonth },
    },
    select: { amount: true, scheduledAt: true },
  })

  for (let i = 5; i >= 0; i--) {
    const targetDate = subMonths(now, i)
    const start = startOfMonth(targetDate)
    const end = endOfMonth(targetDate)

    const monthBookings = sixMonthsBookings.filter((b) => {
      if (!b.scheduledAt) return false
      const d = new Date(b.scheduledAt)
      return d >= start && d <= end
    })

    const monthRevenue = monthBookings.reduce((sum, b) => sum + toMoneyNumber(b.amount), 0)
    const completedJobs = monthBookings.length
    const avgTicket = completedJobs > 0 ? Math.round(monthRevenue / completedJobs) : 0

    monthlyTrends.push({
      month: targetDate.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
      revenue: monthRevenue,
      completedJobs,
      avgTicket,
    })
  }

  // 5. Engagement & Client Retention
  const [favoriteCount, totalReviews, reviewAggregate] = await Promise.all([
    db.favorite.count({ where: { providerId: userId } }),
    db.review.count({ where: { providerId: userId } }),
    db.review.aggregate({
      where: { providerId: userId },
      _avg: { rating: true },
    }),
  ])

  return NextResponse.json({
    ok: true,
    escrow: {
      retainedAmount: escrowRetainedAmount,
      heldBookingsCount: escrowBookings.length,
    },
    quotes: {
      total: totalQuotes,
      accepted: acceptedQuotes,
      rejected: rejectedQuotes,
      pending: pendingQuotes,
      conversionRate,
    },
    demand: {
      peakHours: topPeakHours.length > 0 ? topPeakHours : ["09:00", "14:00", "17:00"],
      hourlyDistribution: peakDemandHours,
    },
    trends: monthlyTrends,
    engagement: {
      favoriteCount,
      totalReviews,
      avgRating: Number((reviewAggregate._avg.rating ?? 0).toFixed(1)),
    },
  })
})
