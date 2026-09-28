/**
 * PostGIS spatial helpers for the Severinno Marketplace.
 *
 * Prisma does not natively support PostGIS geography columns, so spatial
 * queries use raw SQL via `prisma.$queryRaw`. This file provides typed
 * wrappers for the most common spatial operations.
 *
 * Prerequisites:
 *   - PostgreSQL with PostGIS extension enabled
 *   - A `location geography(Point, 4326)` column on the User model
 *     (added via manual SQL migration — see prisma/migrations/manual/)
 *
 * NOTE: All additional filters (role, active, verified) are applied in the
 * calling code (providers/route.ts), NOT in the SQL here. This keeps the
 * raw SQL simple and avoids SQL injection risks from concatenation.
 */

import { db } from "@/lib/db"
import { withCache } from "@/lib/redis"
import { trackGeoLatency } from "./geo-metrics"
import logger from "./logger"

// Cache TTL values
const PROXIMITY_CACHE_TTL = 60 // 60 seconds for proximity queries
const DISTANCE_CACHE_TTL = 60 // 60 seconds for user-to-user distance
const POSTGIS_CHECK_CACHE_TTL = 300 // 5 minutes for PostGIS availability check

// Geohash encoder lives in the shared pure module (single source of truth)
// — used here for proximity/KNN cache keys and re-exported for convenience.
import { encodeGeohash } from "./geohash"
export { encodeGeohash } from "./geohash"

/**
 * Build a cache key from geohash-encoded coordinates and radius.
 * Geohash-7 (~153m precision) groups nearby queries into the same
 * cache cell, improving hit rate over the previous toFixed(3) approach.
 */
function proximityCacheKey(lat: number, lng: number, radiusKm: number): string {
  const gh = encodeGeohash(lat, lng, 7)
  return `proximity:${gh}:${radiusKm}`
}

/**
 * Result of a proximity query — provider id + distance in km.
 */
export type ProximityResult = {
  id: string
  distanceKm: number
}

/**
 * Find all provider geographic ids within a given radius (in km) from a
 * center point using PostGIS ST_DWithin (index-assisted).
 *
 * Results are cached in Redis for 60 seconds (PROXIMITY_CACHE_TTL) to
 * avoid repeated queries for the same area within a short time window.
 * The cache key uses lat/lng rounded to 3 decimal places (~110m precision)
 * so nearby queries share a cache entry.
 *
 * Returns id + distanceKm for every provider within the radius. Additional
 * filters (active, verified, text search, category) should be applied by
 * the caller using Prisma's typed `where` on the returned IDs.
 *
 * Returns an empty array if PostGIS is not available or the query fails
 * (caller should fall back to Haversine JS calculation).
 */
