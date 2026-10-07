export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { findProvidersWithinBounds } from "@/lib/postgis"
import { badRequest } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { toMoneyNumber } from "@/lib/money"

import { withRoute } from "@/lib/api-route"

/**
 * GET /api/search/bbox?minLat=-23.6&minLng=-46.7&maxLat=-23.5&maxLng=-46.6&categoryId=...
 * Search providers within a dynamic map bounding box viewport.
 */
export const GET = withRoute("api.search.bbox.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.providers)
  const { searchParams } = new URL(request.url)

  const minLatStr = searchParams.get("minLat")
  const minLngStr = searchParams.get("minLng")
  const maxLatStr = searchParams.get("maxLat")
  const maxLngStr = searchParams.get("maxLng")
  const categoryId = searchParams.get("categoryId") ?? undefined
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 40)))

  if (!minLatStr || !minLngStr || !maxLatStr || !maxLngStr) {
    throw badRequest("Parâmetros 'minLat', 'minLng', 'maxLat' e 'maxLng' são obrigatórios")
  }

  const minLat = Number(minLatStr)
  const minLng = Number(minLngStr)
  const maxLat = Number(maxLatStr)
  const maxLng = Number(maxLngStr)

  if (isNaN(minLat) || isNaN(minLng) || isNaN(maxLat) || isNaN(maxLng)) {
    throw badRequest("Coordenadas geográficas do bounding box inválidas")
  }

  // 1. Query PostGIS with ST_MakeEnvelope
  const providerIds = await findProvidersWithinBounds(minLat, minLng, maxLat, maxLng, limit)

  if (providerIds.length === 0) {
    return NextResponse.json({ providers: [], total: 0 })
  }

  // 2. Fetch provider cards & services
  const providers = await db.user.findMany({
    where: {
      id: { in: providerIds },
      role: "PROVIDER",
      active: true,
      ...(categoryId
        ? {
            services: {
              some: { categoryId, active: true },
            },
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      verified: true,
      avgRating: true,
      reviewCount: true,
      lat: true,
      lng: true,
      city: true,
      district: true,
      services: {
        where: { active: true, ...(categoryId ? { categoryId } : {}) },
        select: {
          id: true,
          title: true,
          basePrice: true,
          unit: true,
        },
        take: 3,
      },
    },
  })

  // Transform for map pins
  const pins = providers.map((p) => {
    const minPrice =
      p.services.length > 0 ? Math.min(...p.services.map((s) => toMoneyNumber(s.basePrice))) : 0
    return {
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl,
      verified: p.verified,
      avgRating: p.avgRating,
      reviewCount: p.reviewCount,
      lat: p.lat,
      lng: p.lng,
      city: p.city,
      district: p.district,
      minPrice,
      services: p.services,
    }
  })

  return NextResponse.json({
    providers: pins,
    total: pins.length,
    bounds: { minLat, minLng, maxLat, maxLng },
  })
})
