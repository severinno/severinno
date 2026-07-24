import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { haversineKm } from "@/lib/geo"
import {
  getCategoryDescendants,
  handleError,
  parsePagination,
} from "@/lib/api-server"
import { isPostGISAvailable } from "@/lib/postgis"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * Public catalog of verified, active providers.
 * Query params: lat,lng,q,categoryId,radius(km),sort(rating|distance),page,limit
 *
 * PERFORMANCE ARCHITECTURE (2-Phase Query):
 *   Phase 1 — Resolve matching provider IDs using indexed raw SQL.
 *             Uses full-text GIN index, PostGIS GiST, composite B-tree.
 *   Phase 2 — Fetch full data for the current page in parallel.
 *
 * Denormalized avgRating + favoriteCount on User avoid expensive JOINs.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the base WHERE clause and params for the providers search.
 * Returns [sqlString, paramsArray].
 */
function buildProviderWhereClause(opts: {
  categoryIds?: string[]
  q?: string
  centerGeo?: { lat: number; lng: number; radiusKm: number } | null
}): [string, unknown[]] {
  const conditions: string[] = [
    `u.role = 'PROVIDER'`,
    `u.active = true`,
    `u.verified = true`,
    `u."deletedAt" IS NULL`,
  ]
  const params: unknown[] = []
  let idx = 0

  // PostGIS radius filter
  if (opts.centerGeo) {
    conditions.push(
      `u.location IS NOT NULL`,
      `ST_DWithin(u.location, ST_SetSRID(ST_MakePoint($${++idx}, $${++idx}), 4326)::geography, ${opts.centerGeo.radiusKm * 1000})`,
    )
    params.push(opts.centerGeo.lng, opts.centerGeo.lat)
  }

  // Full-text search (sanitized)
  if (opts.q) {
    const sanitized = opts.q
      .replace(/[^\w\sÀ-ÿ]/g, " ")  // remove non-alphanumeric (incl. acentos)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `${w}:*`)
      .join(" & ")

    if (sanitized) {
      conditions.push(`u.search_vector @@ to_tsquery('portuguese', $${++idx})`)
      params.push(sanitized)
    }
  }

  // Category filter via EXISTS subquery
  if (opts.categoryIds && opts.categoryIds.length > 0) {
    const placeholders = opts.categoryIds.map(() => `$${++idx}`).join(",")
    conditions.push(
      `EXISTS (
        SELECT 1 FROM "Service" s
        WHERE s."providerId" = u.id AND s.active = true
        AND s."categoryId" IN (${placeholders})
      )`,
    )
    params.push(...opts.categoryIds)
  }

  return [conditions.join(" AND "), params]
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.providers)
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

    // Resolve category tree once (Redis-cached, 10min TTL)
    let categoryIds: string[] | undefined
    if (categoryId) {
      categoryIds = await getCategoryDescendants(categoryId)
    }

    // ---- Check PostGIS availability ---------------------------------------
    let pgAvailable = false
    let centerGeo: { lat: number; lng: number; radiusKm: number } | null = null

    if (hasGeo && radiusKm !== null && Number.isFinite(radiusKm)) {
      try {
        pgAvailable = await isPostGISAvailable()
      } catch {
        pgAvailable = false
      }
    }

    // When PostGIS is available AND user has geo, build PostGIS-filtered SQL
    let usePostGisInSql = false
    if (pgAvailable && hasGeo && radiusKm !== null) {
      centerGeo = { lat: latNum!, lng: lngNum!, radiusKm }
      usePostGisInSql = true
    }

    // ------------------------------------------------------------------
    // PHASE 1 — Resolve matching provider IDs
    // ------------------------------------------------------------------
    // Build separate WHERE clause + params for each query to avoid
    // paramIndex conflicts across independent $queryRawUnsafe calls.
    //
    // NOTE: q is passed RAW to buildProviderWhereClause which sanitizes
    // it internally via sanitizeTsquery before building the SQL.
    // ------------------------------------------------------------------

    // ---- Phase 1a: Count total matching providers -------------------------
    const [countWhere, countParams] = buildProviderWhereClause({
      categoryIds,
      q,
      centerGeo,
    })

    const countResult = await db.$queryRawUnsafe<Array<{ total: bigint }>>(
      `SELECT COUNT(*)::bigint AS total FROM "User" u WHERE ${countWhere}`,
      ...countParams,
    )
    const total = Number(countResult[0]?.total ?? 0)

    if (total === 0) {
      // If PostGIS filtered out all providers but there could be providers
      // outside the radius, try without radius filter to show expanded results
      if (usePostGisInSql) {
        // Build fallback WHERE without PostGIS radius — params are included
        const [fbWhere, fbParams] = buildProviderWhereClause({
          categoryIds,
          q,
          centerGeo: null, // remove radius filter
        })

        // Spread ...fbParams even when empty (no-op) — avoids duplicate branches
        const fallbackResult = await db.$queryRawUnsafe<Array<{ total: bigint }>>(
          `SELECT COUNT(*)::bigint AS total FROM "User" u WHERE ${fbWhere}`,
          ...fbParams,
        )
        const fallbackTotal = Number(fallbackResult[0]?.total ?? 0)
        if (fallbackTotal > 0) {
          return await fetchExpandedResults({
            fbWhere, fbParams, take, skip, page, limit,
            hasGeo, latNum, lngNum,
          })
        }
      }
      return NextResponse.json({ items: [], total: 0, page, limit, radiusExpanded: false })
    }

    // ---- Phase 1b: Resolve paginated provider IDs -------------------------
    const [idWhere, idParams] = buildProviderWhereClause({
      categoryIds,
      q,
      centerGeo,
    })

    const sortByDistance = sort === "distance" && centerGeo !== null

    let orderClause: string
    if (sortByDistance) {
      orderClause = `ST_Distance(u.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) ASC, u."avgRating" DESC NULLS LAST`
    } else {
      orderClause = `u."avgRating" DESC NULLS LAST, u."favoriteCount" DESC`
    }

    const idResult = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT u.id FROM "User" u WHERE ${idWhere}
       ORDER BY ${orderClause}
       LIMIT $${idParams.length + 1} OFFSET $${idParams.length + 2}`,
      ...idParams,
      take,
      skip,
    )

    const providerIds = idResult.map((r) => r.id)

    if (providerIds.length === 0) {
      return NextResponse.json({ items: [], total, page, limit, radiusExpanded: false })
    }

    // ------------------------------------------------------------------
    // PHASE 2 — Fetch full data for the current page (parallel queries)
    // ------------------------------------------------------------------
    const items = await fetchProvidersData(providerIds, {
      hasGeo,
      latNum,
      lngNum,
      centerGeo,
    })

    // Radius expansion flag (only relevant for Haversine path)
    const radiusExpanded = !usePostGisInSql && hasGeo && radiusKm !== null && items.length === 0 && total > 0

    return NextResponse.json({ items, total, page, limit, radiusExpanded })
  } catch (e) {
    return handleError(e)
  }
}

// ---------------------------------------------------------------------------
// Fallback helper — fetch expanded results when radius filter returns nothing
// ---------------------------------------------------------------------------

async function fetchExpandedResults(opts: {
  fbWhere: string
  fbParams: unknown[]
  take: number
  skip: number
  page: number
  limit: number
  hasGeo: boolean
  latNum: number | null
  lngNum: number | null
}) {
  const { fbWhere, fbParams, take, skip, page, limit, hasGeo, latNum, lngNum } = opts

  const fallbackIds = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT u.id FROM "User" u WHERE ${fbWhere}
     ORDER BY u."avgRating" DESC NULLS LAST, u."favoriteCount" DESC
     LIMIT $${fbParams.length + 1} OFFSET $${fbParams.length + 2}`,
    ...fbParams,
    take,
    skip,
  )

  // Count total matching
  const countResult = await db.$queryRawUnsafe<Array<{ total: bigint }>>(
    `SELECT COUNT(*)::bigint AS total FROM "User" u WHERE ${fbWhere}`,
    ...fbParams,
  )
  const fallbackTotal = Number(countResult[0]?.total ?? 0)

  if (fallbackIds.length === 0) {
    return NextResponse.json({
      items: [], total: fallbackTotal, page, limit, radiusExpanded: true,
    })
  }

  const items = await fetchProvidersData(
    fallbackIds.map((r) => r.id),
    { hasGeo, latNum, lngNum },
  )

  return NextResponse.json({
    items, total: fallbackTotal, page, limit, radiusExpanded: true,
  })
}

