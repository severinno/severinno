/**
 * radius-expansion.ts
 *
 * Pure functions for progressive radius expansion in the providers search.
 *
 * The route calls `findEffectiveRadius` with an injected `countFn` that
 * encapsulates the actual DB query + Redis caching.  This keeps the
 * expansion logic testable without database mocks.
 *
 * `createCachedRadiusCountFn` is the factory that wires together Redis
 * caching, the raw SQL query, and the WHERE clause builder — following the
 * same dependency injection pattern as `computeDistanceMap` in
 * distance-fallback.ts.
 *
 * Strategy:
 *   1. Build the list of radii to try: user's radius first, then
 *      the predefined expansion steps that are larger than it.
 *   2. For each radius, call the injected count function.
 *   3. Return the first radius that finds ≥1 provider, or `null`.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Progressive radius expansion steps (km).
 *
 * Default: [5, 10, 25, 50, 100]
 *
 * Can be overridden via the EXPANSION_STEPS environment variable
 * (comma-separated, e.g. "3,8,15,30,60,120").
 */
export const EXPANSION_STEPS: readonly number[] = (() => {
  const env = process.env.EXPANSION_STEPS
  if (env) {
    const parsed = env
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (parsed.length > 0) return parsed
  }
  return [5, 10, 25, 50, 100]
})()

/** Default TTL for Redis-cached radius count queries (seconds). */
export const DEFAULT_COUNT_CACHE_TTL = 120

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a radius expansion search. */
export interface RadiusExpansionResult {
  /** The radius (km) that found providers, or null if none did. */
  effectiveRadius: number | null
  /**
   * The number of providers found at the effective radius.
   * Only meaningful when `effectiveRadius` is not null.
   */
  matchCount: number
}

/**
 * Type of the injected count function.
 *
 * The route's real implementation wraps a `$queryRawUnsafe` COUNT query
 * with `withCache` Redis caching.  In tests, this is just a function
 * that returns a pre-determined count.
 */
export type RadiusCountFn = (radiusKm: number) => Promise<number>

import { type WhereClauseBuilder } from "@/lib/sql"

// ---------------------------------------------------------------------------
// Radii construction
// ---------------------------------------------------------------------------

/**
 * Build the ordered list of radii to try during expansion.
 *
 * The user's requested radius is always tried first.  Only expansion
 * steps that are strictly larger than the user's radius are appended,
 * so the search is always monotonically increasing.
 *
 * @example
 * ```ts
 * buildRadiiToTry(10)  // → [10, 25, 50, 100]
 * buildRadiiToTry(0)   // → [0, 5, 10, 25, 50, 100]
 * buildRadiiToTry(50)  // → [50, 100]
 * buildRadiiToTry(200) // → [200]  (no expansion steps apply)
 * ```
 */
export function buildRadiiToTry(userRadiusKm: number): number[] {
  const radii: number[] = [userRadiusKm]
  for (const step of EXPANSION_STEPS) {
    if (step > userRadiusKm) radii.push(step)
  }
  return radii
}

// ---------------------------------------------------------------------------
// Expansion loop
// ---------------------------------------------------------------------------

/**
 * Find the smallest effective radius that returns at least one provider.
 *
 * Iterates through the radii produced by `buildRadiiToTry`, calling
 * `countFn` for each.  Stops at the first radius where count ≥ 1.
 *
 * Returns `null` when no radius in the expansion chain finds providers.
 * The caller (route) should then try an unrestricted search.
 *
 * @param userRadiusKm - The radius requested by the user.
 * @param countFn      - Async function that returns the provider count
 *                       for a given radius.  Injected for testability.
 *
 * @example
 * ```ts
 * // Pure test — no DB needed
 * const result = await findEffectiveRadius(10, async (r) =>
 *   r >= 25 ? 3 : 0,
 * )
 * // result.effectiveRadius === 25
 * ```
 */
export async function findEffectiveRadius(
  userRadiusKm: number,
  countFn: RadiusCountFn,
): Promise<RadiusExpansionResult> {
  const radiiToTry = buildRadiiToTry(userRadiusKm)

  for (const tryRadius of radiiToTry) {
    const count = await countFn(tryRadius)
    if (count > 0) {
      return { effectiveRadius: tryRadius, matchCount: count }
    }
  }

  return { effectiveRadius: null, matchCount: 0 }
}

// ---------------------------------------------------------------------------
// Cache-key helper
// ---------------------------------------------------------------------------

