import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, handleError } from "@/lib/api-server"

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
export async function GET() {
  try {
    const session = await requireUser()
    if (session.role !== "ADMIN") {
      throw forbidden("Acesso restrito a administradores da plataforma")
    }

    // 1. All Bookings summary
    const bookings = await db.booking.findMany({
      where: {
        status: { in: ["COMPLETED", "CONFIRMED", "IN_PROGRESS"] },
      },
      select: {
        id: true,
        amount: true,
        status: true,
        address: true,
        service: { select: { title: true } },
        client: { select: { district: true, city: true } },
      },
    })

    const gmv = bookings.reduce((sum, b) => sum + b.amount, 0)
    const platformRevenue = Math.round(gmv * 0.1 * 100) / 100
    const completedCount = bookings.filter((b) => b.status === "COMPLETED").length
    const avgTicket = bookings.length > 0 ? Math.round((gmv / bookings.length) * 100) / 100 : 0
    const completionRate =
      bookings.length > 0 ? Math.round((completedCount / bookings.length) * 100) : 0

    // 2. User base metrics
    const [clientsCount, providersCount, verifiedCount] = await Promise.all([
      db.user.count({ where: { role: "CLIENT", active: true } }),
      db.user.count({ where: { role: "PROVIDER", active: true } }),
      db.user.count({ where: { role: "PROVIDER", verified: true, active: true } }),
    ])

    // 3. Category breakdown
    const categoryMap = new Map<string, { count: number; totalRevenue: number }>()
    for (const b of bookings) {
      const cat = b.service.title
      const existing = categoryMap.get(cat) || { count: 0, totalRevenue: 0 }
      existing.count++
      existing.totalRevenue += b.amount
      categoryMap.set(cat, existing)
    }

    const topCategories = Array.from(categoryMap.entries())
      .map(([title, data]) => ({
        title,
        count: data.count,
        totalRevenue: Math.round(data.totalRevenue * 100) / 100,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 5)

    // 4. District breakdown
    const districtMap = new Map<string, { count: number; totalGmv: number }>()
    for (const b of bookings) {
      const dist = b.client.district || "Centro / Geral"
      const existing = districtMap.get(dist) || { count: 0, totalGmv: 0 }
      existing.count++
      existing.totalGmv += b.amount
      districtMap.set(dist, existing)
    }

    const topDistricts = Array.from(districtMap.entries())
      .map(([district, data]) => ({
        district,
        count: data.count,
        totalGmv: Math.round(data.totalGmv * 100) / 100,
      }))
      .sort((a, b) => b.totalGmv - a.totalGmv)
      .slice(0, 5)

    const responseData: BusinessMetricsResponse = {
      gmv: Math.round(gmv * 100) / 100,
      platformRevenue,
      takeRatePercent: 10,
      avgTicket,
      totalBookings: bookings.length,
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
  } catch (e) {
    return handleError(e)
  }
}
