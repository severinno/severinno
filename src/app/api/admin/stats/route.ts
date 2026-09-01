import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

// ADMIN: aggregate marketplace stats
export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.admin)
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
      // Use denormalized fields (avgRating, reviewCount) instead of loading all reviews
      db.user.findMany({
        where: { role: "PROVIDER", active: true, verified: true },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          avgRating: true,
          reviewCount: true,
        },
        orderBy: { avgRating: "desc" },
        take: 20,
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

    const topProviders = topProvidersRows.slice(0, 5).map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      avatarUrl: p.avatarUrl,
      rating: Math.round((p.avgRating ?? 0) * 10) / 10,
      reviewCount: p.reviewCount ?? 0,
    }))

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
