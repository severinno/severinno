/**
 * geohash.ts
 *
 * Minimal geohash encoder — pure function, zero deps, no `server-only`.
 *
 * Geohash groups nearby coordinates into the same cell more uniformly than
 * `toFixed(3)`, which creates rectangular cells with misalignment at
 * boundaries. Two points 50m apart no longer get different cache keys just
 * because they straddle a 0.001° boundary.
 *
 * Single source of truth: previously inlined in postgis.ts; now shared with
 * the providers radius-count/min-distance cache keys (radius-expansion.ts).
 *
 * Safe to import from both server and client (no I/O, no Node APIs).
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"

/**
 * Encode lat/lng as a geohash string of the given precision.
 *
 * Precision 7 → ~153m cells, the same granularity postgis.ts uses for
 * proximity cache keys.
 */
export function encodeGeohash(lat: number, lng: number, precision = 7): string {
  let minLat = -90,
    maxLat = 90
  let minLng = -180,
    maxLng = 180
  let hash = ""
  let isLng = true
  let bit = 0
  let ch = 0

  while (hash.length < precision) {
    if (isLng) {
      const mid = (minLng + maxLng) / 2
      if (lng >= mid) {
        ch = (ch << 1) | 1
        minLng = mid
      } else {
        ch <<= 1
        maxLng = mid
      }
    } else {
      const mid = (minLat + maxLat) / 2
      if (lat >= mid) {
        ch = (ch << 1) | 1
        minLat = mid
      } else {
        ch <<= 1
        maxLat = mid
      }
    }
    isLng = !isLng
    bit++
    if (bit === 5) {
      hash += BASE32[ch]!
      bit = 0
      ch = 0
    }
  }
  return hash
}
