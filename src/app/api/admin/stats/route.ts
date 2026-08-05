import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"

// ADMIN: aggregate marketplace stats
export async function GET() {
  try {
    await requireRole("ADMIN")

    const [
      usersByRoleRows,
      providersCount,
      servicesCount,
      bookingsByStatusRows,
      quotesByStatusRows,
      revenueAgg,
      recentBookings,
      topProvidersRows,
    ] = await Promise.all([
      db.user.groupBy({ by: ["role"], _count: { _all: true } }),
      db.user.count({ where: { role: "PROVIDER", verified: true, active: true } }),
      db.service.count({ where: { active: true } }),
      db.booking.groupBy({ by: ["status"], _count: { _all: true } }),
      db.quoteRequest.groupBy({ by: ["status"], _count: { _all: true } }),
      db.payment.aggregate({
        where: { status: "PAID" },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      db.booking.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          service: { select: { id: true, title: true } },
          client: { select: { id: true, name: true, avatarUrl: true } },
          provider: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      // Top providers by avg rating (need raw aggregation in JS)
      db.user.findMany({
        where: { role: "PROVIDER", active: true, verified: true },
        include: { reviewsReceived: { select: { rating: true } } },
      }),
    ])

    const usersByRole: Record<string, number> = {}
    for (const row of usersByRoleRows) {
      usersByRole[row.role] = row._count._all
    }
    const bookingsByStatus: Record<string, number> = {}
    for (const row of bookingsByStatusRows) {
      bookingsByStatus[row.status] = row._count._all
    }
    const quotesByStatus: Record<string, number> = {}
    for (const row of quotesByStatusRows) {
      quotesByStatus[row.status] = row._count._all
    }

    const topProviders = topProvidersRows
      .map((p) => {
        const ratings = p.reviewsReceived.map((r) => r.rating)
        const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0
        const { reviewsReceived: _ignored, ...rest } = p
        return {
          ...rest,
          rating: Math.round(avg * 10) / 10,
          reviewCount: ratings.length,
        }
      })
      .sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount)
      .slice(0, 5)

    return NextResponse.json({
      usersByRole,
      providers: providersCount,
      services: servicesCount,
      bookingsByStatus,
      quotesByStatus,
      revenue: {
        total: revenueAgg._sum.amount ?? 0,
        paymentsPaid: revenueAgg._count,
      },
      recentBookings,
      topProviders,
    })
  } catch (e) {
    return handleError(e)
  }
}
