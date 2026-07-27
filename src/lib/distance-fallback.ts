/**
 * distance-fallback.ts
 *
 * Encapsulates the PostGIS → Haversine → null distance computation chain
 * used in the providers route (Phase 2 of fetchProvidersData).
 *
 * Strategy (in order):
 *   1. PostGIS ST_Distance — single $queryRawUnsafe for all provider IDs.
 *      Only attempted when `centerGeo` is set (PostGIS is available).
 *   2. Haversine JS — per-provider fallback when the PostGIS query fails
 *      or returns no result for that provider.
 *   3. null — when neither PostGIS result nor provider lat/lng is available.
 *
 * The `queryRawUnsafe` parameter is injected so callers can pass
 * `db.$queryRawUnsafe` in production or a mock in tests.
 */

import { haversineKm } from "@/lib/geo-shared"

/** Minimal provider shape needed for Haversine fallback. */
export interface ProviderGeo {
  id: string
  lat: number | null
  lng: number | null
}

/** Center-point coordinates for the PostGIS distance query. */
export interface CenterGeo {
  lng: number
  lat: number
}

export interface ComputeDistanceMapOptions {
  /** Provider IDs for the PostGIS batch query. */
  providerIds: string[]
  /** Provider records (with lat/lng) for Haversine fallback. */
  providers: ProviderGeo[]
  /**
   * When set, a PostGIS ST_Distance query is attempted first.
   * When null/undefined, the function skips PostGIS entirely.
   */
  centerGeo: CenterGeo | null | undefined
  /** Whether the user has valid geolocation coordinates. */
  hasGeo: boolean
  /** User's latitude (used for Haversine fallback). */
  userLat: number
  /** User's longitude (used for Haversine fallback). */
  userLng: number
  /**
   * Injected database raw-query function.
   * Expected signature matches `db.$queryRawUnsafe`.
   */
  queryRawUnsafe: <T>(sql: string, ...params: unknown[]) => Promise<T>
}

/**
 * Compute a Map<providerId, distanceKm> using the fallback chain:
 *
 *   PostGIS ST_Distance  →  Haversine JS  →  null
 *
 * The returned Map always contains an entry for every provider in
 * `providers`.  Missing/unknown distances are stored as `null`.
 *
 * @example
 * ```ts
 * const distanceMap = await computeDistanceMap({
 *   providerIds: ["p1", "p2"],
 *   providers:  [{ id: "p1", lat: -23.55, lng: -46.63 }],
 *   centerGeo:  { lat: -23.55, lng: -46.63 },
 *   hasGeo:     true,
 *   userLat:    -23.55,
 *   userLng:    -46.63,
 *   queryRawUnsafe: db.$queryRawUnsafe,
 * })
 * ```
 */
export async function computeDistanceMap(
  opts: ComputeDistanceMapOptions,
): Promise<Map<string, number | null>> {
  const { providerIds, providers, centerGeo, hasGeo, userLat, userLng, queryRawUnsafe } = opts

  // ── Phase A: PostGIS batch query ────────────────────────────────────
  //
  // Single round-trip: SELECT id, ST_Distance(...) / 1000 AS distance_km
  // for ALL provider IDs.  If this throws the catch block falls through
  // to the per-provider Haversine fallback below.
  const postgisMap = new Map<string, number>()
  if (centerGeo) {
    try {
      const rows = await queryRawUnsafe<
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
      for (const row of rows) {
        postgisMap.set(row.id, Math.round(row.distance_km * 10) / 10)
      }
    } catch {
      // PostGIS query failed — fall through to Haversine below
    }
  }

  // ── Phase B: Merge PostGIS + Haversine fallback ─────────────────────
  //
  // For each provider: prefer PostGIS result; if absent, compute
  // Haversine when coordinates are available; otherwise null.
  const result = new Map<string, number | null>()

  for (const p of providers) {
    const postgisDist = postgisMap.get(p.id)
    let distanceKm: number | null

    if (postgisDist !== undefined) {
      distanceKm = postgisDist
    } else if (hasGeo && p.lat !== null && p.lng !== null) {
      distanceKm = Math.round(
        haversineKm(userLat, userLng, p.lat, p.lng) * 10,
      ) / 10
    } else {
      distanceKm = null
    }

    result.set(p.id, distanceKm)
  }

  return result
}
