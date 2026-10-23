/**
 * fetch-unrestricted-results.ts
 *
 * Encapsulates the "unrestricted fallback" path of the providers route:
 * when progressive radius expansion finds no providers (even at 100 km),
 * this module queries without any geographic filter and returns results
 * with `expandedRadius: -1`.
 *
 * Dependency injection pattern (same as fetch-providers-data.ts and
 * distance-fallback.ts): Prisma methods are injected for testability.
 */

import {
  fetchProvidersData,
  type FetchProvidersDataDeps,
  type ProviderDataItem,
} from "./fetch-providers-data"
import {
  buildKeysetPredicate,
  encodeProviderCursor,
  KEYSET_ORDER_KEYS_RATING,
  type ProviderCursorAnchor,
} from "./keyset"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the unrestricted fallback query. */
export interface UnrestrictedOpts {
  /** WHERE clause body (without the `WHERE` keyword). */
  fbWhere: string
  /** Parameter values for the WHERE clause. */
  fbParams: unknown[]
  /** Number of rows to fetch (LIMIT). */
  take: number
  /** Number of rows to skip (OFFSET). */
  skip: number
  /** Whether the user has valid geolocation coordinates. */
  hasGeo: boolean
  /** User's latitude (may be null if !hasGeo). */
  latNum: number | null
  /** User's longitude (may be null if !hasGeo). */
  lngNum: number | null
  /**
   * Âncora keyset já validada pela rota (rating-only neste caminho).
   * Presente ⇒ seek por predicado de linha, sem OFFSET.
   */
  cursorAnchor?: ProviderCursorAnchor | null
}

/** Result of the unrestricted fallback query. */
export interface UnrestrictedResult {
  items: ProviderDataItem[]
  total: number
  /** Always -1, meaning "beyond max expansion (100 km)". */
  expandedRadius: -1
  /** Âncora do último item da página (null quando não há mais). */
  nextCursor: string | null
  /** Exato: SELECT traz take+1 rows; sobrou ⇒ há próxima página. */
  hasMore: boolean
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Fetch providers without any geographic radius filter.
 *
 * Queries paginated provider IDs using only category/search filters, then
 * fetches full provider data.  Returns an empty items array when no
 * providers match, but always sets `expandedRadius: -1` to signal that
 * the search was unbounded by distance.
 *
 * @param opts - Query options (WHERE clause, pagination, geo context).
 * @param deps - Injected Prisma methods (same shape as FetchProvidersDataDeps).
 */
export async function fetchUnrestrictedResults(
  opts: UnrestrictedOpts,
  deps: FetchProvidersDataDeps,
): Promise<UnrestrictedResult> {
  const { fbWhere, fbParams, take, skip, hasGeo, latNum, lngNum, cursorAnchor } = opts
  const { queryRawUnsafe } = deps

  // ── Phase 1b: Resolve paginated provider IDs ──────────────────────────
  // Âncoras na SELECT: o nextCursor vem do último item da página.
  let idSql: string
  let idQueryParams: unknown[]
  if (cursorAnchor) {
    // Keyset: take+1 rows para hasMore EXATO (sem COUNT extra).
    // Este caminho é SEMPRE rating-ordered; um cursor distance (sequência que
    // migrou de volta para o fallback após drift de localização) carrega as
    // mesmas chaves r/f/id — o seek rating continua a sequência sem lançar.
    const pred = buildKeysetPredicate({
      sort: "rating",
      anchor: cursorAnchor,
      startParam: fbParams.length + 1,
    })
    idSql = `SELECT u.id, u."avgRating" AS "avgRating", u."favoriteCount" AS "favoriteCount" FROM "User" u WHERE ${fbWhere} AND ${pred.sql}
     ORDER BY ${KEYSET_ORDER_KEYS_RATING}
     LIMIT $${fbParams.length + pred.params.length + 1}`
    idQueryParams = [...fbParams, ...pred.params, take + 1]
  } else {
    idSql = `SELECT u.id, u."avgRating" AS "avgRating", u."favoriteCount" AS "favoriteCount" FROM "User" u WHERE ${fbWhere}
     ORDER BY u."avgRating" DESC NULLS LAST, u."favoriteCount" DESC, u.id ASC
     LIMIT $${fbParams.length + 1} OFFSET $${fbParams.length + 2}`
    idQueryParams = [...fbParams, take + 1, skip]
  }

  const fallbackRows = await queryRawUnsafe<
    Array<{ id: string; avgRating: number | null; favoriteCount: number | null }>
  >(idSql, ...idQueryParams)

  const hasMore = fallbackRows.length > take
  const pageRows = hasMore ? fallbackRows.slice(0, take) : fallbackRows

  let nextCursor: string | null = null
  if (hasMore) {
    const last = pageRows[pageRows.length - 1]
    nextCursor = encodeProviderCursor({
      s: "rating",
      r: last.avgRating ?? null,
      f: last.favoriteCount ?? null,
      id: last.id,
    })
  }

  // ── Count total matching providers ─────────────────────────────────────
  const countResult = await queryRawUnsafe<Array<{ total: bigint }>>(
    `SELECT COUNT(*)::bigint AS total FROM "User" u WHERE ${fbWhere}`,
    ...fbParams,
  )
  const total = Number(countResult[0]?.total ?? 0)

  if (pageRows.length === 0) {
    return { items: [], total, expandedRadius: -1, nextCursor: null, hasMore: false }
  }

  // ── Phase 2: Fetch full provider data ──────────────────────────────────
  const items = await fetchProvidersData(
    pageRows.map((r) => r.id),
    { hasGeo, latNum, lngNum, centerGeo: null },
    deps,
  )

  return { items, total, expandedRadius: -1, nextCursor, hasMore }
}
