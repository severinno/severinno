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

import { fetchProvidersData, type FetchProvidersDataDeps, type ProviderDataItem } from "./fetch-providers-data"

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
}

/** Result of the unrestricted fallback query. */
export interface UnrestrictedResult {
  items: ProviderDataItem[]
  total: number
  /** Always -1, meaning "beyond max expansion (100 km)". */
  expandedRadius: -1
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
  const { fbWhere, fbParams, take, skip, hasGeo, latNum, lngNum } = opts
  const { queryRawUnsafe } = deps

  // ── Phase 1b: Resolve paginated provider IDs ──────────────────────────
  const fallbackIds = await queryRawUnsafe<Array<{ id: string }>>(
    `SELECT u.id FROM "User" u WHERE ${fbWhere}
     ORDER BY u."avgRating" DESC NULLS LAST, u."favoriteCount" DESC
     LIMIT $${fbParams.length + 1} OFFSET $${fbParams.length + 2}`,
    ...fbParams,
    take,
    skip,
  )

  // ── Count total matching providers ─────────────────────────────────────
  const countResult = await queryRawUnsafe<Array<{ total: bigint }>>(
    `SELECT COUNT(*)::bigint AS total FROM "User" u WHERE ${fbWhere}`,
    ...fbParams,
  )
  const total = Number(countResult[0]?.total ?? 0)

  if (fallbackIds.length === 0) {
    return { items: [], total, expandedRadius: -1 }
  }

  // ── Phase 2: Fetch full provider data ──────────────────────────────────
  const items = await fetchProvidersData(
    fallbackIds.map((r) => r.id),
    { hasGeo, latNum, lngNum, centerGeo: null },
    deps,
  )

  return { items, total, expandedRadius: -1 }
}