/**
 * Build a Redis cache key for a radius-level provider count query.
 *
 * Exported separately so tests can verify key structure without invoking
 * the full factory.
 *
 * @example
 * ```ts
 * radiusCountCacheKey(-23.551, -46.633, 10, ["cat-1"], "eletricista")
 * // → "providers:count:-23.551:-46.633:10:cat-1:eletricista"
 * ```
 */
export function radiusCountCacheKey(
  lat: number,
  lng: number,
  radiusKm: number,
  categoryIds: string[] | undefined,
  q: string | undefined,
): string {
  const rLat = lat.toFixed(3)
  const rLng = lng.toFixed(3)
  const cats = categoryIds?.length ? categoryIds.sort().join(",") : "all"
  const query = q?.trim() || ""
  return `providers:count:${rLat}:${rLng}:${radiusKm}:${cats}:${query}`
}

// ---------------------------------------------------------------------------
// Factory — cached radius-count function
// ---------------------------------------------------------------------------

/** Options for {@link createCachedRadiusCountFn}. */
export interface CreateCachedRadiusCountFnOptions {
  /** User's latitude. */
  lat: number
  /** User's longitude. */
  lng: number
  /** Optional category filter IDs. */
  categoryIds?: string[]
  /** Optional full-text search query. */
  q?: string
  /**
   * Redis cache TTL in seconds.  Defaults to {@link DEFAULT_COUNT_CACHE_TTL}
   * (120 s = 2 min).
   */
  cacheTtl?: number
  /**
   * Injected Prisma raw-query executor.
   * Expected signature matches `db.$queryRawUnsafe`.
   */
  queryRawUnsafe: <T>(sql: string, ...params: unknown[]) => Promise<T>
  /**
   * Injected Redis cache wrapper.
   * Expected signature matches `withCache` from `@/lib/redis`.
   */
  withCache: <T>(key: string, fn: () => Promise<T>, ttl: number) => Promise<T>
  /**
   * Injected SQL WHERE clause builder.
   * The route passes its internal `buildProviderWhereClause`.
   */
  buildWhereClause: WhereClauseBuilder
}

/**
 * Factory that creates a {@link RadiusCountFn} backed by a Redis-cached
 * PostGIS COUNT query.
 *
 * This is the production-grade count function that wires together:
 *   1. Building the WHERE clause via the injected `buildWhereClause`.
 *   2. A `SELECT COUNT(*)` query using the injected `queryRawUnsafe`.
 *   3. Redis caching via the injected `withCache`.
 *
 * By injecting these three dependencies, the function is fully testable
 * with mocks — no database or Redis connection required — following the
 * same pattern as `computeDistanceMap` in distance-fallback.ts.
 *
 * @param opts - Options including geo params, cache TTL, and injected deps.
 * @returns A `RadiusCountFn` suitable for passing to `findEffectiveRadius`.
 *
 * @example
 * ```ts
 * const countFn = createCachedRadiusCountFn({
 *   lat: -23.5505,
 *   lng: -46.6333,
 *   categoryIds: ["cat-1"],
 *   q: "eletricista",
 *   cacheTtl: 120,
 *   queryRawUnsafe: db.$queryRawUnsafe.bind(db),
 *   withCache,
 *   buildWhereClause,
 * })
 * const result = await findEffectiveRadius(10, countFn)
 * ```
 */
export function createCachedRadiusCountFn(opts: CreateCachedRadiusCountFnOptions): RadiusCountFn {
  const { lat, lng, categoryIds, q, cacheTtl, queryRawUnsafe, withCache, buildWhereClause } = opts
  const ttl = cacheTtl ?? DEFAULT_COUNT_CACHE_TTL

  return async (tryRadius: number): Promise<number> => {
    const geo = { lat, lng, radiusKm: tryRadius }
    const cacheKey = radiusCountCacheKey(lat, lng, tryRadius, categoryIds, q)
    const [countWhere, countParams] = buildWhereClause({
      categoryIds,
      q,
      centerGeo: geo,
    })

    return withCache<number>(
      cacheKey,
      async () => {
        const result = await queryRawUnsafe<Array<{ total: bigint }>>(
          `SELECT COUNT(*)::bigint AS total FROM "User" u WHERE ${countWhere}`,
          ...countParams,
        )
        return Number(result[0]?.total ?? 0)
      },
      ttl,
    )
  }
}
