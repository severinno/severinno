export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import {
  createCachedRadiusCountFn,
  createCachedMinDistanceFn,
  DEFAULT_COUNT_CACHE_TTL,
  EMPTY_COUNT_CACHE_TTL,
  findEffectiveRadius,
  findEffectiveRadiusSinglePass,
  MAX_EXPANSION_KM,
  quantizeRadiusUp,
} from "@/lib/radius-expansion"
import { fetchProvidersData, type FetchProvidersDataDeps } from "@/lib/fetch-providers-data"
import { fetchUnrestrictedResults } from "@/lib/fetch-unrestricted-results"
import {
  buildKeysetPredicate,
  decodeProviderCursor,
  encodeProviderCursor,
  KEYSET_ORDER_KEYS_RATING,
  keysetOrderKeysDistance,
  type ProviderCursorAnchor,
  type ProviderSort,
} from "@/lib/keyset"
import { buildProviderWhereClause } from "@/lib/sql"
import {
  cacheControlPublic,
  getCategoryDescendants,
  handleError,
  noStoreJson,
  parsePagination,
} from "@/lib/api-server"
import { isPostGISAvailable } from "@/lib/postgis"
import { withCache } from "@/lib/redis"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * Public catalog of verified, active providers.
 * Query params: lat,lng,q,categoryId,radius(km),sort(rating|distance),page,limit,cursor
 *
 * PERFORMANCE ARCHITECTURE (2-Phase Query):
 *   Phase 1 — Resolve matching provider IDs using indexed raw SQL.
 *             Uses full-text GIN index, PostGIS GiST, composite B-tree.
 *   Phase 2 — Fetch full data for the current page in parallel.
 *
 * RADIUS EXPANSION (single-pass KNN):
 *   When PostGIS is available, the count at the (quantized) user radius is
 *   tried first. On 0, ONE MIN(ST_Distance) query finds the closest eligible
 *   provider and `findEffectiveRadiusSinglePass` derives the effective radius
 *   (5km → 10km → 25km → 50km → 100km steps) — 1 round trip instead of up to
 *   5 sequential COUNTs. The sequential loop remains as a fallback for the
 *   "no located providers" case. The response includes `expandedRadius`
 *   (number | null) indicating which radius was actually used. null means no
 *   expansion needed. -1 means providers exist but beyond 100km (no radius
 *   filter applied).
 *
 * KEYSET PAGINATION (cursor):
 *   `cursor` presente ⇒ seek por predicado de linha (WHERE (k0,k1,k2) > âncora,
 *   chaves normalizadas ASC — ver src/lib/keyset.ts): custo O(log n), sem o
 *   O(offset) de páginas fundas, e determinístico sob empates de rating.
 *   OFFSET (páginas numeradas da vitrine) segue disponível sem cursor.
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
    const sort: ProviderSort = searchParams.get("sort") === "distance" ? "distance" : "rating"
    const { page, limit, skip, take } = parsePagination(searchParams)

    const latNum = lat ? Number(lat) : null
    const lngNum = lng ? Number(lng) : null
    const hasGeo =
      latNum !== null && lngNum !== null && Number.isFinite(latNum) && Number.isFinite(lngNum)
    const radiusKm = radius ? Number(radius) : null

    // Validate radius: negative and non-finite values are rejected, and
    // anything above the largest expansion step is clamped to it (searching
    // "beyond 100km" is what the unrestricted fallback path already does).
    const radiusInvalid = radiusKm !== null && (!Number.isFinite(radiusKm) || radiusKm < 0)
    if (radiusInvalid) {
      return noStoreJson(
        { error: "'radius' deve ser um número de km maior ou igual a 0" },
        { status: 400 },
      )
    }
    const effectiveRequestedRadiusKm =
      radiusKm !== null ? Math.min(radiusKm, MAX_EXPANSION_KM) : null

    // Quantize the user radius UP to the next canonical expansion step so
    // arbitrary values (7km, 13km…) reuse the shared cache levels instead of
    // fragmenting the cache with one-off radii.
    const quantizedRadiusKm =
      effectiveRequestedRadiusKm !== null ? quantizeRadiusUp(effectiveRequestedRadiusKm) : null

    // Validate sort=distance requires coordinates
    if (sort === "distance" && !hasGeo) {
      return noStoreJson(
        { error: "Sort por distância requer as coordenadas 'lat' e 'lng'" },
        { status: 400 },
      )
    }

    // ---- Keyset cursor (paginação determinística O(log n)) ----------------
    // Cursor presente ⇒ seek por predicado de linha (sem OFFSET). Ausente ⇒
    // OFFSET (páginas numeradas da vitrine e saltos arbitrários continuam
    // funcionando). Cursor inválido ou com sort incompatível é 400 EXPLÍCITO —
    // nunca re-paginar do início em silêncio (mascararia duplicatas/omissões).
    const cursorRaw = searchParams.get("cursor")
    let cursorAnchor: ProviderCursorAnchor | null = null
    if (cursorRaw) {
      cursorAnchor = decodeProviderCursor(cursorRaw)
      // O 's' do cursor é a ordenação REAL da sequência: a página 1 pode ter
      // caído no fallback unrestricted (ordenado por rating) mesmo com
      // sort=distance pedido — o cliente só repete a query original. Cursor
      // rating resuma qualquer sort; cursor DISTANCE exige sort=distance + geo.
      if (!cursorAnchor || (cursorAnchor.s === "distance" && sort !== "distance")) {
        return noStoreJson(
          { error: "'cursor' inválido ou incompatível com o 'sort' pedido" },
          { status: 400 },
        )
      }
      if (cursorAnchor.s === "distance" && !hasGeo) {
        return noStoreJson(
          { error: "Cursor de distância requer as coordenadas 'lat' e 'lng'" },
          { status: 400 },
        )
      }
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
    if (pgAvailable && hasGeo && quantizedRadiusKm !== null) {
      centerGeo = { lat: latNum!, lng: lngNum!, radiusKm: quantizedRadiusKm }
      usePostGisInSql = true
    }

    // ------------------------------------------------------------------
    // PHASE 1 — Resolve matching provider IDs
    // ------------------------------------------------------------------
    let providerIds: string[] = []
    let total = 0
    let expandedRadius: number | null = null
    let nextCursor: string | null = null
    let hasMore = false

    if (usePostGisInSql) {
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

      // ---- Phase 1a (fast path): count at the quantized user radius ------
      // 1 cached COUNT resolves the common case (providers within the
      // requested area) with a single round trip — no expansion machinery.
      const initialCount = await countFn(quantizedRadiusKm!)

      let effectiveRadius: number | null = null
      let matchCount = 0

      if (initialCount > 0) {
        effectiveRadius = quantizedRadiusKm!
        matchCount = initialCount
      } else {
        // ---- Phase 1a (single-pass KNN): one MIN-distance query ------------
        // Instead of issuing up to 5 sequential COUNTs (5→10→25→50→100km),
        // ask once for the closest eligible provider and derive the smallest
        // expansion step that encloses that distance.
        const minDistanceFn = createCachedMinDistanceFn({
          lat: latNum!,
          lng: lngNum!,
          categoryIds,
          q,
          queryRawUnsafe: db.$queryRawUnsafe.bind(db),
          withCache,
          buildWhereClause: buildProviderWhereClause,
        })
        const { minDistanceKm, locatedCount } = await minDistanceFn()

        // locatedCount === 0 means providers matching the non-spatial
        // filters either do not exist or have no location — the KNN answer
        // cannot be trusted, so fall through to the legacy loop below.
        if (locatedCount > 0) {
          effectiveRadius = findEffectiveRadiusSinglePass(quantizedRadiusKm!, minDistanceKm)
          if (effectiveRadius !== null) {
            // Count at the derived radius (usually cached alongside the other
            // canonical levels) to report an accurate `total`.
            matchCount = await countFn(effectiveRadius)
          }
          // effectiveRadius === null (closest provider beyond MAX_EXPANSION_KM)
          // → fall through to the unrestricted path below.
        }

        if (effectiveRadius === null) {
          // ---- Legacy loop (fallback): covers the locatedCount === 0 case
          // (no located providers — a provider without a location column is
          // invisible to the KNN query but real for the count) and any cache
          // inconsistency. At most this reproduces the old sequential cost.
          const legacy = await findEffectiveRadius(quantizedRadiusKm!, countFn)
          effectiveRadius = legacy.effectiveRadius
          matchCount = legacy.matchCount
        }
      }

      if (effectiveRadius !== null) {
        // Providers found at the effective radius. `expandedRadius` is honest
        // about what the user asked for: the quantization (0→5, 7→10) and the
        // clamp (>100→100) are normalizations, but when the effective radius
        // is larger than the requested one, the client learns about it.
        total = matchCount
        if (effectiveRadius !== effectiveRequestedRadiusKm) expandedRadius = effectiveRadius
        centerGeo = { lat: latNum!, lng: lngNum!, radiusKm: effectiveRadius }

        // ---- Phase 1b: Resolve paginated provider IDs --------------------
        const [idWhere, idParams] = buildProviderWhereClause({
          categoryIds,
          q,
          centerGeo,
        })

        // O cursor manda na ordenação da página: sequência rating (página 1
        // caiu no unrestricted) continua rating-order mesmo com sort=distance
        // pedido. Sem cursor, o sort da query decide (comportamento OFFSET).
        const pageSort: ProviderSort = cursorAnchor ? cursorAnchor.s : sort
        const sortByDistance = pageSort === "distance"
        const distExpr = `ST_Distance(u.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)`

        let orderClause: string
        if (sortByDistance) {
          orderClause = `${distExpr} ASC, u."avgRating" DESC NULLS LAST, u.id ASC`
        } else {
          orderClause = `u."avgRating" DESC NULLS LAST, u."favoriteCount" DESC, u.id ASC`
        }

        // Âncoras na própria SELECT: o nextCursor vem do ÚLTIMO item da página
        // (distância calculada pelo MESMO PostGIS que ordena — sem drift de
        // float entre DB e aplicação).
        const anchorCols = sortByDistance
          ? `u."avgRating" AS "avgRating", u."favoriteCount" AS "favoriteCount", ${distExpr} AS dist`
          : `u."avgRating" AS "avgRating", u."favoriteCount" AS "favoriteCount"`

        let idSql: string
        let idQueryParams: unknown[]
        if (cursorAnchor) {
          // Keyset: pega take+1 para hasMore EXATO (sem COUNT extra).
          const pred = buildKeysetPredicate({
            sort: cursorAnchor.s,
            anchor: cursorAnchor,
            distExpr: sortByDistance ? distExpr : undefined,
            startParam: idParams.length + 1,
          })
          idSql = `SELECT u.id, ${anchorCols} FROM "User" u WHERE ${idWhere} AND ${pred.sql}
           ORDER BY ${sortByDistance ? keysetOrderKeysDistance(distExpr) : KEYSET_ORDER_KEYS_RATING}
           LIMIT $${idParams.length + pred.params.length + 1}`
          idQueryParams = [...idParams, ...pred.params, take + 1]
        } else {
          idSql = `SELECT u.id, ${anchorCols} FROM "User" u WHERE ${idWhere}
           ORDER BY ${orderClause}
           LIMIT $${idParams.length + 1} OFFSET $${idParams.length + 2}`
          idQueryParams = [...idParams, take + 1, skip]
        }

        const idResult = await db.$queryRawUnsafe<
          Array<{
            id: string
            avgRating: number | null
            favoriteCount: number | null
            dist?: number
          }>
        >(idSql, ...idQueryParams)

        hasMore = idResult.length > take
        const pageRows = hasMore ? idResult.slice(0, take) : idResult
        providerIds = pageRows.map((r) => r.id)
        const lastRow = hasMore ? pageRows[pageRows.length - 1] : null
        if (lastRow) {
          nextCursor = encodeProviderCursor({
            // pageSort, não sort: continuação rating sob sort=distance não pode
            // emitir cursor distance sem d (decode rejeitaria na página seguinte).
            s: pageSort,
            r: lastRow.avgRating ?? null,
            f: lastRow.favoriteCount ?? null,
            d: sortByDistance ? (lastRow.dist ?? null) : undefined,
            id: lastRow.id,
          })
        }
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
            { fbWhere, fbParams, take, skip, hasGeo, latNum, lngNum, cursorAnchor },
            {
              serviceFindMany: db.service.findMany.bind(
                db,
              ) as unknown as FetchProvidersDataDeps["serviceFindMany"],
              bookingGroupBy: db.booking.groupBy.bind(
                db,
              ) as unknown as FetchProvidersDataDeps["bookingGroupBy"],
              userFindMany: db.user.findMany.bind(
                db,
              ) as unknown as FetchProvidersDataDeps["userFindMany"],
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

        // No providers at all — cacheable for a SHORT TTL (same value as the
        // Redis empty-count TTL): absorbs repeated hits on empty regions
        // without pinning "empty" for the full 60s.
        return cacheControlPublic(
          NextResponse.json({
            items: [],
            total: 0,
            page,
            limit,
            expandedRadius: null,
            nextCursor: null,
            hasMore: false,
          }),
          EMPTY_COUNT_CACHE_TTL,
        )
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
        // Short-TTL cache for empty results (see unrestricted-path comment).
        return cacheControlPublic(
          NextResponse.json({
            items: [],
            total: 0,
            page,
            limit,
            expandedRadius: null,
            nextCursor: null,
            hasMore: false,
          }),
          EMPTY_COUNT_CACHE_TTL,
        )
      }

      // ---- Phase 1b: Resolve paginated provider IDs (non-PostGIS) --------
      const [idWhere, idParams] = buildProviderWhereClause({
        categoryIds,
        q,
        centerGeo: null,
      })

      let idSql: string
      let idQueryParams: unknown[]
      if (cursorAnchor) {
        // Keyset rating-only: aqui nunca há distExpr. Um cursor distance só
        // chegaria por replay cross-env — segue pelo seek rating (mesmas chaves
        // r/f/id), sem lançar.
        const pred = buildKeysetPredicate({
          sort: "rating",
          anchor: cursorAnchor,
          startParam: idParams.length + 1,
        })
        idSql = `SELECT u.id, u."avgRating" AS "avgRating", u."favoriteCount" AS "favoriteCount" FROM "User" u WHERE ${idWhere} AND ${pred.sql}
         ORDER BY ${KEYSET_ORDER_KEYS_RATING}
         LIMIT $${idParams.length + pred.params.length + 1}`
        idQueryParams = [...idParams, ...pred.params, take + 1]
      } else {
        idSql = `SELECT u.id, u."avgRating" AS "avgRating", u."favoriteCount" AS "favoriteCount" FROM "User" u WHERE ${idWhere}
         ORDER BY u."avgRating" DESC NULLS LAST, u."favoriteCount" DESC, u.id ASC
         LIMIT $${idParams.length + 1} OFFSET $${idParams.length + 2}`
        idQueryParams = [...idParams, take + 1, skip]
      }

      const idResult = await db.$queryRawUnsafe<
        Array<{ id: string; avgRating: number | null; favoriteCount: number | null }>
      >(idSql, ...idQueryParams)

      hasMore = idResult.length > take
      const pageRows = hasMore ? idResult.slice(0, take) : idResult
      providerIds = pageRows.map((r) => r.id)
      const lastRow = hasMore ? pageRows[pageRows.length - 1] : null
      if (lastRow) {
        nextCursor = encodeProviderCursor({
          s: "rating",
          r: lastRow.avgRating ?? null,
          f: lastRow.favoriteCount ?? null,
          id: lastRow.id,
        })
      }
    }

    if (providerIds.length === 0) {
      return NextResponse.json({
        items: [],
        total,
        page,
        limit,
        expandedRadius,
        nextCursor: null,
        hasMore: false,
      })
    }

    // ------------------------------------------------------------------
    // PHASE 2 — Fetch full data for the current page (parallel queries)
    // ------------------------------------------------------------------
    const items = await fetchProvidersData(
      providerIds,
      { hasGeo, latNum, lngNum, centerGeo },
      {
        serviceFindMany: db.service.findMany.bind(
          db,
        ) as unknown as FetchProvidersDataDeps["serviceFindMany"],
        bookingGroupBy: db.booking.groupBy.bind(
          db,
        ) as unknown as FetchProvidersDataDeps["bookingGroupBy"],
        userFindMany: db.user.findMany.bind(
          db,
        ) as unknown as FetchProvidersDataDeps["userFindMany"],
        queryRawUnsafe: db.$queryRawUnsafe.bind(db),
      },
    )

    return cacheControlPublic(
      NextResponse.json({ items, total, page, limit, expandedRadius, nextCursor, hasMore }),
      60,
    )
  } catch (e) {
    return handleError(e)
  }
}
