import { NextResponse } from "next/server"
import { db } from "@/lib/db"

/**
 * Public platform stats — used by the vitrine hero for social proof.
 * No auth required. Returns aggregate counts.
 */
export async function GET() {
  try {
    const [providers, services, reviews, completedBookings] = await Promise.all([
      db.user.count({ where: { role: "PROVIDER", active: true, verified: true } }),
      db.service.count({ where: { active: true } }),
      db.review.count(),
      db.booking.count({ where: { status: "COMPLETED" } }),
    ])

    // Average rating across all reviews
    const ratingAgg = await db.review.aggregate({ _avg: { rating: true } })
    const avgRating = ratingAgg._avg.rating
      ? Math.round(ratingAgg._avg.rating * 10) / 10
      : 0

    return NextResponse.json({
      providers,
      services,
      reviews,
      completedBookings,
      avgRating,
    })
  } catch {
    return NextResponse.json(
      { providers: 0, services: 0, reviews: 0, completedBookings: 0, avgRating: 0 },
      { status: 200 },
    )
  }
}
