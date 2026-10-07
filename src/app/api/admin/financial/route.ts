export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"

import { FEE_RATE } from "@/lib/wallet"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withRoute } from "@/lib/api-route"
import { toMoneyNumber } from "@/lib/money"

// =============================================================================
// GET /api/admin/financial — Admin financial dashboard
// =============================================================================
// Returns: revenue metrics, projections, top providers, commission breakdown
// =============================================================================

export const GET = withRoute("api.admin.financial.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.admin)
  const session = await requireUser()
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const now = new Date()
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const thisYear = new Date(now.getFullYear(), 0, 1)

  // ── Parallel queries (use aggregate instead of findMany to avoid OOM) ──
  const [
    thisMonthStats,
    lastMonthStats,
    yearStats,
    thisMonthProviderStats,
    yearMonthlyStats,
    totalProviders,
    totalClients,
    activeProviders,
  ] = await Promise.all([
    // This month — aggregate instead of loading all rows
    db.booking.aggregate({
      where: { paymentStatus: "PAID", createdAt: { gte: thisMonth } },
      _sum: { amount: true },
      _count: { id: true },
    }),
    // Last month
    db.booking.aggregate({
      where: { paymentStatus: "PAID", createdAt: { gte: lastMonth, lt: thisMonth } },
      _sum: { amount: true },
      _count: { id: true },
    }),
    // This year
    db.booking.aggregate({
      where: { paymentStatus: "PAID", createdAt: { gte: thisYear } },
      _sum: { amount: true },
      _count: { id: true },
    }),
    // Top providers this month (groupBy providerId)
    db.booking.groupBy({
      by: ["providerId"],
      where: { paymentStatus: "PAID", createdAt: { gte: thisMonth } },
      _sum: { amount: true },
      _count: { id: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 10,
    }),
    // Monthly trend: groupBy month for the year (use raw SQL for date_trunc)
    db.$queryRaw<Array<{ month: string; revenue: bigint; count: bigint }>>`
        SELECT
          to_char("createdAt", 'YYYY-MM') AS month,
          SUM(amount) AS revenue,
          COUNT(*) AS count
        FROM "Booking"
        WHERE "paymentStatus" = 'PAID' AND "createdAt" >= ${thisYear}
        GROUP BY to_char("createdAt", 'YYYY-MM')
        ORDER BY month ASC
      `,
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

  // ── Computar métricas a partir dos agregados (sem carregar linhas em memória) ──
  // money_decimal: toMoneyNumber preserva a exatidão do Decimal (base 10)
  // no único ponto Decimal→number da rota; o resto da aritmética parte daí
  const thisMonthRevenue = toMoneyNumber(thisMonthStats._sum.amount)
  const lastMonthRevenue = toMoneyNumber(lastMonthStats._sum.amount)
  const yearRevenue = toMoneyNumber(yearStats._sum.amount)
  const thisMonthBookingsCount = thisMonthStats._count.id

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

  // ── Top providers this month (já vem do groupBy) ──────────────
  const topProviderIds = thisMonthProviderStats.map((p) => p.providerId)

  const topProvidersData = await db.user.findMany({
    where: { id: { in: topProviderIds } },
    select: { id: true, name: true, avatarUrl: true },
  })
  const topProviderInfoMap = new Map(topProvidersData.map((u) => [u.id, u]))

  const topProviders = thisMonthProviderStats.map((p) => {
    const user = topProviderInfoMap.get(p.providerId)
    const revenue = toMoneyNumber(p._sum.amount)
    return {
      id: p.providerId,
      name: user?.name ?? "Desconhecido",
      avatarUrl: user?.avatarUrl,
      revenue: Math.round(revenue * 100) / 100,
      commission: Math.round(revenue * FEE_RATE * 100) / 100,
      bookingCount: p._count.id,
    }
  })

  // ── Monthly trend (já agregado via SQL raw) ───────────────────
  const monthlyTrend: Array<{
    month: string
    revenue: number
    commission: number
    bookings: number
  }> = yearMonthlyStats.map((row) => ({
    month: row.month,
    revenue: Math.round(Number(row.revenue) * 100) / 100,
    commission: Math.round(Number(row.revenue) * FEE_RATE * 100) / 100,
    bookings: Number(row.count),
  }))

  return NextResponse.json({
    // Current metrics
    thisMonth: {
      revenue: Math.round(thisMonthRevenue * 100) / 100,
      commission: thisMonthCommission,
      bookings: thisMonthBookingsCount,
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
})
