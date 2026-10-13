export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { FEE_RATE } from "@/lib/constants"
import { toMoneyNumber } from "@/lib/money"
import { Prisma } from "@prisma/client"

import { withRoute } from "@/lib/api-route"

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
export const GET = withRoute("api.admin.finance.GET", async (request) => {
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
    escrowHeldStats,
    openDisputes,
  ] = await Promise.all([
    // Summary: aggregate by payment status
    db.payment.groupBy({
      by: ["status"],
      where: paymentWhere,
      _sum: { amount: true },
      _count: { _all: true },
    }),

    // Monthly revenue (paid payments only) — groupBy mês em vez de findMany ilimitado
    db.$queryRaw<Array<{ month: string; total: bigint; count: bigint }>>`
        SELECT
          to_char("createdAt", 'YYYY-MM') AS month,
          SUM(amount) AS total,
          COUNT(*) AS count
        FROM "Payment"
        WHERE "status" = 'PAID' ${dateFilter ? Prisma.sql`AND "createdAt" >= ${dateFilter}` : Prisma.empty}
        GROUP BY to_char("createdAt", 'YYYY-MM')
        ORDER BY month ASC
      `,

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

    // MRR current period (last 3 complete months) — aggregate em vez de findMany
    db.payment.aggregate({
      where: {
        status: "PAID",
        createdAt: { gte: mrrCurrentStart, lt: mrrCurrentEnd },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),

    // MRR previous period (3 months before current)
    db.payment.aggregate({
      where: {
        status: "PAID",
        createdAt: { gte: mrrPreviousStart, lt: mrrPreviousEnd },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),

    // Per-provider aggregation (PAID payments only) — groupBy providerId (corrigido joins e colunas)
    db.$queryRaw<
      Array<{
        providerId: string
        name: string
        email: string
        avatarUrl: string | null
        total: bigint
        count: bigint
      }>
    >`
        SELECT
          b."providerId" AS "providerId",
          u.name,
          u.email,
          u."avatarUrl",
          SUM(pay.amount) AS total,
          COUNT(*) AS count
        FROM "Payment" pay
        JOIN "Booking" b ON b.id = pay."bookingId"
        JOIN "User" u ON u.id = b."providerId"
        WHERE pay.status = 'PAID' ${dateFilter ? Prisma.sql`AND pay."createdAt" >= ${dateFilter}` : Prisma.empty}
        GROUP BY b."providerId", u.name, u.email, u."avatarUrl"
        ORDER BY total DESC
      `,

    // Escrow custody: fundos retidos em garantia nos agendamentos
    db.booking
      ? db.booking.aggregate({
          where: {
            paymentStatus: "HELD",
            escrowReleasedAt: null,
          },
          _sum: { amount: true },
          _count: { id: true },
        })
      : Promise.resolve({ _sum: { amount: null }, _count: { id: 0 } }),

    // Disputas abertas / em litígio
    db.dispute
      ? db.dispute.findMany({
          where: { status: "OPEN" },
          select: {
            id: true,
            booking: { select: { amount: true } },
          },
        })
      : Promise.resolve([]),
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
        total: toMoneyNumber(row._sum.amount),
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
  const mrrValue = Math.round(Number(mrrCurrent._sum.amount ?? 0) / MRR_MONTH_COUNT)
  const previousMrr = Math.round(Number(mrrPrevious._sum.amount ?? 0) / MRR_MONTH_COUNT)
  const mrrGrowth = previousMrr > 0 ? ((mrrValue - previousMrr) / previousMrr) * 100 : 0

  // Monthly MRR data — usar o raw SQL que já agrupa por mês
  async function buildMrrHistory(): Promise<
    Array<{ month: string; label: string; total: number }>
  > {
    const rows = await db.$queryRaw<Array<{ month: string; total: bigint }>>`
        SELECT
          to_char("createdAt", 'YYYY-MM') AS month,
          SUM(amount) AS total
        FROM "Payment"
        WHERE status = 'PAID'
          AND "createdAt" >= ${mrrPreviousStart}
          AND "createdAt" < ${mrrCurrentEnd}
        GROUP BY to_char("createdAt", 'YYYY-MM')
        ORDER BY month ASC
      `
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
    const map = new Map(rows.map((r) => [r.month, Number(r.total)]))
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

  const mrrHistory = await buildMrrHistory()

  // Build monthly revenue (já vem agregado do raw SQL)
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
  const monthlyMap = new Map(
    monthlyRaw.map((r) => [r.month, { total: Number(r.total), count: Number(r.count) }]),
  )

  // Create full month range for the selected period
  const monthlyRevenue: Array<{
    month: string
    label: string
    total: number
    commission: number
    net: number
    count: number
  }> = []
  if (dateFilter) {
    const start = new Date(dateFilter)
    const end = new Date(now)
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    end.setDate(1)
    end.setHours(0, 0, 0, 0)

    const iter = new Date(start)
    while (iter <= end) {
      const key = `${iter.getFullYear()}-${String(iter.getMonth() + 1).padStart(2, "0")}`
      const data = monthlyMap.get(key) ?? { total: 0, count: 0 }
      const commission = Math.round(data.total * FEE_RATE * 100) / 100
      const net = Math.round((data.total - commission) * 100) / 100
      monthlyRevenue.push({
        month: key,
        label: `${monthNames[iter.getMonth()]!}/${String(iter.getFullYear()).slice(2)}`,
        total: data.total,
        commission,
        net,
        count: data.count,
      })
      iter.setMonth(iter.getMonth() + 1)
    }
  } else {
    for (const [key, data] of monthlyMap) {
      const [, m] = key.split("-")
      const commission = Math.round(data.total * FEE_RATE * 100) / 100
      const net = Math.round((data.total - commission) * 100) / 100
      monthlyRevenue.push({
        month: key,
        label: `${monthNames[parseInt(m!) - 1]!}/${key.slice(2, 4)}`,
        total: data.total,
        commission,
        net,
        count: data.count,
      })
    }
  }

  // Per-provider aggregation (já vem do raw SQL)
  const ROUND2 = (v: number) => Math.round(v * 100) / 100
  const providerStats = providerRaw.map((p) => {
    const total = Number(p.total)
    const fee = Math.round(total * FEE_RATE * 100) / 100
    return {
      id: p.providerId,
      name: p.name,
      email: p.email,
      avatarUrl: p.avatarUrl,
      total: ROUND2(total),
      count: Number(p.count),
      commission: ROUND2(fee),
      net: ROUND2(total - fee),
    }
  })

  // Payment method stats
  const methodStats = methodRaw.map((r) => ({
    method: r.method,
    total: toMoneyNumber(r._sum.amount),
    count: r._count._all,
  }))

  // Executive marketplace SaaS metrics
  const totalAttempts =
    summaryByStatus.PAID.count + summaryByStatus.PENDING.count + summaryByStatus.REFUNDED.count
  const conversionRate =
    totalAttempts > 0 ? Math.round((summaryByStatus.PAID.count / totalAttempts) * 1000) / 10 : 0
  const pixData = methodStats.find((m) => m.method === "PIX") ?? {
    method: "PIX",
    total: 0,
    count: 0,
  }
  const cardData = methodStats.find((m) => m.method === "CARD") ?? {
    method: "CARD",
    total: 0,
    count: 0,
  }
  const heldAmount = toMoneyNumber(escrowHeldStats?._sum?.amount, 0)
  const heldCount = escrowHeldStats?._count?.id ?? 0
  const disputedAmount = (openDisputes || []).reduce(
    (acc, d) => acc + toMoneyNumber(d.booking?.amount, 0),
    0,
  )
  const disputesCount = (openDisputes || []).length

  const executive = {
    gmv: paidTotal,
    platformNetRevenue: Math.round(paidTotal * FEE_RATE * 100) / 100,
    providerNetPayout: Math.round(paidTotal * (1 - FEE_RATE) * 100) / 100,
    takeRatePercent: Math.round(FEE_RATE * 100),
    averageTicket,
    conversionRate,
    annualRunRate: mrrValue * 12,
    escrow: {
      heldAmount,
      heldCount,
      disputedAmount,
      disputesCount,
    },
    gateway: {
      pixVolume: pixData.total,
      pixCount: pixData.count,
      cardVolume: cardData.total,
      cardCount: cardData.count,
      conversionRate,
    },
  }

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
      annualRunRate: mrrValue * 12,
      history: mrrHistory,
    },
    executive,
  })
})