// ---------------------------------------------------------------------------
// Phase 2 helper — fetch full provider data for a set of IDs
// ---------------------------------------------------------------------------

async function fetchProvidersData(
  providerIds: string[],
  geo: {
    hasGeo: boolean
    latNum: number | null
    lngNum: number | null
    centerGeo?: { lat: number; lng: number; radiusKm: number } | null
  },
) {
  const { hasGeo, latNum, lngNum, centerGeo } = geo

  const [services, completedBookingsData] = await Promise.all([
    // Services for these providers (flat, no cartesian join)
    db.service.findMany({
      where: { providerId: { in: providerIds }, active: true },
      include: { category: { select: { id: true, name: true } } },
      orderBy: { basePrice: "asc" },
    }),
    // Completed bookings count per provider
    db.booking.groupBy({
      by: ["providerId"],
      where: { providerId: { in: providerIds }, status: "COMPLETED" },
      _count: { id: true },
    }),
  ])

  // Group services by providerId
  const servicesByProvider = new Map<string, typeof services>()
  for (const svc of services) {
    const arr = servicesByProvider.get(svc.providerId) ?? []
    arr.push(svc)
    servicesByProvider.set(svc.providerId, arr)
  }

  // Map completed bookings count
  const completedMap = new Map<string, number>()
  for (const row of completedBookingsData) {
    completedMap.set(row.providerId, row._count.id)
  }

  // Compute distance via PostGIS (if available) or Haversine fallback
  // For PostGIS: fetch distances for all provider IDs in one query
  let distanceMap = new Map<string, number | null>()
  if (centerGeo) {
    try {
      const distRows = await db.$queryRawUnsafe<
        Array<{ id: string; distance_km: number }>
      >(
        `SELECT id,
                ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000 AS distance_km
         FROM "User"
         WHERE id = ANY($3::text[])`,
        centerGeo.lng,
        centerGeo.lat,
        providerIds,
      )
      for (const row of distRows) {
        distanceMap.set(row.id, Math.round(row.distance_km * 10) / 10)
      }
    } catch {
      // Fallback to Haversine
    }
  }

  // Fetch provider records (lightweight select)
  const providers = await db.user.findMany({
    where: { id: { in: providerIds } },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      coverUrl: true,
      bio: true,
      lat: true,
      lng: true,
      city: true,
      state: true,
      verified: true,
      avgRating: true,
      reviewCount: true,
      favoriteCount: true,
      createdAt: true,
      radiusKm: true,
      slug: true,
    },
  })

  // Sort providers to match the original ID order
  const idOrder = new Map(providerIds.map((id, idx) => [id, idx]))
  providers.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0))

  return providers.map((p) => {
    // Distance: try PostGIS result first, fallback to Haversine
    let distanceKm: number | null = distanceMap.get(p.id) ?? null
    if (distanceKm === null && hasGeo && p.lat !== null && p.lng !== null) {
      distanceKm = Math.round(haversineKm(latNum!, lngNum!, p.lat, p.lng) * 10) / 10
    }

    return {
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl,
      coverUrl: p.coverUrl,
      bio: p.bio,
      lat: p.lat,
      lng: p.lng,
      city: p.city,
      state: p.state,
      verified: p.verified,
      rating: p.avgRating,
      reviewCount: p.reviewCount,
      favoriteCount: p.favoriteCount,
      completedBookings: completedMap.get(p.id) ?? 0,
      memberSince: p.createdAt.toISOString(),
      distanceKm,
      services: (servicesByProvider.get(p.id) ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        basePrice: s.basePrice,
        unit: s.unit,
        photos: s.photos as string[],
        category: s.category,
      })),
    }
  })
}
