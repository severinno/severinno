import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError, parsePagination, USER_PUBLIC_SELECT } from "@/lib/api-server"
import { haversineKm } from "@/lib/geo-server"

/**
 * ADMIN: paginated user list with optional role / q / geo filters.
 *
 * Supports:
 *   role, q, city, state, page, limit — standard filters
 *   lat, lng, radius — geo distance filter
 *
 * ⚠️ Known limitation: radius filtering is applied AFTER skip/take
 * (pagination). This means when radius is active, the `total` count
 * reflects the unfiltered set and pagination may skip items that
 * should appear on earlier pages. This is acceptable for admin
 * workflows where the radius is used as a quick visual filter.
 * For precise pagination with geo filters, use the providers API
 * (src/app/api/providers/route.ts) which handles PostGIS.
 */
export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")
    const { searchParams } = new URL(request.url)
    const role = searchParams.get("role") || undefined
    const q = searchParams.get("q")?.trim() || undefined
    const city = searchParams.get("city")?.trim() || undefined
    const state = searchParams.get("state")?.trim() || undefined
    const latParam = searchParams.get("lat")
    const lngParam = searchParams.get("lng")
    const radiusParam = searchParams.get("radius")
    const { page, limit, skip, take } = parsePagination(searchParams)

    const lat = latParam ? Number(latParam) : null
    const lng = lngParam ? Number(lngParam) : null
    const radiusKm = radiusParam ? Number(radiusParam) : null

    const where = {
      ...(role ? { role } : {}),
      ...(city ? { city: { contains: city } } : {}),
      ...(state ? { state } : {}),
      ...(q
        ? {
            OR: [{ name: { contains: q } }, { email: { contains: q } }, { city: { contains: q } }],
          }
        : {}),
    }

    const [items, total] = await Promise.all([
      db.user.findMany({
        where,
        select: {
          ...USER_PUBLIC_SELECT,
          lat: true,
          lng: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      db.user.count({ where }),
    ])

    // Compute distance for each item when user coordinates are available
    let itemsWithDistance: Array<Record<string, unknown> & { distanceKm?: number | null }> = items
    if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
      itemsWithDistance = items.map((item) => ({
        ...item,
        distanceKm:
          item.lat != null && item.lng != null
            ? Math.round(haversineKm(lat, lng, item.lat, item.lng) * 10) / 10
            : null,
      }))
    }

    // Filter by radius when requested
    let filtered = itemsWithDistance
    if (radiusKm != null && radiusKm > 0 && lat != null && lng != null) {
      filtered = itemsWithDistance.filter(
        (item) => item.distanceKm == null || item.distanceKm <= radiusKm,
      )
    }

    return NextResponse.json({ items: filtered, total, page, limit })
  } catch (e) {
    return handleError(e)
  }
}
