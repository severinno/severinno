import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, handleError } from "@/lib/api-server"
import { haversineKm } from "@/lib/geo-server"

// CLIENT: list favorited providers (with optional distance computation).
// Returns `ProviderCard[]` directly (UI: `apiGet<ProviderCard[]>("/api/favorites")`).
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
      latNum !== null && lngNum !== null && Number.isFinite(latNum) && Number.isFinite(lngNum)

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
      const rating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0
      const reviewCount = ratings.length
      const distanceKm =
        hasGeo && f.provider.lat !== null && f.provider.lng !== null
          ? Math.round(haversineKm(latNum!, lngNum!, f.provider.lat, f.provider.lng) * 10) / 10
          : null
      const { reviewsReceived: _ignored, passwordHash: _ignored2, ...safeProvider } = f.provider
      return {
        ...safeProvider,
        rating: Math.round(rating * 10) / 10,
        reviewCount,
        distanceKm,
      }
    })

    return NextResponse.json(providers)
  } catch (e) {
    return handleError(e)
  }
}
