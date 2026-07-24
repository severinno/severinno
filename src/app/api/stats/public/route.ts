import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { cacheControlPublic } from "@/lib/api-server"
import logger from "@/lib/logger"

/**
 * Public platform stats — used by the vitrine hero for social proof.
 * No auth required. Returns aggregate counts.
 */
export async function GET() {
  try {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    const [
      providers,
      services,
      reviews,
      completedBookings,
      totalUsers,
      recentSignups24h,
    ] = await Promise.all([
      db.user.count({ where: { role: "PROVIDER", active: true, verified: true } }),
      db.service.count({ where: { active: true } }),
      db.review.count(),
      db.booking.count({ where: { status: "COMPLETED" } }),
      db.user.count({ where: { active: true } }),
      db.user.count({
        where: {
          active: true,
          createdAt: { gte: yesterday },
        },
      }),
    ])

    // Average rating across all reviews
    const ratingAgg = await db.review.aggregate({ _avg: { rating: true } })
    const avgRating = ratingAgg._avg.rating
      ? Math.round(ratingAgg._avg.rating * 10) / 10
      : 0

    return cacheControlPublic(NextResponse.json({
      providers,
      services,
      reviews,
      completedBookings,
      avgRating,
      totalUsers,
      recentSignups24h,
    }), 30, 120)
  } catch (e) {
    logger.error({ err: e }, "stats/public failed — returning zeros")
    return NextResponse.json(
      {
        providers: 0,
        services: 0,
        reviews: 0,
        completedBookings: 0,
        avgRating: 0,
        totalUsers: 0,
        recentSignups24h: 0,
      },
      { status: 200 },
    )
  }
}
