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
 * Returns id + distanceKm for every provider within the radius. Additional
 * filters (active, verified, text search, category) should be applied by
 * the caller using Prisma's typed `where` on the returned IDs.
 *
 * Returns an empty array if PostGIS is not available or the query fails
 * (caller should fall back to Haversine JS calculation).
 */
export async function findProvidersWithinRadius(
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<ProximityResult[]> {
  try {
    // $queryRaw uses parameterized queries — `${lng}` etc. are safe from
    // SQL injection because Prisma passes them as bound parameters.
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
          ${radiusKm * 1000}  -- ST_DWithin uses meters
        )
      ORDER BY distance_km ASC
    `
    return rows.map((r) => ({ id: r.id, distanceKm: Number(r.distance_km) }))
  } catch (e) {
    // PostGIS likely not installed — return empty, caller falls back to Haversine
    console.warn("PostGIS ST_DWithin query failed (extension may not be installed):", e)
    return []
  }
}

/**
 * Calculate the distance (in km) between two users using PostGIS.
 * Returns null if either user has no location data.
 */
export async function getDistanceBetween(
  userId1: string,
  userId2: string,
): Promise<number | null> {
  try {
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
  } catch {
    return null
  }
}

/**
 * Check if PostGIS extension is available in the current database.
 */
export async function isPostGISAvailable(): Promise<boolean> {
  try {
    const rows = await db.$queryRaw<Array<{ available: boolean }>>`
      SELECT true AS available
      FROM pg_extension
      WHERE extname = 'postgis'
    `
    return rows.length > 0 && rows[0]?.available === true
  } catch {
    return false
  }
}
