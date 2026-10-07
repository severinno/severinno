export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { type BookingStatus } from "@prisma/client"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { toMoneyNumber } from "@/lib/money"
import { FEE_RATE } from "@/lib/constants"

import { withRoute } from "@/lib/api-route"

export type BusinessMetricsResponse = {
  gmv: number // Gross Merchandise Volume
  platformRevenue: number // Take Rate earnings
  takeRatePercent: number
  avgTicket: number
  totalBookings: number
  completedBookings: number
  completionRatePercent: number
  activeUsers: {
    clients: number
    providers: number
    verifiedProviders: number
  }
  topCategories: Array<{ title: string; count: number; totalRevenue: number }>
  topDistricts: Array<{ district: string; count: number; totalGmv: number }>
}

/**
 * GET /api/admin/business-metrics
 * Returns executive marketplace SaaS KPIs (GMV, Platform Net Revenue, Take Rate, Top Districts).
 */
export const GET = withRoute("api.admin.business-metrics.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.admin)
  await requireRole("ADMIN")

  const activeStatuses: BookingStatus[] = ["COMPLETED", "CONFIRMED", "IN_PROGRESS"]

  // 1. Aggregate bookings summary via SQL
  const [bookingStats, completedCount] = await Promise.all([
    db.booking.aggregate({
      where: { status: { in: activeStatuses } },
      _sum: { amount: true },
      _count: true,
    }),
    db.booking.count({
      where: { status: "COMPLETED" as BookingStatus },
    }),
  ])

  const gmv = toMoneyNumber(bookingStats._sum?.amount)
  const totalBookings = bookingStats._count
  const platformRevenue = Math.round(gmv * FEE_RATE * 100) / 100
  const avgTicket = totalBookings > 0 ? Math.round((gmv / totalBookings) * 100) / 100 : 0
  const completionRate = totalBookings > 0 ? Math.round((completedCount / totalBookings) * 100) : 0

  // 2. User base metrics
  const [clientsCount, providersCount, verifiedCount] = await Promise.all([
    db.user.count({ where: { role: "CLIENT", active: true } }),
    db.user.count({ where: { role: "PROVIDER", active: true } }),
    db.user.count({ where: { role: "PROVIDER", verified: true, active: true } }),
  ])

  // 3. Category breakdown via SQL groupBy
  const categoryStats = await db.booking.groupBy({
    by: ["serviceId"],
    where: { status: { in: activeStatuses } },
    _count: true,
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
    take: 5,
  })

  const serviceIds = categoryStats.map((c) => c.serviceId)
  const services = await db.service.findMany({
    where: { id: { in: serviceIds } },
    select: { id: true, title: true },
  })
  const serviceTitleMap = new Map(services.map((s) => [s.id, s.title]))

  const topCategories = categoryStats.map((c) => ({
    title: serviceTitleMap.get(c.serviceId) ?? "Desconhecido",
    count: c._count,
    totalRevenue: toMoneyNumber(c._sum?.amount),
  }))

  // 4. District breakdown via raw SQL aggregation
  const districtStats = await db.$queryRaw<
    Array<{ district: string; count: bigint; total_gmv: number }>
  >`
      SELECT
        COALESCE(u.district, 'Centro / Geral') AS district,
        COUNT(b.id)::bigint AS count,
        ROUND(SUM(b.amount)::numeric, 2) AS total_gmv
      FROM "Booking" b
      JOIN "User" u ON u.id = b."clientId"
      WHERE b.status IN ('COMPLETED', 'CONFIRMED', 'IN_PROGRESS')
      GROUP BY COALESCE(u.district, 'Centro / Geral')
      ORDER BY total_gmv DESC
      LIMIT 5
    `

  const topDistricts = districtStats.map((d) => ({
    district: d.district,
    count: Number(d.count),
    totalGmv: Number(d.total_gmv),
  }))

  const responseData: BusinessMetricsResponse = {
    gmv: Math.round(gmv * 100) / 100,
    platformRevenue,
    takeRatePercent: Math.round(FEE_RATE * 100),
    avgTicket,
    totalBookings,
    completedBookings: completedCount,
    completionRatePercent: completionRate,
    activeUsers: {
      clients: clientsCount,
      providers: providersCount,
      verifiedProviders: verifiedCount,
    },
    topCategories,
    topDistricts,
  }

  return NextResponse.json({
    ok: true,
    metrics: responseData,
  })
})
