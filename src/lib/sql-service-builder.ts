/**
 * sql-service-builder.ts
 *
 * Pure SQL query builder for the services search.
 *
 * Encapsulates the construction of parameterized WHERE clauses used
 * when querying the "Service" table via $queryRawUnsafe.
 *
 * The function is pure — no I/O, no side effects.  This makes it
 * trivially testable without mocks.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for {@link buildServiceWhereClause}. */
export interface BuildServiceWhereClauseOptions {
  /** Filter by provider who owns the service. */
  providerId?: string
  /** Filter by category. */
  categoryId?: string
  /** Full-text search across title and description. */
  q?: string
  /** Filter by active status. Defaults to `true` when undefined. */
  active?: boolean
  /** Minimum base price (inclusive). */
  minPrice?: number
  /** Maximum base price (inclusive). */
  maxPrice?: number
}

/**
 * Shape of the WHERE clause builder used for service queries.
 *
 * Defined here alongside the implementation so that the canonical
 * production function (`buildServiceWhereClause`) and any mock/injected
 * variants share the same contract.
 */
export type ServiceWhereClauseBuilder = (
  opts: BuildServiceWhereClauseOptions,
) => [string, unknown[]]

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the base WHERE clause and params for the service search.
 *
 * Returns `[sqlString, paramsArray]` suitable for passing to
 * `$queryRawUnsafe` or embedding in a larger query.
 *
 * The clause always includes a soft-delete guard (`"deletedAt" IS NULL`).
 *
 * Optional filters (applied when the corresponding option is set):
 *   - providerId — restrict to a specific provider
 *   - categoryId — restrict to a specific category
 *   - q          — full-text search on title and description
 *   - active     — filter by active status (defaults to true)
 *   - minPrice / maxPrice — price range on basePrice
 *
 * @example
 * ```ts
 * const [sql, params] = buildServiceWhereClause({
 *   categoryId: "cat-1",
 *   q: "elétrica",
 *   minPrice: 100,
 * })
 * ```
 */
export function buildServiceWhereClause(
  opts: BuildServiceWhereClauseOptions,
): [string, unknown[]] {
  const { providerId, categoryId, q, active, minPrice, maxPrice } = opts

  const conditions: string[] = [`s.\"deletedAt\" IS NULL`]
  const params: unknown[] = []
  let idx = 0

  // Active filter (default to true)
  const activeFilter = active !== undefined ? active : true
  conditions.push(`s.active = $${++idx}`)
  params.push(activeFilter)

  // Provider filter
  if (providerId) {
    conditions.push(`s.\"providerId\" = $${++idx}`)
    params.push(providerId)
  }

  // Category filter
  if (categoryId) {
    conditions.push(`s.\"categoryId\" = $${++idx}`)
    params.push(categoryId)
  }

  // Full-text search on title and description
  if (q) {
    const sanitized = q
      .replace(/[^\w\sÀ-ÿ]/g, " ")
      .trim()
    if (sanitized) {
      const likePattern = `%${sanitized}%`
      conditions.push(
        `(s.title ILIKE $${++idx} OR s.description ILIKE $${idx})`,
      )
      params.push(likePattern)
    }
  }

  // Price range
  if (minPrice !== undefined && Number.isFinite(minPrice)) {
    conditions.push(`s.\"basePrice\" >= $${++idx}`)
    params.push(minPrice)
  }
  if (maxPrice !== undefined && Number.isFinite(maxPrice)) {
    conditions.push(`s.\"basePrice\" <= $${++idx}`)
    params.push(maxPrice)
  }

  return [conditions.join(" AND "), params]
}