/** Wraps findProvidersWithinRadius with PostGIS latency tracking. */
export function findProvidersWithinRadiusWithMetrics(
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<ProximityResult[]> {
  return trackGeoLatency("postgis", () => _findProvidersWithinRadius(lat, lng, radiusKm))
}

export const findProvidersWithinRadius = findProvidersWithinRadiusWithMetrics
export const getDistanceBetween = getDistanceBetweenWithMetrics
export const findNearestProvidersKNN = findNearestProvidersKNNWithMetrics

/** Wraps findNearestProvidersKNN with PostGIS latency tracking. */
export function findNearestProvidersKNNWithMetrics(
  lat: number,
  lng: number,
  limit: number = 20,
  maxRadiusKm?: number,
): Promise<ProximityResult[]> {
  return trackGeoLatency("postgis", () => _findNearestProvidersKNN(lat, lng, limit, maxRadiusKm))
}

/**
 * Find the N closest providers using PostGIS K-Nearest Neighbors (KNN) GiST index operator (<->).
 * Traverses the spatial index directly without calculating distance across all rows first.
 */
async function _findNearestProvidersKNN(
  lat: number,
  lng: number,
  limit: number = 20,
  maxRadiusKm?: number,
): Promise<ProximityResult[]> {
  try {
    const cacheKey = `knn:${encodeGeohash(lat, lng, 7)}:${limit}:${maxRadiusKm ?? "all"}`
    return await withCache(
      cacheKey,
      async () => {
        const rows =
          typeof maxRadiusKm === "number" && maxRadiusKm > 0
            ? await db.$queryRaw<Array<{ id: string; distance_km: number }>>`
              SELECT
                id,
                ST_Distance(
                  location,
                  ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
                ) / 1000 AS distance_km
              FROM "User"
              WHERE
                role = 'PROVIDER'
                AND active = true
                AND verified = true
                AND "deletedAt" IS NULL
                AND location IS NOT NULL
                AND ST_DWithin(
                  location,
                  ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
                  ${maxRadiusKm * 1000}
                )
              ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography ASC
              LIMIT ${limit}
            `
            : await db.$queryRaw<Array<{ id: string; distance_km: number }>>`
              SELECT
                id,
                ST_Distance(
                  location,
                  ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
                ) / 1000 AS distance_km
              FROM "User"
              WHERE
                role = 'PROVIDER'
                AND active = true
                AND verified = true
                AND "deletedAt" IS NULL
                AND location IS NOT NULL
              ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography ASC
              LIMIT ${limit}
            `
        return rows.map((r) => ({ id: r.id, distanceKm: Number(r.distance_km) }))
      },
      PROXIMITY_CACHE_TTL,
    )
  } catch (e) {
    logger.warn({ err: e }, "PostGIS KNN query failed")
    return []
  }
}

/** @internal use findProvidersWithinRadiusWithMetrics for latency tracking. */
async function _findProvidersWithinRadius(
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<ProximityResult[]> {
  try {
    return await withCache(
      proximityCacheKey(lat, lng, radiusKm),
      async () => {
        const rows = await db.$queryRaw<Array<{ id: string; distance_km: number }>>`
          SELECT
            id,
            ST_Distance(
              location,
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
            ) / 1000 AS distance_km
          FROM "User"
          WHERE
            role = 'PROVIDER'
            AND active = true
            AND verified = true
            AND "deletedAt" IS NULL
            AND location IS NOT NULL
            AND ST_DWithin(
              location,
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
              ${radiusKm * 1000}
            )
          ORDER BY distance_km ASC
        `
        return rows.map((r) => ({ id: r.id, distanceKm: Number(r.distance_km) }))
      },
      PROXIMITY_CACHE_TTL,
    )
  } catch (e) {
    logger.warn({ err: e }, "PostGIS ST_DWithin query failed")
    return []
  }
}

/**
 * Calculate the distance (in km) between two users using PostGIS.
 * Returns null if either user has no location data.
 *
 * Results are cached in Redis for 60 seconds (DISTANCE_CACHE_TTL) to
 * avoid repeated distance lookups between the same user pair.
 */
/** Wraps getDistanceBetween with PostGIS latency tracking. */
export function getDistanceBetweenWithMetrics(
  userId1: string,
  userId2: string,
): Promise<number | null> {
  return trackGeoLatency("postgis", () => _getDistanceBetween(userId1, userId2))
}

/** @internal use getDistanceBetweenWithMetrics for latency tracking. */
async function _getDistanceBetween(userId1: string, userId2: string): Promise<number | null> {
  try {
    // Sort IDs so distance:A:B and distance:B:A share the same cache entry
    const [a, b] = [userId1, userId2].sort()
    return await withCache(
      `distance:${a}:${b}`,
      async () => {
        const rows = await db.$queryRaw<Array<{ distance_km: number | null }>>`
          SELECT
            ST_Distance(
              u1.location,
              u2.location
            ) / 1000 AS distance_km
          FROM "User" u1, "User" u2
          WHERE
            u1.id = ${userId1}
            AND u2.id = ${userId2}
            AND u1.location IS NOT NULL
            AND u2.location IS NOT NULL
        `
        return rows[0]?.distance_km ?? null
      },
      DISTANCE_CACHE_TTL,
    )
  } catch (err) {
    logger.debug({ err }, "postgis: distance query failed")
    return null
  }
}

/**
 * Check if PostGIS extension is available in the current database.
 *
 * Results are cached in Redis for 5 minutes (POSTGIS_CHECK_CACHE_TTL) since
 * the extension availability rarely changes (only when the extension is
 * installed or removed via migration).
 */
export async function isPostGISAvailable(): Promise<boolean> {
  try {
    return await withCache(
      "postgis:available",
      async () => {
        const rows = await db.$queryRaw<Array<{ available: boolean }>>`
          SELECT true AS available
          FROM pg_extension
          WHERE extname = 'postgis'
        `
        return rows.length > 0 && rows[0]?.available === true
      },
      POSTGIS_CHECK_CACHE_TTL,
    )
  } catch (err) {
    logger.debug({ err }, "postgis: availability check failed")
    return false
  }
}

/**
 * Find provider geographic IDs located inside a bounding box (e.g. current map viewport)
 * using PostGIS ST_MakeEnvelope and spatial index.
 *
 * Results are cached for 30 seconds to avoid repeated queries for the same viewport.
 */
const BOUNDS_CACHE_TTL = 30

export async function findProvidersWithinBounds(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  limit: number = 50,
): Promise<string[]> {
  try {
    // Round coordinates to 4 decimal places (~11m precision) for cache grouping
    const key = `bounds:${minLat.toFixed(4)}:${minLng.toFixed(4)}:${maxLat.toFixed(4)}:${maxLng.toFixed(4)}:${limit}`
    return await withCache(
      key,
      async () => {
        const rows = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM "User"
        WHERE
          role = 'PROVIDER'
          AND active = true
          AND "deletedAt" IS NULL
          AND location IS NOT NULL
          AND ST_Intersects(
            location,
            ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)::geography
          )
        LIMIT ${limit}
      `
        return rows.map((r) => r.id)
      },
      BOUNDS_CACHE_TTL,
    )
  } catch (err) {
    logger.debug({ err }, "postgis: bounds query failed")
    return []
  }
}

/**
 * Check if a geographic point (client location) falls inside a provider's
 * custom service zone polygon stored as GeoJSON.
 *
 * Uses PostGIS ST_Contains with ST_GeomFromGeoJSON for polygon and ST_Point for the point.
 */
export async function isPointInServiceZone(
  lat: number,
  lng: number,
  polygonGeoJson: string,
): Promise<boolean> {
  try {
    const rows = await db.$queryRaw<Array<{ inside: boolean }>>`
      SELECT ST_Contains(
        ST_GeomFromGeoJSON(${polygonGeoJson}),
        ST_SetSRID(ST_Point(${lng}, ${lat}), 4326)
      ) AS inside
    `
    return rows[0]?.inside === true
  } catch (err) {
    logger.debug({ err }, "postgis: point-in-polygon check failed")
    return false
  }
}

/**
 * Filter a list of provider IDs by whether their custom service area polygon (if defined)
 * covers the given client point. Providers without a custom polygon are returned as unconstrained.
 */
export async function filterProvidersByServicePolygon(
  lat: number,
  lng: number,
  providerIds: string[],
): Promise<{ matchingIds: Set<string>; unconstrainedIds: Set<string> }> {
  const matchingIds = new Set<string>()
  const unconstrainedIds = new Set<string>()

  if (!providerIds || providerIds.length === 0) {
    return { matchingIds, unconstrainedIds }
  }

  try {
    const providers = await db.user.findMany({
      where: { id: { in: providerIds } },
      select: { id: true, servicePolygon: true },
    })

    for (const p of providers) {
      if (!p.servicePolygon) {
        unconstrainedIds.add(p.id)
        continue
      }
      const polyStr =
        typeof p.servicePolygon === "string" ? p.servicePolygon : JSON.stringify(p.servicePolygon)
      const inside = await isPointInServiceZone(lat, lng, polyStr)
      if (inside) {
        matchingIds.add(p.id)
      }
    }
  } catch (err) {
    logger.warn({ err }, "filterProvidersByServicePolygon failed")
  }

  return { matchingIds, unconstrainedIds }
}
