/**
 * sql-builder.ts
 *
 * Pure SQL query builder for the providers search.
 *
 * Encapsulates the construction of parameterized WHERE clauses used
 * across multiple phases of the providers route (Phase 1a COUNT,
 * Phase 1b ID resolution, unrestricted fallback).
 *
 * The function is pure — no I/O, no side effects.  This makes it
 * trivially testable without mocks.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for {@link buildProviderWhereClause}. */
export interface BuildWhereClauseOptions {
  /** Optional category filter IDs. */
  categoryIds?: string[]
  /** Optional full-text search query. */
  q?: string
  /**
   * When set, a PostGIS ST_DWithin filter is appended.
   * When null/undefined, no spatial filter is applied.
   */
  centerGeo?: { lat: number; lng: number; radiusKm: number } | null
}

/**
 * Shape of the WHERE clause builder used by the radius-expansion DI pattern.
 *
 * Defined here alongside the implementation so that the canonical
 * production function (`buildProviderWhereClause`) and any mock/injected
 * variants share the same contract.
 */
export type WhereClauseBuilder = (opts: BuildWhereClauseOptions) => [string, unknown[]]

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the base WHERE clause and params for the providers search.
 *
 * Returns `[sqlString, paramsArray]` suitable for passing to
 * `$queryRawUnsafe` or embedding in a larger query.
 *
 * The clause always includes:
 *   - Role filter (`u.role = 'PROVIDER'`)
 *   - Active + verified flags
 *   - Soft-delete guard (`deletedAt IS NULL`)
 *
 * Optional filters (applied when the corresponding option is set):
 *   - PostGIS ST_DWithin radius filter
 *   - Full-text search via `search_vector` GIN index
 *   - Category EXISTS subquery
 *
 * @example
 * ```ts
 * const [sql, params] = buildProviderWhereClause({
 *   categoryIds: ["cat-1"],
 *   q: "eletricista",
 *   centerGeo: { lat: -23.55, lng: -46.63, radiusKm: 10 },
 * })
 * ```
 */
export function buildProviderWhereClause(opts: BuildWhereClauseOptions): [string, unknown[]] {
  const { categoryIds, q, centerGeo } = opts

  const conditions: string[] = [
    `u.role = 'PROVIDER'`,
    `u.active = true`,
    `u.verified = true`,
    `u."deletedAt" IS NULL`,
  ]
  const params: unknown[] = []
  let idx = 0

  // PostGIS radius filter
  if (centerGeo) {
    conditions.push(
      `u.location IS NOT NULL`,
      `ST_DWithin(u.location, ST_SetSRID(ST_MakePoint($${++idx}, $${++idx}), 4326)::geography, ${centerGeo.radiusKm * 1000})`,
    )
    params.push(centerGeo.lng, centerGeo.lat)
  }

  // Full-text search (sanitized)
  if (q) {
    const sanitized = q
      .replace(/[^\w\sÀ-ÿ]/g, " ") // remove non-alphanumeric (incl. acentos)
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
  if (categoryIds && categoryIds.length > 0) {
    const placeholders = categoryIds.map(() => `$${++idx}`).join(",")
    conditions.push(
      `EXISTS (
        SELECT 1 FROM "Service" s
        WHERE s."providerId" = u.id AND s.active = true
        AND s."categoryId" IN (${placeholders})
      )`,
    )
    params.push(...categoryIds)
  }

  return [conditions.join(" AND "), params]
}
