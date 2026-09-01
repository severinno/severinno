import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { FEE_RATE } from "@/lib/wallet"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

// =============================================================================
// GET /api/admin/financial — Admin financial dashboard
// =============================================================================
// Returns: revenue metrics, projections, top providers, commission breakdown
// =============================================================================

export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.admin)
    const session = await requireUser()
    if (session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const now = new Date()
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const thisYear = new Date(now.getFullYear(), 0, 1)

    // ── Parallel queries ────────────────────────────────────────────────
    const [
      thisMonthBookings,
      lastMonthBookings,
      yearBookings,
      totalProviders,
      totalClients,
      activeProviders,
    ] = await Promise.all([
      // This month
      db.booking.findMany({
        where: {
          paymentStatus: "PAID",
          createdAt: { gte: thisMonth },
        },
        select: { amount: true, providerId: true, createdAt: true },
      }),
      // Last month
      db.booking.findMany({
        where: {
          paymentStatus: "PAID",
          createdAt: { gte: lastMonth, lt: thisMonth },
        },
        select: { amount: true },
      }),
      // This year
      db.booking.findMany({
        where: {
          paymentStatus: "PAID",
          createdAt: { gte: thisYear },
        },
        select: { amount: true, providerId: true, createdAt: true },
      }),
      // Counts
      db.user.count({ where: { role: "PROVIDER", active: true } }),
      db.user.count({ where: { role: "CLIENT", active: true } }),
      db.user.count({
        where: {
          role: "PROVIDER",
          active: true,
          lat: { not: null },
          lng: { not: null },
        },
      }),
    ])

    // ── Compute metrics ────────────────────────────────────────────────
    const thisMonthRevenue = thisMonthBookings.reduce((s, b) => s + b.amount, 0)
    const lastMonthRevenue = lastMonthBookings.reduce((s, b) => s + b.amount, 0)
    const yearRevenue = yearBookings.reduce((s, b) => s + b.amount, 0)

    const thisMonthCommission = Math.round(thisMonthRevenue * FEE_RATE * 100) / 100
    const lastMonthCommission = Math.round(lastMonthRevenue * FEE_RATE * 100) / 100
    const yearCommission = Math.round(yearRevenue * FEE_RATE * 100) / 100

    // Growth rate
    const growthRate =
      lastMonthRevenue > 0
        ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
        : thisMonthRevenue > 0
          ? 100
          : 0

    // Projection (simple linear: if trend continues)
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const dayOfMonth = now.getDate()
    const dailyRate = dayOfMonth > 0 ? thisMonthRevenue / dayOfMonth : 0
    const projectedMonth = Math.round(dailyRate * daysInMonth * 100) / 100
    const projectedCommission = Math.round(projectedMonth * FEE_RATE * 100) / 100

    // ── Top providers this month ───────────────────────────────────────
    const providerMap = new Map<string, { name: string; revenue: number; count: number }>()
    for (const b of thisMonthBookings) {
      const existing = providerMap.get(b.providerId) ?? { name: "", revenue: 0, count: 0 }
      existing.revenue += b.amount
      existing.count++
      providerMap.set(b.providerId, existing)
    }

    const topProviderIds = Array.from(providerMap.entries())
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .slice(0, 10)
      .map(([id]) => id)

    const topProvidersData = await db.user.findMany({
      where: { id: { in: topProviderIds } },
      select: { id: true, name: true, avatarUrl: true },
    })

    const topProviders = topProviderIds.map((id) => {
      const stats = providerMap.get(id)!
      const user = topProvidersData.find((u) => u.id === id)
      return {
        id,
        name: user?.name ?? "Desconhecido",
        avatarUrl: user?.avatarUrl,
        revenue: Math.round(stats.revenue * 100) / 100,
        commission: Math.round(stats.revenue * FEE_RATE * 100) / 100,
        bookingCount: stats.count,
      }
    })

    // ── Monthly trend (last 12 months) ────────────────────────────────
    const monthlyTrend: Array<{
      month: string
      revenue: number
      commission: number
      bookings: number
    }> = []

    for (let i = 11; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      const monthBookings = yearBookings.filter((b) => b.createdAt >= m && b.createdAt < mEnd)
      const revenue = monthBookings.reduce((s, b) => s + b.amount, 0)
      monthlyTrend.push({
        month: m.toISOString().slice(0, 7),
        revenue: Math.round(revenue * 100) / 100,
        commission: Math.round(revenue * FEE_RATE * 100) / 100,
        bookings: monthBookings.length,
      })
    }

    return NextResponse.json({
      // Current metrics
      thisMonth: {
        revenue: Math.round(thisMonthRevenue * 100) / 100,
        commission: thisMonthCommission,
        bookings: thisMonthBookings.length,
        growthRate,
      },
      lastMonth: {
        revenue: Math.round(lastMonthRevenue * 100) / 100,
        commission: lastMonthCommission,
      },
      year: {
        revenue: Math.round(yearRevenue * 100) / 100,
        commission: yearCommission,
      },
      projection: {
        monthRevenue: projectedMonth,
        monthCommission: projectedCommission,
        confidence: dayOfMonth >= 15 ? "high" : "low",
      },
      providers: {
        total: totalProviders,
        active: activeProviders,
        clients: totalClients,
        top: topProviders,
      },
      monthlyTrend,
    })
  } catch (e) {
    return handleError(e)
  }
}
