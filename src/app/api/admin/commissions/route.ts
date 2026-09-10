export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { FEE_RATE } from "@/lib/wallet"

type CommissionSummary = {
  year: number
  // Totals
  grossRevenue: number // Soma de todos os bookings PAID
  platformCommission: number // 15% do gross
  providerEarnings: number // 85% do gross
  bookingCount: number // Total de bookings PAID
  completedCount: number // Apenas COMPLETED

  // Monthly breakdown (selected year)
  monthly: Array<{
    month: string
    gross: number
    commission: number
    providerNet: number
    bookingCount: number
  }>

  // Per-provider breakdown
  providers: Array<{
    id: string
    name: string
    avatarUrl: string | null
    bookingCount: number
    grossRevenue: number
    commission: number
    netEarnings: number
    completedCount: number
  }>
}

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.admin)

    const { searchParams } = new URL(request.url)
    const yearParam = searchParams.get("year")
    const selectedYear = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
    const providerId = searchParams.get("providerId") || undefined

    // Build date range for the selected year
    const yearStart = new Date(selectedYear, 0, 1)
    const yearEnd = new Date(selectedYear + 1, 0, 1)

    // Build where clause
    const where: Record<string, unknown> = {
      paymentStatus: "PAID",
      createdAt: { gte: yearStart, lt: yearEnd },
    }
    if (providerId) {
      where.providerId = providerId
    }

    // Aggregate totals via SQL
    const [bookingStats, completedCount] = await Promise.all([
      db.booking.aggregate({
        where,
        _sum: { amount: true },
        _count: { id: true },
      }),
      db.booking.count({
        where: { ...where, status: "COMPLETED" },
      }),
    ])

    const grossRevenue = bookingStats._sum.amount ?? 0
    const bookingCount = bookingStats._count.id
    const platformCommission = Math.round(grossRevenue * FEE_RATE * 100) / 100
    const providerEarnings = Math.round(grossRevenue * (1 - FEE_RATE) * 100) / 100

    // Monthly breakdown via raw SQL com date_trunc (groupBy("createdAt") agrupava por ms)
    const monthlyStats = await db.$queryRaw<Array<{ month: string; gross: bigint; count: bigint }>>`
      SELECT
        to_char("createdAt", 'YYYY-MM') AS month,
        SUM(amount) AS gross,
        COUNT(*) AS count
      FROM "Booking"
      WHERE "paymentStatus" = 'PAID'
        AND "createdAt" >= ${yearStart}
        AND "createdAt" < ${yearEnd}
        ${providerId ? db.$queryRaw`AND "providerId" = ${providerId}` : db.$queryRaw``}
      GROUP BY to_char("createdAt", 'YYYY-MM')
      ORDER BY month ASC
    `

    const monthly = monthlyStats.map((m) => ({
      month: m.month,
      gross: Math.round(Number(m.gross) * 100) / 100,
      commission: Math.round(Number(m.gross) * FEE_RATE * 100) / 100,
      providerNet: Math.round(Number(m.gross) * (1 - FEE_RATE) * 100) / 100,
      bookingCount: Number(m.count),
    }))

    // Per-provider breakdown via SQL groupBy
    const providerStats = await db.booking.groupBy({
      by: ["providerId"],
      where,
      _sum: { amount: true },
      _count: { id: true },
      orderBy: { _sum: { amount: "desc" } },
    })

    const providerIds = providerStats.map((p) => p.providerId)
    const providerUsers = await db.user.findMany({
      where: { id: { in: providerIds } },
      select: { id: true, name: true, avatarUrl: true },
    })
    const providerInfoMap = new Map(providerUsers.map((p) => [p.id, p]))

    // Count completed per provider
    const completedByProvider = await db.booking.groupBy({
      by: ["providerId"],
      where: { ...where, status: "COMPLETED" },
      _count: { id: true },
    })
    const completedMap = new Map(completedByProvider.map((c) => [c.providerId, c._count.id]))

    const providers = providerStats.map((p) => {
      const info = providerInfoMap.get(p.providerId)
      const gross = p._sum.amount ?? 0
      return {
        id: p.providerId,
        name: info?.name ?? "Desconhecido",
        avatarUrl: info?.avatarUrl ?? null,
        bookingCount: p._count.id,
        grossRevenue: Math.round(gross * 100) / 100,
        commission: Math.round(gross * FEE_RATE * 100) / 100,
        netEarnings: Math.round(gross * (1 - FEE_RATE) * 100) / 100,
        completedCount: completedMap.get(p.providerId) ?? 0,
      }
    })

    return NextResponse.json({
      year: selectedYear,
      grossRevenue: Math.round(grossRevenue * 100) / 100,
      platformCommission,
      providerEarnings,
      bookingCount,
      completedCount,
      monthly,
      providers,
    } satisfies CommissionSummary)
  } catch (e) {
    return handleError(e)
  }
}
