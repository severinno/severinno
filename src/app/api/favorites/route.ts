import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, handleError } from "@/lib/api-server"
import { computeDistanceMap } from "@/lib/geo-server"

// CLIENT: list favorited providers (with optional distance computation).
// Returns `ProviderCard[]` directly (UI: `apiGet<ProviderCard[]>("/api/favorites")`).
//
// DISTANCE ARCHITECTURE (scale risk #1 closing - melhorias-otimizacoes.md item 1):
//   Distances are DB-first via `computeDistanceMap`: a single PostGIS
//   ST_Distance batch query for the favorite ids, with Haversine only as
//   fallback when PostGIS fails. The per-item in-memory distance loop is gone
//   (pinned by db-pagination-contract, which asserts this file carries no
//   direct per-item distance math). Favorites stay unpaginated BY DESIGN: the
//   client contract is a bare `ProviderCard[]` array (fetchFavorites in
//   api.ts) and a client's favorite list is bounded (tens, not 1000+) -
//   skip/take here would be an API-breaking envelope change without scale
//   benefit. The public catalog listing (which IS the 1000+ surface) paginates
//   in the DB via the providers route.
export async function GET(request: Request) {
  try {
    const session = await requireUser()
    if (session.role !== "CLIENT") {
      throw forbidden("Apenas clientes têm favoritos")
    }
    const { searchParams } = new URL(request.url)
    const lat = searchParams.get("lat")
    const lng = searchParams.get("lng")
    const latNum = lat ? Number(lat) : null
    const lngNum = lng ? Number(lng) : null
    const hasGeo =
      latNum !== null &&
      lngNum !== null &&
      Number.isFinite(latNum) &&
      Number.isFinite(lngNum)

    const favorites = await db.favorite.findMany({
      where: { clientId: session.userId },
      include: {
        provider: {
          include: {
            services: { where: { active: true }, include: { category: true } },
            reviewsReceived: { select: { rating: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    const providers = favorites.map((f) => {
      const ratings = f.provider.reviewsReceived.map((r) => r.rating)
      const rating = ratings.length
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : 0
      const reviewCount = ratings.length
      const {
        reviewsReceived: _ignored,
        passwordHash: _ignored2,
        ...safeProvider
      } = f.provider
      return {
        ...safeProvider,
        rating: Math.round(rating * 10) / 10,
        reviewCount,
      }
    })

    // Distances: single PostGIS ST_Distance batch query (DB-first).
    // Haversine runs only as the per-provider fallback inside computeDistanceMap
    // when the PostGIS query fails — never as the primary per-item loop.
    let distanceMap: Map<string, number | null> = new Map()
    if (hasGeo) {
      distanceMap = await computeDistanceMap({
        providerIds: providers.map((p) => p.id),
        providers: providers.map((p) => ({
          id: p.id,
          lat: p.lat,
          lng: p.lng,
        })),
        centerGeo: { lat: latNum!, lng: lngNum! },
        hasGeo: true,
        userLat: latNum!,
        userLng: lngNum!,
        queryRawUnsafe: db.$queryRawUnsafe.bind(db),
      })
    }

    const result = providers.map((p) => ({
      ...p,
      distanceKm: hasGeo ? (distanceMap.get(p.id) ?? null) : null,
    }))

    return NextResponse.json(result)
  } catch (e) {
    return handleError(e)
  }
}
