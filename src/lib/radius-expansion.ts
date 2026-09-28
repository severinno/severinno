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
 * Single-pass optimization (KNN):
 *   Instead of issuing up to 5 sequential COUNT queries for
 *   [5, 10, 25, 50, 100], the route can ask once for the MIN distance to the
 *   closest eligible provider and derive the effective radius with
 *   `findEffectiveRadiusSinglePass` — 1 round trip instead of 5.
 *   `createCachedMinDistanceFn` is the factory for that cached query.
 *
 * Cache keys use geohash-7 (~153m cells, same as postgis.ts proximity keys)
 * and a normalized query so nearby users and case-variant searches share
 * cache entries instead of fragmenting them.
 *
 * Strategy (legacy loop, still used as fallback):
 *   1. Build the list of radii to try: user's radius first, then
 *      the predefined expansion steps that are larger than it.
 *   2. For each radius, call the injected count function.
 *   3. Return the first radius that finds ≥1 provider, or `null`.
 */

import { encodeGeohash } from "./geohash"

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

/**
 * Shorter TTL for "0 providers at this radius" counts (seconds).
 *
 * Caching a zero for the full TTL keeps a region empty for minutes after a
 * provider activates there. A short TTL bounds staleness cheaply while still
 * absorbing bursts.
 */
export const EMPTY_COUNT_CACHE_TTL = 15

/**
 * TTL for the cached MIN-distance (KNN single-pass) query (seconds).
 *
 * Same reasoning as the count TTLs: this value derives from provider
 * locations, which change rarely.
 */
export const DEFAULT_MIN_DISTANCE_CACHE_TTL = 120

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

/**
 * Single-pass radius resolution given the minimum distance to the closest provider.
 *
 * Rather than issuing up to 5 sequential COUNT queries for [5, 10, 25, 50, 100],
 * a single KNN / MIN(distance) query discovers minDistanceKm in 1 database round trip.
 * This function determines the smallest expansion step that encloses that distance.
 *
 * @param userRadiusKm - The initial requested radius (e.g. 5)
 * @param minDistanceKm - The distance in km to the closest eligible provider (or null if none exists)
 * @returns The effective radius to expand to, or null if beyond maximum expansion step.
 *
 * @example
 * ```ts
 * findEffectiveRadiusSinglePass(5, 3.1)   // → 5
 * findEffectiveRadiusSinglePass(5, 7.2)   // → 10
 * findEffectiveRadiusSinglePass(10, 22.0) // → 25
 * findEffectiveRadiusSinglePass(5, 150)   // → null
 * ```
 */
export function findEffectiveRadiusSinglePass(
  userRadiusKm: number,
  minDistanceKm: number | null,
): number | null {
  if (minDistanceKm === null || !Number.isFinite(minDistanceKm)) {
    return null
  }

  const radii = buildRadiiToTry(userRadiusKm)
  for (const radius of radii) {
    if (minDistanceKm <= radius) {
      return radius
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Pure helpers — max radius, quantization, normalized query
// ---------------------------------------------------------------------------

/**
 * Largest expansion step (km) — derived from EXPANSION_STEPS, never hardcoded.
 */
export const MAX_EXPANSION_KM: number = EXPANSION_STEPS[EXPANSION_STEPS.length - 1]!

/**
 * Quantize a user radius UP to the next canonical expansion step.
 *
 * Keeps arbitrary user radii (7km, 13km…) from fragmenting the cache: every
 * search is evaluated at a canonical radius that other users also hit.
 * Over-searching slightly (7 → 10) matches the expansion semantics already
 * reported to the client via `expandedRadius`.
 *
 * @example
 * ```ts
 * quantizeRadiusUp(7)   // → 10
 * quantizeRadiusUp(10)  // → 10
 * quantizeRadiusUp(0)   // → 5  (0 keeps its own level: exact-location search)
 * quantizeRadiusUp(200) // → 200 (above max: no canonical step applies)
 * ```
 */
export function quantizeRadiusUp(userRadiusKm: number): number {
  const step = EXPANSION_STEPS.find((s) => s >= userRadiusKm)
  return step ?? userRadiusKm
}

/**
 * Normalize a free-text query for cache-key purposes.
 * Mirrors geo-nominatim.ts: trim, lowercase, collapse inner whitespace.
 */
function normalizeQueryForCacheKey(q: string | undefined): string {
  return (q ?? "").trim().toLowerCase().replace(/\s+/g, " ")
}

// ---------------------------------------------------------------------------
// Cache-key helper
// ---------------------------------------------------------------------------

/**
 * Build a Redis cache key for a radius-level provider count query.
 *
 * Coordinates use geohash-7 (~153m cells — postgis.ts's proximity keys use
 * the same scheme) so nearby users share cache entries instead of
 * fragmenting them at `toFixed(3)` cell borders.
 *
 * The text query is normalized (trim + lowercase + collapsed whitespace) so
 * "Eletricista" and "eletricista" share the same entry.
 *
 * Exported separately so tests can verify key structure without invoking
 * the full factory.
 *
 * @example
 * ```ts   * radiusCountCacheKey(-23.551, -46.633, 10, ["cat-1"], "eletricista")
 * // → "providers:count:6gyf4bf:10:cat-1:eletricista"
 * ```
 */
export function radiusCountCacheKey(
  lat: number,
  lng: number,
  radiusKm: number,
  categoryIds: string[] | undefined,
  q: string | undefined,
): string {
  const gh = encodeGeohash(lat, lng, 7)
  const cats = categoryIds?.length ? categoryIds.sort().join(",") : "all"
  const query = normalizeQueryForCacheKey(q)
  return `providers:count:${gh}:${radiusKm}:${cats}:${query}`
}

/**
 * Build a Redis cache key for the MIN-distance (single-pass KNN) query.
 *
 * No radius component — the min distance over the filtered set is
 * radius-independent; the expansion steps are derived from it afterwards.
 */
export function minDistanceCacheKey(
  lat: number,
  lng: number,
  categoryIds: string[] | undefined,
  q: string | undefined,
): string {
  const gh = encodeGeohash(lat, lng, 7)
  const cats = categoryIds?.length ? categoryIds.sort().join(",") : "all"
  const query = normalizeQueryForCacheKey(q)
  return `providers:mindist:${gh}:${cats}:${query}`
}

// ---------------------------------------------------------------------------
// Factory — cached radius-count function
// ---------------------------------------------------------------------------/** Options for {@link createCachedRadiusCountFn}. */
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
   * (120 s = 2 min). Zero counts get {@link EMPTY_COUNT_CACHE_TTL} (15 s)
   * so a region does not stay empty for minutes after a provider activates.
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
   * The 4th `opts` argument (staleGraceSeconds) is optional — factories pass
   * it when supported so the count keys get stale-while-revalidate.
   */
  withCache: <T>(
    key: string,
    fn: () => Promise<T>,
    ttl: number,
    opts?: { staleGraceSeconds?: number },
  ) => Promise<T>
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
      // Stale-while-revalidate: absorb TTL expiry bursts with a slightly
      // stale count while the fresh one is computed in the background.
      { staleGraceSeconds: Math.round(ttl * 0.1) },
    )
  }
}

