export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { handleError, cacheControlPublic } from "@/lib/api-server"
import { withCache } from "@/lib/redis"

/**
 * GET /api/reviews/recent — public endpoint for the vitrine testimonials section.
 *
 * Query params:
 *   - limit: number of reviews (default 6, max 12)
 *
 * Returns: { items: ReviewItem[], total: number, avgRating: number }
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get("limit") || "6", 10), 12)

    const result = await withCache(
      `reviews:recent:${limit}`,
      async () => {
        const [reviews, agg] = await Promise.all([
          db.review.findMany({
            where: { comment: { not: null } },
            take: limit,
            orderBy: { createdAt: "desc" },
            include: {
              client: {
                select: { name: true, avatarUrl: true },
              },
              provider: {
                select: { name: true, avatarUrl: true },
              },
              service: {
                select: { title: true },
              },
            },
          }),
          db.review.aggregate({
            _avg: { rating: true },
            _count: { id: true },
          }),
        ])

        const items = reviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt.toISOString(),
          clientName: r.client.name,
          clientAvatar: r.client.avatarUrl,
          providerName: r.provider.name,
          providerAvatar: r.provider.avatarUrl,
          serviceTitle: r.service?.title ?? "Serviço",
        }))

        return {
          items,
          total: agg._count.id,
          avgRating: agg._avg.rating ? Number(agg._avg.rating.toFixed(1)) : 0,
        }
      },
      60,
    )

    return cacheControlPublic(NextResponse.json(result), 60, 300)
  } catch (e) {
    return handleError(e)
  }
}
