/**
 * nearby-providers.ts
 *
 * Pure helpers for the "providers nearby" search used by the client map
 * during an active service (GET /api/bookings/nearby).
 *
 * The route uses PostGIS ST_DWithin when available (GiST index-assisted).
 * When PostGIS is unavailable, it falls back to this pure Haversine
 * filter — no I/O, no side effects, trivially testable without mocks.
 */

import { haversineKm } from "./geo-shared"

/** Minimal provider shape required for the Haversine fallback. */
export interface NearbyProviderCandidate {
  id: string
  lat: number
  lng: number
  name?: string | null
  avatarUrl?: string | null
  avgRating?: number | null
}

/** A provider within the requested radius, with computed distance (km). */
export interface NearbyProviderResult extends NearbyProviderCandidate {
  distanceKm: number
}

/**
 * Filter a list of providers by a center point + radius using the
 * pure Haversine formula (fallback path when PostGIS is not available).
 *
 * Providers with non-finite coordinates are excluded. Results are sorted
 * by distance ascending (closest first).
 *
 * @example
 * ```ts
 * filterProvidersByRadius(
 *   [{ id: "p1", lat: -23.55, lng: -46.63 }],
 *   -23.5, -46.6, 10,
 * )
 * // → [{ id: "p1", lat: -23.55, lng: -46.63, distanceKm: ~6.4 }]
 * ```
 */
export function filterProvidersByRadius(
  providers: NearbyProviderCandidate[],
  lat: number,
  lng: number,
  radiusKm: number,
): NearbyProviderResult[] {
  return providers
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({ ...p, distanceKm: haversineKm(lat, lng, p.lat, p.lng) }))
    .filter((p) => p.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
}