// ---------------------------------------------------------------------------
// Factory — cached MIN-distance (single-pass KNN) function
// ---------------------------------------------------------------------------

/** Options for {@link createCachedMinDistanceFn}. */
export interface CreateCachedMinDistanceFnOptions {
  /** User's latitude. */
  lat: number
  /** User's longitude. */
  lng: number
  /** Optional category filter IDs. */
  categoryIds?: string[]
  /** Optional full-text search query. */
  q?: string
  /**
   * Redis cache TTL in seconds. Defaults to
   * {@link DEFAULT_MIN_DISTANCE_CACHE_TTL} (120 s).
   */
  cacheTtl?: number
  /** Injected Prisma raw-query executor (`db.$queryRawUnsafe`). */
  queryRawUnsafe: <T>(sql: string, ...params: unknown[]) => Promise<T>
  /** Injected Redis cache wrapper (same contract as the count factory). */
  withCache: <T>(
    key: string,
    fn: () => Promise<T>,
    ttl: number,
    opts?: { staleGraceSeconds?: number },
  ) => Promise<T>
  /** Injected SQL WHERE clause builder (`buildProviderWhereClause`). */
  buildWhereClause: WhereClauseBuilder
}

/**
 * Result of the cached MIN-distance query.
 */
export interface MinDistanceResult {
  /**
   * Distance in km to the closest eligible provider, or `null` when no
   * provider matches the non-spatial filters (or none has a location).
   */
  minDistanceKm: number | null
  /**
   * Number of eligible providers that HAVE a location column (any distance).
   * Lets the caller distinguish "no providers at all" from "providers exist
   * but PostGIS location is missing" — the latter means the KNN answer is
   * unreliable and the legacy loop should decide.
   */
  locatedCount: number
}

/**
 * Factory that creates a cached MIN-distance resolver for the single-pass
 * KNN path — 1 round trip replaces the legacy sequential COUNT expansion.
 *
 * The query filters by the SAME non-spatial conditions (role/active/verified/
 * deleted, category, full-text) as the count query, then takes
 * `MIN(ST_Distance(...))` over all providers that have a location. The
 * effective radius is derived with {@link findEffectiveRadiusSinglePass}.
 */
export function createCachedMinDistanceFn(
  opts: CreateCachedMinDistanceFnOptions,
): () => Promise<MinDistanceResult> {
  const { lat, lng, categoryIds, q, cacheTtl, queryRawUnsafe, withCache, buildWhereClause } = opts
  const ttl = cacheTtl ?? DEFAULT_MIN_DISTANCE_CACHE_TTL
  const cacheKey = minDistanceCacheKey(lat, lng, categoryIds, q)

  return () => {
    // Non-spatial conditions only — MIN distance is radius-independent.
    const [where, params] = buildWhereClause({ categoryIds, q, centerGeo: null })

    return withCache<MinDistanceResult>(
      cacheKey,
      async () => {
        const result = await queryRawUnsafe<
          Array<{
            min_distance_km: number | null
            located: bigint
          }>
        >(
          // ⚠️ Placeholder indexing: the WHERE clause (built with
          // centerGeo: null) numbers its placeholders from $1 — so the
          // ST_MakePoint coordinates must come AFTER `params`, never before.
          // (Binding $1/$2 to lng/lat with `q` present fed a numeric into
          // to_tsquery() → "function to_tsquery(unknown, numeric) does not
          // exist" — caught by the E2E cache validation against real Postgres.)
          `SELECT
            MIN(ST_Distance(u.location, ST_SetSRID(ST_MakePoint($${params.length + 1}, $${params.length + 2}), 4326)::geography)) / 1000
              AS min_distance_km,
            COUNT(*)::bigint AS located
          FROM "User" u
          WHERE u.location IS NOT NULL AND ${where}`,
          ...params,
          lng,
          lat,
        )
        const row = result[0]
        return {
          minDistanceKm:
            row?.min_distance_km !== null && row?.min_distance_km !== undefined
              ? Number(row.min_distance_km)
              : null,
          locatedCount: Number(row?.located ?? 0),
        }
      },
      ttl,
      { staleGraceSeconds: Math.round(ttl * 0.1) },
    )
  }
}
