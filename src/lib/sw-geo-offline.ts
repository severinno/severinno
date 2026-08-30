/**
 * Offline Geocoding Cache — for Service Worker.
 *
 * Caches recent geocoding results so the app can serve address lookups
 * even when the user is offline (common in areas with weak signal).
 *
 * Strategy:
 *   - Every geocode result is cached in IndexedDB with the query as key
 *   - On offline, serves from cache with a "offline" flag
 *   - Max 500 cached entries (LRU eviction)
 *   - TTL: 7 days (addresses don't change often)
 *
 * Usage in service worker:
 *   import { cacheGeoResult, getOfflineGeo } from "./sw-geo-offline"
 *
 *   // On successful geocode:
 *   await cacheGeoResult("Rua Augusta, São Paulo", { lat: -23.55, lng: -46.63 })
 *
 *   // On offline:
 *   const cached = await getOfflineGeo("Rua Augusta, São Paulo")
 *   if (cached) return cached // { lat, lng, offline: true }
 */

const DB_NAME = "severinno-geo-cache"
const DB_VERSION = 1
const STORE_NAME = "geocoding"
const MAX_ENTRIES = 500
const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

interface GeoCacheEntry {
  query: string
  lat: number
  lng: number
  displayName?: string
  cachedAt: number
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "query" })
        store.createIndex("cachedAt", "cachedAt", { unique: false })
      }
    }
  })
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Cache a geocoding result for offline use.
 */
export async function cacheGeoResult(
  query: string,
  data: { lat: number; lng: number; displayName?: string },
): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)

    const entry: GeoCacheEntry = {
      query: query.trim().toLowerCase(),
      lat: data.lat,
      lng: data.lng,
      displayName: data.displayName,
      cachedAt: Date.now(),
    }

    store.put(entry)

    // LRU eviction: remove oldest entries if over limit
    const countReq = store.count()
    countReq.onsuccess = () => {
      if (countReq.result > MAX_ENTRIES) {
        const index = store.index("cachedAt")
        const cursor = index.openCursor()
        let toDelete = countReq.result - MAX_ENTRIES
        cursor.onsuccess = (e) => {
          const c = (e.target as IDBRequest<IDBCursorWithValue>).result
          if (c && toDelete > 0) {
            c.delete()
            toDelete--
            c.continue()
          }
        }
      }
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // IndexedDB unavailable — silently fail
  }
}

/**
 * Get a cached geocoding result (for offline use).
 * Returns null if not cached or expired.
 */
export async function getOfflineGeo(
  query: string,
): Promise<{ lat: number; lng: number; displayName?: string; offline: boolean } | null> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)

    const normalizedQuery = query.trim().toLowerCase()

    return new Promise((resolve) => {
      const req = store.get(normalizedQuery)
      req.onsuccess = () => {
        const entry = req.result as GeoCacheEntry | undefined
        if (!entry) {
          resolve(null)
          return
        }

        // Check TTL
        if (Date.now() - entry.cachedAt > TTL_MS) {
          resolve(null)
          return
        }

        resolve({
          lat: entry.lat,
          lng: entry.lng,
          displayName: entry.displayName,
          offline: true,
        })
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/**
 * Get cache stats for monitoring.
 */
export async function getOfflineGeoStats(): Promise<{
  entries: number
  oldestEntry: number | null
  newestEntry: number | null
}> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)

    return new Promise((resolve) => {
      const countReq = store.count()
      countReq.onsuccess = () => {
        const index = store.index("cachedAt")
        const firstReq = index.openCursor()
        const lastReq = index.openCursor(null, "prev")

      let oldest: number | null = null
      let newest: number | null = null

      firstReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) oldest = (cursor.value as GeoCacheEntry).cachedAt
      }

      lastReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) newest = (cursor.value as GeoCacheEntry).cachedAt
      }

      countReq.onsuccess = () => {
        // Wait a tick for the cursor requests
        setTimeout(() => {
          resolve({
            entries: countReq.result,
            oldestEntry: oldest,
            newestEntry: newest,
          })
        }, 50)
      }
      }
    })
  } catch {
    return { entries: 0, oldestEntry: null, newestEntry: null }
  }
}

/**
 * Clear all cached geocoding data.
 */
export async function clearOfflineGeoCache(): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).clear()
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // Best-effort
  }
}
