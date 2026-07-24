import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { haversineKm } from "@/lib/geo"
import { handleError, notFound } from "@/lib/api-server"
import { getOptionalSession } from "@/lib/auth"

type Params = { params: Promise<{ id: string }> }

/**
 * Public provider detail: profile, services, availability (ordered),
 * recent reviews (with client name/avatar), favoriteCount.
 * If logged-in client, include `favorited` flag.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const lat = searchParams.get("lat")
    const lng = searchParams.get("lng")

    const provider = await db.user.findFirst({
      where: { id, role: "PROVIDER" },
      include: {
        services: {
          where: { active: true },
          include: { category: true },
          orderBy: { createdAt: "desc" },
        },
        availability: {
          where: { active: true },
          orderBy: { dayOfWeek: "asc" },
        },
        reviewsReceived: {
          take: 20,
          orderBy: { createdAt: "desc" },
          include: {
            client: {
              select: { id: true, name: true, avatarUrl: true },
            },
          },
        },
        // Use denormalized counts instead of _count to avoid extra subqueries
      },
    })
    if (!provider) throw notFound("Prestador não encontrado")

    const session = await getOptionalSession()
    let favorited = false
    if (session && session.role === "CLIENT") {
      const fav = await db.favorite.findUnique({
        where: {
          clientId_providerId: { clientId: session.userId, providerId: id },
        },
        select: { id: true },
      })
      favorited = Boolean(fav)
    }

    // Use denormalized avgRating + reviewCount (already computed via trigger)
    const rating = provider.avgRating
    const reviewCount = provider.reviewCount
    const favoriteCount = provider.favoriteCount

    const latNum = lat ? Number(lat) : null
    const lngNum = lng ? Number(lng) : null
    const distanceKm =
      latNum !== null &&
      lngNum !== null &&
      Number.isFinite(latNum) &&
      Number.isFinite(lngNum) &&
      provider.lat !== null &&
      provider.lng !== null
        ? Math.round(haversineKm(latNum, lngNum, provider.lat, provider.lng) * 10) /
          10
        : null

    const { passwordHash: _ignored, avgRating: _r, reviewCount: _rc, favoriteCount: _fc, reviewsReceived, ...safe } =
      provider

    // Map reviews to the UI's `ProviderReview` shape: each review has an
    // `author: { id, name, avatarUrl }` field (alias for `client`).
    const reviews = reviewsReceived.map((r) => {
      const { client, ...rest } = r
      return { ...rest, author: client }
    })

    // Return the provider object directly (the typed fetch wrapper expects
    // a `ProviderDetail`, not `{ provider: ProviderDetail }`).
    return NextResponse.json({
      ...safe,
      services: safe.services,
      availability: safe.availability,
      reviews,
      rating: Math.round(rating * 10) / 10,
      reviewCount,
      favoriteCount,
      distanceKm,
      favorited,
    })
  } catch (e) {
    return handleError(e)
  }
}
