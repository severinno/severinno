import "server-only"
import { db as prisma } from "./db"
import { haversineKm } from "./geo-server"

export function isInCoverage(
  providerLat: number,
  providerLng: number,
  radiusKm: number,
  targetLat: number,
  targetLng: number,
): boolean {
  // Single-point check (O(1)) — pure helper, no scale risk.
  const dist = haversineKm(providerLat, providerLng, targetLat, targetLng)
  return dist <= radiusKm
}

/**
 * List providers whose own coverage radius (radiusKm) includes the target point.
 *
 * Scale-risk #1 closing (melhorias-otimizacoes.md item 1): the previous
 * implementation fetched ALL providers and filtered/sorted with in-memory
 * Haversine (`haversineKm` per item). Now a SINGLE PostGIS query does the
 * radius filter (ST_DWithin against each provider's own radiusKm column) and
 * the distance sort (ST_Distance) entirely in the DB — the fetch-all +
 * in-memory loop is gone (pinned by db-pagination-contract).
 *
 * Requires PostGIS (the stack-wide prerequisite for the providers listing).
 * Fails loud if the extension is unavailable — no silent empty fallback, so
 * a misconfigured DB surfaces instead of returning a misleading empty list.
 */
export async function getProvidersInCoverage(
  lat: number,
  lng: number,
): Promise<Array<{ id: string; name: string; distanceKm: number }>> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; distance_km: number }>
  >`
    SELECT
      id,
      name,
      ST_Distance(
        location,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      ) / 1000 AS distance_km
    FROM "User"
    WHERE
      role = 'PROVIDER'
      AND active = true
      AND location IS NOT NULL
      AND "radiusKm" IS NOT NULL
      AND ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        "radiusKm" * 1000
      )
    ORDER BY distance_km ASC
  `

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    distanceKm: +Number(r.distance_km).toFixed(2),
  }))
}
