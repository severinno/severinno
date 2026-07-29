/**
 * geo-shared.mjs — ESM shim for src/lib/geo-shared.ts
 *
 * Pure functions safe for server and client — no external imports.
 * SEE ALSO: src/lib/geo-shared.ts (TypeScript source)
 */

const EARTH_RADIUS_KM = 6371

function toRad(deg) {
  return (deg * Math.PI) / 180
}

/**
 * Haversine distance in kilometers between two lat/lng points.
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number}
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
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
 * @param {number|null|undefined} km
 * @returns {string}
 */
export function formatDistance(km) {
  if (km === null || km === undefined || !Number.isFinite(km)) return "\u2014"
  if (km < 1) {
    const meters = Math.round(km * 1000)
    return `${meters} m`
  }
  if (km < 10) {
    return `${km.toFixed(1).replace(".", ",")} km`
  }
  return `${Math.round(km)} km`
}
