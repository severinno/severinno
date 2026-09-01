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

    // Monthly breakdown via SQL groupBy
    const monthlyStats = await db.booking.groupBy({
      by: ["createdAt"],
      where,
      _sum: { amount: true },
      _count: { id: true },
      orderBy: { createdAt: "asc" },
    })

    const monthlyMap = new Map<string, { gross: number; count: number }>()
    for (const m of monthlyStats) {
      const d = new Date(m.createdAt)
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
      const entry = monthlyMap.get(key) ?? { gross: 0, count: 0 }
      entry.gross += m._sum.amount ?? 0
      entry.count += m._count.id
      monthlyMap.set(key, entry)
    }

    const monthly = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        gross: Math.round(data.gross * 100) / 100,
        commission: Math.round(data.gross * FEE_RATE * 100) / 100,
        providerNet: Math.round(data.gross * (1 - FEE_RATE) * 100) / 100,
        bookingCount: data.count,
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
