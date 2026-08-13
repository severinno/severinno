/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import {
  createCachedRadiusCountFn,
  DEFAULT_COUNT_CACHE_TTL,
  findEffectiveRadius,
} from "@/lib/radius-expansion"
import { fetchProvidersData } from "@/lib/fetch-providers-data"
import { fetchUnrestrictedResults } from "@/lib/fetch-unrestricted-results"
import { buildProviderWhereClause } from "@/lib/sql"
import {
  cacheControlPublic,
  getCategoryDescendants,
  handleError,
  parsePagination,
} from "@/lib/api-server"
import { isPostGISAvailable } from "@/lib/postgis"
import { withCache } from "@/lib/redis"
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
 * RADIUS EXPANSION:
 *   When PostGIS is available and the user's radius returns 0 providers,
 *   the search expands progressively: 5km → 10km → 25km → 50km → 100km.
 *   The response includes `expandedRadius` (number | null) indicating
 *   which radius was actually used. null means no expansion needed.
 *   -1 means providers exist but beyond 100km (no radius filter applied).
 *
 * Denormalized avgRating + favoriteCount on User avoid expensive JOINs.
 */

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
      latNum !== null && lngNum !== null && Number.isFinite(latNum) && Number.isFinite(lngNum)
    const radiusKm = radius ? Number(radius) : null

    // Validate sort=distance requires coordinates
    if (sort === "distance" && !hasGeo) {
      return NextResponse.json(
        { error: "Sort por distância requer as coordenadas 'lat' e 'lng'" },
        { status: 400 },
      )
    }

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
    let providerIds: string[] = []
    let total = 0
    let expandedRadius: number | null = null

    if (usePostGisInSql) {
      // ---- Phase 1a: Count with progressive radius expansion -------------
      const countFn = createCachedRadiusCountFn({
        lat: latNum!,
        lng: lngNum!,
        categoryIds,
        q,
        cacheTtl: DEFAULT_COUNT_CACHE_TTL,
        queryRawUnsafe: db.$queryRawUnsafe.bind(db),
        withCache,
        buildWhereClause: buildProviderWhereClause,
      })

      const { effectiveRadius, matchCount } = await findEffectiveRadius(radiusKm!, countFn)

      if (effectiveRadius !== null) {
        // Providers found at the effective radius
        total = matchCount
        if (effectiveRadius !== radiusKm) expandedRadius = effectiveRadius
        centerGeo = { lat: latNum!, lng: lngNum!, radiusKm: effectiveRadius }

        // ---- Phase 1b: Resolve paginated provider IDs --------------------
        const [idWhere, idParams] = buildProviderWhereClause({
          categoryIds,
          q,
          centerGeo,
        })

        const sortByDistance = sort === "distance"

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

        providerIds = idResult.map((r: { id: string }) => r.id)
      } else {
        // No providers found at any expansion step
        // Try without any radius filter (unrestricted)
        const [fbWhere, fbParams] = buildProviderWhereClause({
          categoryIds,
          q,
          centerGeo: null,
        })

        const fbResult = await db.$queryRawUnsafe<Array<{ total: bigint }>>(
          `SELECT COUNT(*)::bigint AS total FROM "User" u WHERE ${fbWhere}`,
          ...fbParams,
        )
        const fbTotal = Number(fbResult[0]?.total ?? 0)

        if (fbTotal > 0) {
          // Providers exist but beyond 100km — return unrestricted with expandedRadius = -1
          const unrestrictedResult = await fetchUnrestrictedResults(
            { fbWhere, fbParams, take, skip, hasGeo, latNum, lngNum },
            {
              serviceFindMany: db.service.findMany.bind(db) as any,
              bookingGroupBy: db.booking.groupBy.bind(db) as any,
              userFindMany: db.user.findMany.bind(db) as any,
              queryRawUnsafe: db.$queryRawUnsafe.bind(db),
            },
          )
          return cacheControlPublic(
            NextResponse.json({
              ...unrestrictedResult,
              page,
              limit,
            }),
            60,
          )
        }

        // No providers at all
        return NextResponse.json({
          items: [],
          total: 0,
          page,
          limit,
          expandedRadius: null,
        })
      }
    } else {
      // ---- Non-PostGIS path: count without spatial filter -----------------
      const [countWhere, countParams] = buildProviderWhereClause({
        categoryIds,
        q,
        centerGeo: null,
      })

      const countResult = await db.$queryRawUnsafe<Array<{ total: bigint }>>(
        `SELECT COUNT(*)::bigint AS total FROM "User" u WHERE ${countWhere}`,
        ...countParams,
      )
      total = Number(countResult[0]?.total ?? 0)

      if (total === 0) {
        return NextResponse.json({
          items: [],
          total: 0,
          page,
          limit,
          expandedRadius: null,
        })
      }

      // ---- Phase 1b: Resolve paginated provider IDs (non-PostGIS) --------
      const [idWhere, idParams] = buildProviderWhereClause({
        categoryIds,
        q,
        centerGeo: null,
      })

      const idResult = await db.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT u.id FROM "User" u WHERE ${idWhere}
         ORDER BY u."avgRating" DESC NULLS LAST, u."favoriteCount" DESC
         LIMIT $${idParams.length + 1} OFFSET $${idParams.length + 2}`,
        ...idParams,
        take,
        skip,
      )

      providerIds = idResult.map((r: { id: string }) => r.id)
    }

    if (providerIds.length === 0) {
      return NextResponse.json({
        items: [],
        total,
        page,
        limit,
        expandedRadius,
      })
    }

    // ------------------------------------------------------------------
    // PHASE 2 — Fetch full data for the current page (parallel queries)
    // ------------------------------------------------------------------
    const items = await fetchProvidersData(
      providerIds,
      { hasGeo, latNum, lngNum, centerGeo },
      {
        serviceFindMany: db.service.findMany.bind(db) as any,
        bookingGroupBy: db.booking.groupBy.bind(db) as any,
        userFindMany: db.user.findMany.bind(db) as any,
        queryRawUnsafe: db.$queryRawUnsafe.bind(db),
      },
    )

    return cacheControlPublic(NextResponse.json({ items, total, page, limit, expandedRadius }), 60)
  } catch (e) {
    return handleError(e)
  }
}
