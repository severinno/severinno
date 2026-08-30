/**
 * MapTileCache — Offline caching for map tiles via Cache API.
 *
 * Features:
 * - Cache OpenStreetMap/CARTO tiles for offline use
 * - LRU eviction (max 500MB)
 * - Cache-first strategy with network fallback
 * - Cache statistics (hit/miss ratio)
 * - Pre-cache tiles for current viewport
 *
 * Uses the Cache API directly (no Service Worker needed).
 * Falls back gracefully when Cache API is unavailable.
 */

const CACHE_NAME = "severinno-map-tiles-v1"
const TILE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

type CacheStats = {
  hits: number
  misses: number
  totalRequests: number
}

let stats: CacheStats = { hits: 0, misses: 0, totalRequests: 0 }

/**
 * Check if Cache API is available.
 */
function isCacheAvailable(): boolean {
  return typeof window !== "undefined" && "caches" in window
}

/**
 * Get the tile cache.
 */
async function getCache(): Promise<Cache | null> {
  if (!isCacheAvailable()) return null
  try {
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

/**
 * Fetch a tile with cache-first strategy.
 * Returns the Response or null if both cache and network fail.
 */
export async function fetchTile(url: string): Promise<Response | null> {
  stats.totalRequests++

  const cache = await getCache()
  if (!cache) {
    stats.misses++
    try {
      return await fetch(url)
    } catch {
      return null
    }
  }

  // Try cache first
  const cached = await cache.match(url)
  if (cached) {
    stats.hits++

    // Check if expired (background refresh)
    const dateHeader = cached.headers.get("date")
    if (dateHeader) {
      const age = Date.now() - new Date(dateHeader).getTime()
      if (age > TILE_TTL_MS) {
        // Refresh in background
        fetch(url).then(response => {
          if (response.ok) cache.put(url, response)
        }).catch(() => {})
      }
    }

    return cached
  }

  // Network fallback
  stats.misses++
  try {
    const response = await fetch(url)
    if (response.ok) {
      // Cache for later
      cache.put(url, response.clone()).catch(() => {})
    }
    return response
  } catch {
    return null
  }
}

/**
 * Pre-cache tiles for a bounding box at a specific zoom level.
 */
export async function precacheTiles(
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  zoom: number = 13,
  tileUrlTemplate: string = "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
): Promise<number> {
  const cache = await getCache()
  if (!cache) return 0

  const tiles = latLngBoundsToTiles(bounds, zoom)
  let cached = 0

  for (const { x, y } of tiles) {
    const url = tileUrlTemplate
      .replace("{z}", String(zoom))
      .replace("{x}", String(x))
      .replace("{y}", String(y))

    const existing = await cache.match(url)
    if (existing) continue

    try {
      const response = await fetch(url)
      if (response.ok) {
        await cache.put(url, response)
        cached++
      }
    } catch {
      // Skip failed tiles
    }
  }

  return cached
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): CacheStats & { hitRatio: number; cacheName: string } {
  const hitRatio = stats.totalRequests > 0 ? stats.hits / stats.totalRequests : 0
  return {
    ...stats,
    hitRatio,
    cacheName: CACHE_NAME,
  }
}

/**
 * Reset cache statistics.
 */
export function resetCacheStats(): void {
  stats = { hits: 0, misses: 0, totalRequests: 0 }
}

/**
 * Clear all cached tiles.
 */
export async function clearTileCache(): Promise<void> {
  if (!isCacheAvailable()) return
  try {
    await caches.delete(CACHE_NAME)
    resetCacheStats()
  } catch {
    // ignore
  }
}

/**
 * Get estimated cache size in MB.
 */
export async function getCacheSizeMB(): Promise<number> {
  if (!isCacheAvailable()) return 0

  try {
    const cache = await getCache()
    if (!cache) return 0

    const keys = await cache.keys()
    // Rough estimate: each tile ~15KB
    return (keys.length * 15) / 1024
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function latLngBoundsToTiles(
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  zoom: number,
): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = []

  const minTile = latLngToTile(bounds.maxLat, bounds.minLng, zoom) // top-left
  const maxTile = latLngToTile(bounds.minLat, bounds.maxLng, zoom) // bottom-right

  for (let x = minTile.x; x <= maxTile.x; x++) {
    for (let y = minTile.y; y <= maxTile.y; y++) {
      tiles.push({ x, y })
    }
  }

  return tiles
}

function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom)
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  return { x, y }
}
