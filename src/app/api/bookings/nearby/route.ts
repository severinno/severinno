import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import {
  badRequest,
  cacheControlPublic,
  handleError,
} from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import {
  findProvidersWithinRadius,
  isPostGISAvailable,
} from "@/lib/postgis"
import {
  filterProvidersByRadius,
  type NearbyProviderResult,
} from "@/lib/nearby-providers"

/**
 * GET /api/bookings/nearby?lat=..&lng=..&radius=..
 *
 * Authenticated: returns providers near the given coordinates — used by
 * the client to see nearby providers on a map during an active service.
 *
 * Query params:
 *   lat     (required)  — center latitude
 *   lng     (required)  — center longitude
 *   radius  (optional)  — search radius in km (default 10, max 50)
 *
 * Response:
 *   { items: NearbyProviderResult[], total, center, radiusKm }
 *
 * PERFORMANCE: Uses PostGIS ST_DWithin (GiST index `idx_user_location_gist`,
 * Redis-cached in `findProvidersWithinRadius`) when available, otherwise
 * falls back to a pure Haversine JS filter over active providers.
 */
export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.bookings)
    await requireUser()

    const { searchParams } = new URL(request.url)
    const latRaw = searchParams.get("lat")
    const lngRaw = searchParams.get("lng")
    const radiusRaw = Number(searchParams.get("radius") ?? 10)

    const lat = latRaw === null || latRaw.trim() === "" ? NaN : Number(latRaw)
    const lng = lngRaw === null || lngRaw.trim() === "" ? NaN : Number(lngRaw)

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw badRequest("Parâmetros 'lat' e 'lng' são obrigatórios")
    }
    if (!Number.isFinite(radiusRaw) || radiusRaw <= 0) {
      throw badRequest("Parâmetro 'radius' deve ser um número positivo (km)")
    }
    const radiusKm = Math.min(radiusRaw, 50)

    let items: NearbyProviderResult[] = []

    // ---- PostGIS path (index-assisted, Redis-cached) ----------------------
    const pgAvailable = await isPostGISAvailable().catch(() => false)
    if (pgAvailable) {
      const nearby = await findProvidersWithinRadius(lat, lng, radiusKm)
      if (nearby.length > 0) {
        const distanceMap = new Map(nearby.map((n) => [n.id, n.distanceKm]))
        const users = await db.user.findMany({
          where: { id: { in: nearby.map((n) => n.id) } },
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            lat: true,
            lng: true,
            avgRating: true,
          },
        })
        items = users
          .filter((u) => u.lat !== null && u.lng !== null)
          .map((u) => ({
            id: u.id,
            name: u.name,
            avatarUrl: u.avatarUrl,
            lat: u.lat!,
            lng: u.lng!,
            avgRating: u.avgRating,
            distanceKm: distanceMap.get(u.id) ?? 0,
          }))
          .sort((a, b) => a.distanceKm - b.distanceKm)
      }
    }

    // ---- Haversine fallback (no PostGIS) ---------------------------------
    if (items.length === 0) {
      const users = await db.user.findMany({
        where: {
          role: "PROVIDER",
          active: true,
          verified: true,
          deletedAt: null,
          lat: { not: null },
          lng: { not: null },
        },
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          lat: true,
          lng: true,
          avgRating: true,
        },
      })
      items = filterProvidersByRadius(
        users as Array<{
          id: string
          lat: number
          lng: number
          name: string | null
          avatarUrl: string | null
          avgRating: number | null
        }>,
        lat,
        lng,
        radiusKm,
      )
    }

    return cacheControlPublic(
      NextResponse.json({
        items,
        total: items.length,
        center: { lat, lng },
        radiusKm,
      }),
      60,
    )
  } catch (e) {
    return handleError(e)
  }
}
