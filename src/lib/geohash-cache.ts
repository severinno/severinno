/**
 * geohash-cache.ts — Pure TypeScript Geohash Encoder/Decoder & SWR Spatial Edge Cache
 *
 * Encodes geographical coordinates into hierarchical base32 strings for sub-2ms
 * spatial cache lookups and neighborhood cluster partitioning.
 *
 * Precision table:
 * - 4: ~39.1 km x 19.5 km (Metropolitan Area)
 * - 5: ~4.9 km x 4.9 km   (City Zone / District)
 * - 6: ~1.2 km x 0.6 km   (Neighborhood level — Ideal for localized searches)
 * - 7: ~152 m x 152 m     (Street Block)
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"
const BITS = [16, 8, 4, 2, 1]

export interface GeohashBBox {
  minLat: number
  minLng: number
  maxLat: number
  maxLng: number
}

// In-Memory SWR Cache store for geohash searches
const geohashSearchCache = new Map<string, { data: unknown; expiresAt: number; staleAt: number }>()

/**
 * Encodes Latitude and Longitude to standard Base32 Geohash
 */
export function encodeGeohash(lat: number, lng: number, precision: number = 6): string {
  let isEven = true
  let latMin = -90
  let latMax = 90
  let lngMin = -180
  let lngMax = 180

  let ch = 0
  let bit = 0
  let geohash = ""

  while (geohash.length < precision) {
    if (isEven) {
      const mid = (lngMin + lngMax) / 2
      if (lng >= mid) {
        ch |= BITS[bit]
        lngMin = mid
      } else {
        lngMax = mid
      }
    } else {
      const mid = (latMin + latMax) / 2
      if (lat >= mid) {
        ch |= BITS[bit]
        latMin = mid
      } else {
        latMax = mid
      }
    }

    isEven = !isEven
    if (bit < 4) {
      bit++
    } else {
      geohash += BASE32[ch]
      bit = 0
      ch = 0
    }
  }

  return geohash
}

/**
 * Decodes a Geohash string back into Bounding Box and Center coordinates
 */
export function decodeGeohash(geohash: string): { lat: number; lng: number; bbox: GeohashBBox } {
  let isEven = true
  let latMin = -90
  let latMax = 90
  let lngMin = -180
  let lngMax = 180

  for (let i = 0; i < geohash.length; i++) {
    const c = geohash[i]
    const cd = BASE32.indexOf(c)
    if (cd === -1) continue

    for (let j = 0; j < 5; j++) {
      const mask = BITS[j]
      if (isEven) {
        const mid = (lngMin + lngMax) / 2
        if ((cd & mask) !== 0) {
          lngMin = mid
        } else {
          lngMax = mid
        }
      } else {
        const mid = (latMin + latMax) / 2
        if ((cd & mask) !== 0) {
          latMin = mid
        } else {
          latMax = mid
        }
      }
      isEven = !isEven
    }
  }

  const lat = Number(((latMin + latMax) / 2).toFixed(6))
  const lng = Number(((lngMin + lngMax) / 2).toFixed(6))

  return {
    lat,
    lng,
    bbox: { minLat: latMin, minLng: lngMin, maxLat: latMax, maxLng: lngMax },
  }
}

/**
 * Gets or sets cached search results for a Geohash cell with SWR (Stale-While-Revalidate)
 */
export async function getOrSetGeohashCache<T>(
  geohash: string,
  cacheKeySuffix: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = 60,
): Promise<{ data: T; source: "cache-hit" | "swr-stale" | "fresh-db" }> {
  const cacheKey = `geo:gh:${geohash}:${cacheKeySuffix}`
  const now = Date.now()
  const cached = geohashSearchCache.get(cacheKey)

  if (cached) {
    if (now < cached.expiresAt) {
      return { data: cached.data as T, source: "cache-hit" }
    }

    // Stale-While-Revalidate window (up to 5 minutes after expiration)
    if (now < cached.staleAt) {
      // Trigger background refresh
      fetcher()
        .then((fresh) => {
          geohashSearchCache.set(cacheKey, {
            data: fresh,
            expiresAt: now + ttlSeconds * 1000,
            staleAt: now + (ttlSeconds + 300) * 1000,
          })
        })
        .catch(() => {})

      return { data: cached.data as T, source: "swr-stale" }
    }
  }

  // Fetch fresh
  const freshData = await fetcher()
  geohashSearchCache.set(cacheKey, {
    data: freshData,
    expiresAt: now + ttlSeconds * 1000,
    staleAt: now + (ttlSeconds + 300) * 1000,
  })

  return { data: freshData, source: "fresh-db" }
}

/**
 * Clear cached spatial entries (useful after data seeds or provider location updates)
 */
export function clearGeohashCache(): void {
  geohashSearchCache.clear()
}
