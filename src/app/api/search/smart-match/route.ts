export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { findBestProviders } from "@/lib/smart-match"
import { badRequest } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withRoute } from "@/lib/api-route"

/**
 * GET /api/search/smart-match?lat=-23.55&lng=-46.63&categoryId=cat123&scheduledAt=2026-08-20T10:00:00Z&limit=5
 * Returns smart-matched providers ranked by distance, rating, and availability.
 */
export const GET = withRoute("api.search.smart-match.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.providers)
  const { searchParams } = new URL(request.url)

  const latStr = searchParams.get("lat")
  const lngStr = searchParams.get("lng")
  const categoryId = searchParams.get("categoryId") ?? undefined
  const scheduledAtStr = searchParams.get("scheduledAt")
  const limit = Math.min(10, Math.max(1, Number(searchParams.get("limit") || 5)))

  if (!latStr || !lngStr) {
    throw badRequest("Parâmetros 'lat' e 'lng' são obrigatórios")
  }

  const lat = Number(latStr)
  const lng = Number(lngStr)

  if (isNaN(lat) || isNaN(lng)) {
    throw badRequest("Coordenadas geográficas inválidas")
  }

  const scheduledAt = scheduledAtStr ? new Date(scheduledAtStr) : undefined

  const providers = await findBestProviders({
    categoryId,
    lat,
    lng,
    scheduledAt,
    limit,
  })

  return NextResponse.json({
    providers,
    total: providers.length,
    searchedAt: new Date().toISOString(),
  })
})
