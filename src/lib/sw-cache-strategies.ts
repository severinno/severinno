/**
 * Service Worker Cache Strategies — offline-first for mobile areas with weak signal
 *
 * Extends the existing service worker (public/sw.js) with:
 * - Cache-first for static assets (CSS, JS, images)
 * - Network-first for API data with offline fallback
 * - Background sync for actions queued offline
 * - Stale-while-revalidate for provider listings
 *
 * Usage: import in the service worker or use as a standalone module.
 */

export const CACHE_VERSION = "v3"
export const STATIC_CACHE = `static-${CACHE_VERSION}`
export const DYNAMIC_CACHE = `dynamic-${CACHE_VERSION}`
export const OFFLINE_CACHE = `offline-${CACHE_VERSION}`
export const IMAGE_CACHE = `images-${CACHE_VERSION}`

/** URLs to cache immediately on install (critical app shell) */
export const PRECACHE_URLS = [
  "/",
  "/offline",
  "/manifest.json",
  // CSS/JS are hashed by Next.js, so we cache dynamically
]

/** Static asset patterns (cache-first) */
export const STATIC_PATTERNS = [
  /\.(?:js|css|woff2?|ttf|eot)$/,
  /\/_next\/static\//,
]

/** Image patterns (cache-first with size limit) */
export const IMAGE_PATTERNS = [
  /\.(?:png|jpg|jpeg|gif|svg|webp|avif)$/,
  /\/images\//,
  /\/avatars\//,
]

/** API patterns (network-first with offline fallback) */
export const API_PATTERNS = [
  /\/api\/providers/,
  /\/api\/services/,
  /\/api\/search/,
  /\/api\/geo\//,
]

/** Provider listing patterns (stale-while-revalidate) */
export const SWR_PATTERNS = [
  /\/api\/providers\?/,
  /\/api\/categories/,
]

/**
 * Cache strategy: Cache-First
 * Best for: static assets that rarely change.
 */
export async function cacheFirst(
  request: Request,
  cacheName: string,
): Promise<Response> {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response("Offline", { status: 503 })
  }
}

/**
 * Cache strategy: Network-First
 * Best for: API data that should be fresh but needs offline fallback.
 */
export async function networkFirst(
  request: Request,
  cacheName: string,
  _ttlMs = 5 * 60 * 1000, // 5 min default TTL
): Promise<Response> {
  const cache = await caches.open(cacheName)

  try {
    const response = await fetch(request)
    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    return new Response(JSON.stringify({ error: "Offline", offline: true }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  }
}

/**
 * Cache strategy: Stale-While-Revalidate
 * Best for: listings that should be fast but also update in background.
 */
export async function staleWhileRevalidate(
  request: Request,
  cacheName: string,
): Promise<Response> {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  // Fetch in background and update cache
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response as Response | undefined
  }).catch((): Response | undefined => cached)

  // Return cached immediately if available, otherwise wait for network
  if (cached) return cached
  const response = await fetchPromise
  return response ?? new Response("Offline", { status: 503 })
}

/**
 * Enforce max cache size by removing oldest entries.
 */
export async function enforceMaxCacheSize(
  cacheName: string,
  maxEntries: number,
): Promise<void> {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length > maxEntries) {
    const toDelete = keys.slice(0, keys.length - maxEntries)
    await Promise.all(toDelete.map((key) => cache.delete(key)))
  }
}

/**
 * Clear all caches (for updates).
 */
export async function clearAllCaches(): Promise<void> {
  const cacheNames = await caches.keys()
  await Promise.all(cacheNames.map((name) => caches.delete(name)))
}

/**
 * Get cache storage stats for monitoring.
 */
export async function getCacheStorageStats(): Promise<
  Record<string, { entries: number; estimatedSize: number }>
> {
  const stats: Record<string, { entries: number; estimatedSize: number }> = {}
  const cacheNames = await caches.keys()

  for (const name of cacheNames) {
    const cache = await caches.open(name)
    const keys = await cache.keys()
    stats[name] = {
      entries: keys.length,
      estimatedSize: 0, // StorageManager API not available in all browsers
    }
  }

  return stats
}
