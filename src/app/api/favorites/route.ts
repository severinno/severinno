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
      take: 100,
      include: {
        provider: {
          include: {
            services: {
              where: { active: true },
              select: { id: true, title: true, basePrice: true },
              take: 3,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    const providers = favorites.map((f) => {
      const rating = f.provider.avgRating ?? 0
      const reviewCount = f.provider.reviewCount ?? 0
      const distanceKm =
        hasGeo && f.provider.lat !== null && f.provider.lng !== null
          ? Math.round(haversineKm(latNum!, lngNum!, f.provider.lat, f.provider.lng) * 10) / 10
          : null
      const { passwordHash: _ignored, ...safeProvider } = f.provider
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
