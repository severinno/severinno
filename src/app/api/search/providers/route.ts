import { NextResponse } from "next/server"
import { searchProviders, type SearchProviderParams } from "@/lib/search"
import { cacheControlPublic, handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * OpenSearch-powered provider search.
 *
 * Replaces the LIKE-based text filtering in GET /api/providers with
 * proper full-text search using Brazilian Portuguese analyzer + synonyms.
 *
 * Query params:
 *   q          — Full-text query (fuzzy, synonym-aware)
 *   categoryId — Filter by category (matches service categories)
 *   lat, lng   — User location (for geo sorting/radius)
 *   radius     — Radius in km (default: no limit)
 *   sort       — "relevance" (default), "rating", "distance"
 *   page       — Page number (default: 1)
 *   limit      — Results per page (default: 20, max: 50)
 *
 * Usage:
 *   GET /api/search/providers?q=encanador&lat=-23.55&lng=-46.63&sort=rating
 *   GET /api/search/providers?q=pintor&categoryId=cat-123
 *
 * Falls back to empty results if OpenSearch is unavailable.
 */
export async function GET(request: Request) {
  await assertRateLimit(request, RATE_LIMITS.providers)
  try {
    const { searchParams } = new URL(request.url)

    const q = searchParams.get("q")?.trim() || undefined
    const categoryId = searchParams.get("categoryId") || undefined
    const lat = searchParams.get("lat")
    const lng = searchParams.get("lng")
    const radius = searchParams.get("radius")
    const sort = (searchParams.get("sort") || "relevance") as SearchProviderParams["sort"]
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? "20") || 20))

    const latNum = lat ? Number(lat) : undefined
    const lngNum = lng ? Number(lng) : undefined
    const radiusKm = radius ? Number(radius) : undefined

    const hasGeo =
      latNum !== undefined &&
      lngNum !== undefined &&
      Number.isFinite(latNum) &&
      Number.isFinite(lngNum)

    const result = await searchProviders({
      q,
      categoryId,
      lat: hasGeo ? latNum : undefined,
      lng: hasGeo ? lngNum : undefined,
      radiusKm: hasGeo ? radiusKm : undefined,
      sort,
      page,
      limit,
    })

    return cacheControlPublic(
      NextResponse.json({
        items: result.items,
        total: result.total,
        page: result.page,
        limit: result.limit,
        took: result.took,
        engine: "opensearch",
      }),
      30,
    )
  } catch (e) {
    return handleError(e)
  }
}
