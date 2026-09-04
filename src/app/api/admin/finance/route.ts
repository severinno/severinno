export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { FEE_RATE } from "@/lib/constants"

type Period = "7d" | "30d" | "90d" | "12m" | "all"

/**
 * ADMIN: aggregated financial dashboard data.
 *
 * GET /api/admin/finance?period=30d&page=1&limit=20
 *
 * Returns:
 * - summary: { paid, pending, refunded, count } for each payment status
 * - monthlyRevenue: [{ month: "2026-01", total, count }]  (paid only)
 * - paymentMethodStats: [{ method, total, count }]
 * - transactions: paginated list of recent payments with booking details
 * - total, page, limit
 */
export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.admin)

    const { searchParams } = new URL(request.url)
    const period = (searchParams.get("period") ?? "30d") as Period
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "20") || 20))

    // Compute date filter
    const now = new Date()
    let dateFilter: Date | null = null
    switch (period) {
      case "7d":
        dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case "30d":
        dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case "90d":
        dateFilter = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      case "12m":
        dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1)
        break
      case "all":
        dateFilter = null
        break
    }

    const paymentWhere = dateFilter ? { createdAt: { gte: dateFilter } } : {}

    // Build date ranges for MRR calculation (3 complete months before/after)
    const nowMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const mrrCurrentEnd = new Date(nowMonth)
    const mrrCurrentStart = new Date(nowMonth)
    mrrCurrentStart.setMonth(mrrCurrentStart.getMonth() - 3)
    const mrrPreviousEnd = new Date(mrrCurrentStart)
    const mrrPreviousStart = new Date(mrrCurrentStart)
    mrrPreviousStart.setMonth(mrrPreviousStart.getMonth() - 3)

    // Commission: platform fee is fixed (FEE_RATE)
    const commissionPercent = FEE_RATE * 100

    const [
      summary,
      monthlyRaw,
      methodRaw,
      transactions,
      total,
      mrrCurrent,
      mrrPrevious,
      providerRaw,
    ] = await Promise.all([
      // Summary: aggregate by payment status
      db.payment.groupBy({
        by: ["status"],
        where: paymentWhere,
        _sum: { amount: true },
        _count: { _all: true },
      }),

      // Monthly revenue (paid payments only)
      db.payment.findMany({
        where: { ...paymentWhere, status: "PAID" },
        select: { amount: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),

      // Payment method stats
      db.payment.groupBy({
        by: ["method"],
        where: { ...paymentWhere, status: "PAID" },
        _sum: { amount: true },
        _count: { _all: true },
      }),

      // Transaction history
      db.payment.findMany({
        where: paymentWhere,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          booking: {
            select: {
              id: true,
              scheduledAt: true,
              status: true,
              client: { select: { id: true, name: true, email: true } },
              provider: { select: { id: true, name: true } },
              service: { select: { id: true, title: true } },
            },
          },
        },
      }),

      // Total count for pagination
      db.payment.count({ where: paymentWhere }),

      // MRR current period (last 3 complete months)
      db.payment.findMany({
        where: {
          status: "PAID",
          createdAt: { gte: mrrCurrentStart, lt: mrrCurrentEnd },
        },
        select: { amount: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),

      // MRR previous period (3 months before current)
      db.payment.findMany({
        where: {
          status: "PAID",
          createdAt: { gte: mrrPreviousStart, lt: mrrPreviousEnd },
        },
        select: { amount: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),

      // Per-provider aggregation (PAID payments only)
      db.payment.findMany({
        where: { ...paymentWhere, status: "PAID" },
        select: {
          amount: true,
          booking: {
            select: {
              provider: {
                select: { id: true, name: true, email: true, avatarUrl: true },
              },
            },
          },
        },
      }),
    ])

    // Build summary object
    const summaryByStatus = {
      PAID: { total: 0, count: 0 },
      PENDING: { total: 0, count: 0 },
      REFUNDED: { total: 0, count: 0 },
    }
    for (const row of summary) {
      const s = row.status as keyof typeof summaryByStatus
      if (s in summaryByStatus) {
        summaryByStatus[s] = {
          total: row._sum.amount ?? 0,
          count: row._count._all,
        }
      }
    }

    // Average ticket: total PAID / count PAID
    const paidTotal = summaryByStatus.PAID.total
    const paidCount = summaryByStatus.PAID.count
    const averageTicket = paidCount > 0 ? Math.round(paidTotal / paidCount) : 0

    // MRR: monthly average of paid payments over exactly 3 months
    const MRR_MONTH_COUNT = 3
    function calcMrr(payments: Array<{ amount: number; createdAt: Date }>): number {
      if (payments.length === 0) return 0
      const total = payments.reduce((sum, p) => sum + p.amount, 0)
      return Math.round(total / MRR_MONTH_COUNT)
    }

    const mrrValue = calcMrr(mrrCurrent)
    const previousMrr = calcMrr(mrrPrevious)
    const mrrGrowth = previousMrr > 0 ? ((mrrValue - previousMrr) / previousMrr) * 100 : 0

    // Monthly MRR data (per-month breakdown for chart)
    function buildMonthlyMrr(
      payments: Array<{ amount: number; createdAt: Date }>,
    ): Array<{ month: string; label: string; total: number }> {
      const map = new Map<string, number>()
      for (const p of payments) {
        const key = `${p.createdAt.getFullYear()}-${String(p.createdAt.getMonth() + 1).padStart(2, "0")}`
        map.set(key, (map.get(key) ?? 0) + p.amount)
      }
      const monthNames = [
        "Jan",
        "Fev",
        "Mar",
        "Abr",
        "Mai",
        "Jun",
        "Jul",
        "Ago",
        "Set",
        "Out",
        "Nov",
        "Dez",
      ]
      const result: Array<{ month: string; label: string; total: number }> = []
      const iter = new Date(mrrPreviousStart)
      while (iter < mrrCurrentEnd) {
        const key = `${iter.getFullYear()}-${String(iter.getMonth() + 1).padStart(2, "0")}`
        result.push({
          month: key,
          label: `${monthNames[iter.getMonth()]!}/${String(iter.getFullYear()).slice(2)}`,
          total: map.get(key) ?? 0,
        })
        iter.setMonth(iter.getMonth() + 1)
      }
      return result
    }

    const mrrHistory = buildMonthlyMrr([...mrrPrevious, ...mrrCurrent])

    // Build monthly revenue (aggregate by YYYY-MM)
    const monthlyMap = new Map<string, { total: number; count: number }>()
    for (const p of monthlyRaw) {
      const key = `${p.createdAt.getFullYear()}-${String(p.createdAt.getMonth() + 1).padStart(2, "0")}`
      const existing = monthlyMap.get(key) ?? { total: 0, count: 0 }
      existing.total += p.amount
      existing.count += 1
      monthlyMap.set(key, existing)
    }

    // Create full month range for the selected period
    const monthlyRevenue: Array<{ month: string; label: string; total: number; count: number }> = []
    if (dateFilter) {
      const start = new Date(dateFilter)
      const end = new Date(now)
      // Reset to first of month
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
      end.setDate(1)
      end.setHours(0, 0, 0, 0)

      const iter = new Date(start)
      while (iter <= end) {
        const key = `${iter.getFullYear()}-${String(iter.getMonth() + 1).padStart(2, "0")}`
        const monthNames = [
          "Jan",
          "Fev",
          "Mar",
          "Abr",
          "Mai",
          "Jun",
          "Jul",
          "Ago",
          "Set",
          "Out",
          "Nov",
          "Dez",
        ]
        const data = monthlyMap.get(key) ?? { total: 0, count: 0 }
        monthlyRevenue.push({
          month: key,
          label: `${monthNames[iter.getMonth()]!}/${String(iter.getFullYear()).slice(2)}`,
          total: data.total,
          count: data.count,
        })
        iter.setMonth(iter.getMonth() + 1)
      }
    } else {
      // All time: show all months with data
      for (const [key, data] of monthlyMap) {
        const [, m] = key.split("-")
        const monthNames = [
          "Jan",
          "Fev",
          "Mar",
          "Abr",
          "Mai",
          "Jun",
          "Jul",
          "Ago",
          "Set",
          "Out",
          "Nov",
          "Dez",
        ]
        monthlyRevenue.push({
          month: key,
          label: `${monthNames[parseInt(m!) - 1]!}/${key.slice(2, 4)}`,
          total: data.total,
          count: data.count,
        })
      }
    }

    // Per-provider aggregation
    const providerMap = new Map<
      string,
      {
        id: string
        name: string
        email: string
        avatarUrl: string | null
        total: number
        count: number
        commission: number
        net: number
      }
    >()
    for (const p of providerRaw) {
      const provider = p.booking?.provider
      if (!provider) continue
      const existing = providerMap.get(provider.id) ?? {
        id: provider.id,
        name: provider.name,
        email: provider.email,
        avatarUrl: provider.avatarUrl,
        total: 0,
        count: 0,
        commission: 0,
        net: 0,
      }
      existing.total += p.amount
      existing.count += 1
      const fee = Math.round(p.amount * FEE_RATE * 100) / 100
      existing.commission += fee
      existing.net += p.amount - fee
      providerMap.set(provider.id, existing)
    }

    const ROUND2 = (v: number) => Math.round(v * 100) / 100

    const providerStats = Array.from(providerMap.values())
      .sort((a, b) => b.total - a.total)
      .map((p) => ({
        ...p,
        total: ROUND2(p.total),
        commission: ROUND2(p.commission),
        net: ROUND2(p.net),
      }))

    // Payment method stats
    const methodStats = methodRaw.map((r) => ({
      method: r.method,
      total: r._sum.amount ?? 0,
      count: r._count._all,
    }))

    return NextResponse.json({
      summary: summaryByStatus,
      monthlyRevenue,
      paymentMethods: methodStats,
      transactions,
      total,
      page,
      limit,
      period,
      averageTicket,
      commissionPercent,
      providerStats,
      mrr: {
        current: mrrValue,
        previous: previousMrr,
        growth: Math.round(mrrGrowth * 10) / 10,
        history: mrrHistory,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
