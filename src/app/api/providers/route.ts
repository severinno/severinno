import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { haversineKm } from "@/lib/geo"
import {
  getCategoryDescendants,
  handleError,
  parsePagination,
} from "@/lib/api-server"

/**
 * Public catalog of verified, active providers.
 * Query params: lat,lng,q,categoryId,radius(km),sort(rating|distance),page,limit
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const lat = searchParams.get("lat")
    const lng = searchParams.get("lng")
    const q = searchParams.get("q")?.trim() || undefined
    const categoryId = searchParams.get("categoryId") || undefined
    const radius = searchParams.get("radius")
    const sort = searchParams.get("sort") || "rating"
    const { page, limit, skip, take } = parsePagination(searchParams)

    const latNum = lat ? Number(lat) : null
    const lngNum = lng ? Number(lng) : null
    const hasGeo =
      latNum !== null &&
      lngNum !== null &&
      Number.isFinite(latNum) &&
      Number.isFinite(lngNum)
    const radiusKm = radius ? Number(radius) : null

    // Resolve category tree once
    let categoryIds: string[] | undefined
    if (categoryId) {
      categoryIds = await getCategoryDescendants(categoryId)
    }

    // Fetch all matching providers (small dataset — compute aggregates in JS)
    const providers = await db.user.findMany({
      where: {
        role: "PROVIDER",
        active: true,
        verified: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q } },
                { bio: { contains: q } },
                { city: { contains: q } },
              ],
            }
          : {}),
        ...(categoryIds
          ? { services: { some: { categoryId: { in: categoryIds } } } }
          : {}),
      },
      include: {
        services: {
          where: { active: true },
          include: { category: true },
        },
        reviewsReceived: { select: { rating: true } },
        bookingsAsProvider: {
          where: { status: "COMPLETED" },
          select: { id: true },
        },
        _count: { select: { favoritedBy: true } },
      },
    })

    // Enrich with computed fields
    let enriched = providers.map((p) => {
      const ratings = p.reviewsReceived.map((r) => r.rating)
      const rating = ratings.length
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : 0
      const reviewCount = ratings.length
      const distanceKm =
        hasGeo && p.lat !== null && p.lng !== null
          ? haversineKm(latNum!, lngNum!, p.lat, p.lng)
          : null
      const completedBookings = p.bookingsAsProvider.length
      const memberSince = p.createdAt
      const { reviewsReceived: _ignored, passwordHash: _ignored2, bookingsAsProvider: _ignored3, _count, ...rest } = p
      return {
        ...rest,
        rating: Math.round(rating * 10) / 10,
        reviewCount,
        completedBookings,
        memberSince,
        favoriteCount: _count.favoritedBy,
        distanceKm: distanceKm !== null
          ? Math.round(distanceKm * 10) / 10
          : null,
      }
    })

    // Radius filter (post-fetch, SQLite has no geo functions).
    // Only applies when the user has supplied lat+lng — otherwise a radius
    // without a center point would exclude every provider.
    // FALLBACK (Nielsen H9 — help users recover): if the radius filter
    // returns 0 results but providers exist, expand to show all providers
    // (sorted by distance) with a `radiusExpanded` flag so the frontend
    // can show a helpful "mostrando os mais próximos" notice.
    let radiusExpanded = false
    if (
      hasGeo &&
      radiusKm !== null &&
      Number.isFinite(radiusKm)
    ) {
      const withinRadius = enriched.filter(
        (p) => p.distanceKm !== null && p.distanceKm <= radiusKm,
      )
      if (withinRadius.length === 0 && enriched.length > 0) {
        // Fallback: no providers within radius, but providers exist — show all
        radiusExpanded = true
      } else {
        enriched = withinRadius
      }
    }

    // Sort
    if (sort === "distance") {
      if (!hasGeo) {
        return NextResponse.json(
          { error: "Ordenação por distância requer lat e lng" },
          { status: 400 },
        )
      }
      enriched.sort(
        (a, b) =>
          (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
          b.rating - a.rating,
      )
    } else {
      // rating (default) — when radius was expanded, prioritize distance
      // so the user sees the closest providers first.
      if (radiusExpanded) {
        enriched.sort(
          (a, b) =>
            (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
            b.rating - a.rating,
        )
      } else {
        enriched.sort(
          (a, b) =>
            b.rating - a.rating || (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
        )
      }
    }

    const total = enriched.length
    const items = enriched.slice(skip, skip + take)

    return NextResponse.json({ items, total, page, limit, radiusExpanded })
  } catch (e) {
    return handleError(e)
  }
}
