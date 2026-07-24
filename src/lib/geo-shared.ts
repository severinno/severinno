/**
 * Shared geolocation helpers — safe for both server and client.
 *
 * These pure functions have no server-only imports (no `server-only`),
 * no external API calls, and no Node.js APIs. They can be imported
 * from anywhere.
 */

const EARTH_RADIUS_KM = 6371

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Haversine distance in kilometers between two lat/lng points.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}

/**
 * Format a distance (km) as a pt-BR string.
 * < 1 km  → "850 m"
 * >= 1 km → "1,2 km"
 */
export function formatDistance(km: number | null | undefined): string {
  if (km === null || km === undefined || !Number.isFinite(km)) return "—"
  if (km < 1) {
    const meters = Math.round(km * 1000)
    return `${meters} m`
  }
  if (km < 10) {
    return `${km.toFixed(1).replace(".", ",")} km`
  }
  return `${Math.round(km)} km`
}
