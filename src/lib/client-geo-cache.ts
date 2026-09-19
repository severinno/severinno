/**
 * client-geo-cache.ts
 *
 * Client-side cache for Nominatim geocoding results with:
 *   - localStorage persistence (survives page refreshes and tab switches)
 *   - 1-hour TTL (address/search data changes more often than CEP)
 *   - Max 100 entries with FIFO eviction (prevents unbounded localStorage growth)
 *   - BroadcastChannel sync (if tab A searches "São Paulo, SP", tab B gets it instantly)
 *
 * Usage:
 *   import { getCachedGeo, setCachedGeo, subscribeGeoUpdates } from "@/lib/client-geo-cache"
 *
 *   // Before calling the API
 *   const cached = getCachedGeo("são paulo, sp")
 *   if (cached) return cached
 *
 *   // After successful API call
 *   setCachedGeo("são paulo, sp", results)
 *
 *   // Listen for updates from other tabs
 *   const unsub = subscribeGeoUpdates(({ query, results }) => { ... })
 *   unsub() // cleanup
 */

import type { GeoSearchResult } from "@/lib/api"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 1 hour in milliseconds */
const GEO_TTL_MS = 60 * 60 * 1000

/** Max cache entries — prevents unbounded localStorage growth */
const GEO_MAX_ENTRIES = 100

/** localStorage key prefix */
const STORAGE_PREFIX = "severinno:geo:"

/** Key used to store the FIFO queue order */
const QUEUE_KEY = "severinno:geo:queue"

/** BroadcastChannel name for cross-tab geo cache sync */
const CHANNEL_NAME = "severinno:geo-cache"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GeoCacheEntry = {
  query: string // normalized query (lowercase, trimmed)
  results: GeoSearchResult[]
  cachedAt: number // timestamp when cached (ms)
}

export type GeoCacheUpdateEvent = {
  query: string
  results: GeoSearchResult[]
  cachedAt: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a query string for use as a cache key. */
function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ")
}

/** Build the localStorage key for a given query. */
function storageKey(query: string): string {
  return `${STORAGE_PREFIX}${query}`
}

/** Check if a cache entry is still within the 1-hour TTL. */
function isFresh(entry: GeoCacheEntry): boolean {
  return Date.now() - entry.cachedAt < GEO_TTL_MS
}

// ---------------------------------------------------------------------------
// FIFO queue management
// ---------------------------------------------------------------------------

/** Read the current FIFO queue from localStorage. */
function readQueue(): string[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Persist the FIFO queue to localStorage. */
function writeQueue(queue: string[]): void {
  try {
    // Keep only the last GEO_MAX_ENTRIES
    const trimmed = queue.slice(-GEO_MAX_ENTRIES)
    localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed))
  } catch {
    // localStorage unavailable — silently fail
  }
}

/** Push a new query to the FIFO queue, evicting old entries if full. */
function pushToQueue(normalized: string): void {
  const queue = readQueue()
  // Remove existing occurrence (so we move it to the back)
  const filtered = queue.filter((q) => q !== normalized)
  filtered.push(normalized)

  // Evict physical localStorage entries for the oldest queries that exceed the cap
  if (filtered.length > GEO_MAX_ENTRIES) {
    const toEvict = filtered.length - GEO_MAX_ENTRIES
    const evicted = filtered.slice(0, toEvict)
    for (const q of evicted) {
      try {
        localStorage.removeItem(storageKey(q))
      } catch {
        // ignore
      }
    }
  }

  writeQueue(filtered)
}

/** Remove expired entries from storage and queue. Returns the count removed. */
function sweepExpired(): number {
  const queue = readQueue()
  const now = Date.now()
  let removed = 0

  const fresh: string[] = []
  for (const q of queue) {
    try {
      const raw = localStorage.getItem(storageKey(q))
      if (raw) {
        const entry = JSON.parse(raw) as GeoCacheEntry
        if (entry.cachedAt && now - entry.cachedAt < GEO_TTL_MS) {
          fresh.push(q)
        } else {
          localStorage.removeItem(storageKey(q))
          removed++
        }
      }
    } catch {
      localStorage.removeItem(storageKey(q))
      removed++
    }
  }

  if (removed > 0) writeQueue(fresh)
  return removed
}

let sweepScheduled = false

/**
 * Schedule an idle sweep of expired entries.
 * Uses requestIdleCallback (with setTimeout fallback) so the main thread
 * is never blocked by JSON.parse batches during user interactions.
 * Debounced: multiple triggers collapse into a single idle run.
 */
export function scheduleSweep(): void {
  if (typeof window === "undefined" || sweepScheduled) return
  sweepScheduled = true

  const run = () => {
    try {
      sweepExpired()
    } finally {
      sweepScheduled = false
    }
  }

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 5000 })
  } else {
    setTimeout(run, 2000)
  }
}

/** Evict the oldest entries if we exceed GEO_MAX_ENTRIES. */
function evictIfNeeded(): void {
  const queue = readQueue()
  if (queue.length <= GEO_MAX_ENTRIES) return

  const toRemove = queue.length - GEO_MAX_ENTRIES
  const evicted = queue.slice(0, toRemove)
  const kept = queue.slice(toRemove)

  for (const q of evicted) {
    try {
      localStorage.removeItem(storageKey(q))
    } catch {
      // ignore
    }
  }

  writeQueue(kept)
}

// ---------------------------------------------------------------------------
// BroadcastChannel (cross-tab synchronization)
// ---------------------------------------------------------------------------

let _channel: BroadcastChannel | null = null
let _channelRefCount = 0

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null
  if (!_channel) {
    try {
      _channel = new BroadcastChannel(CHANNEL_NAME)
    } catch {
      return null
    }
  }
  return _channel
}

/**
 * Subscribe to geo cache updates from other tabs.
 * Returns an unsubscribe function.
 */
export function subscribeGeoUpdates(callback: (event: GeoCacheUpdateEvent) => void): () => void {
  const channel = getChannel()
  if (!channel) return () => {}

  const handler = (ev: MessageEvent) => {
    const raw = ev.data
    if (
      raw &&
      typeof raw === "object" &&
      typeof raw.query === "string" &&
      Array.isArray(raw.results)
    ) {
      callback(raw as GeoCacheUpdateEvent)
    }
  }

  channel.addEventListener("message", handler)
  _channelRefCount++

  return () => {
    channel.removeEventListener("message", handler)
    _channelRefCount--
    if (_channelRefCount <= 0) {
      channel.close()
      _channel = null
      _channelRefCount = 0
    }
  }
}

/** Broadcast a geo cache update to other tabs. */
function broadcast(query: string, results: GeoSearchResult[], cachedAt: number): void {
  const channel = getChannel()
  if (!channel) return
  try {
    channel.postMessage({ query, results, cachedAt } satisfies GeoCacheUpdateEvent)
  } catch {
    // Channel closed or payload too large — ignore
  }
}

// ---------------------------------------------------------------------------
// Core cache operations
// ---------------------------------------------------------------------------

/**
 * Get cached geocoding results from localStorage.
 * Returns null if not cached or expired (1-hour TTL).
 *
 * @param query - Raw query string (will be normalized: trimmed, lowercased)
 */
export function getCachedGeo(query: string): GeoSearchResult[] | null {
  const normalized = normalizeQuery(query)
  if (!normalized) return null

  try {
    const raw = localStorage.getItem(storageKey(normalized))
    if (!raw) return null

    const entry = JSON.parse(raw) as GeoCacheEntry
    if (!entry.results || !entry.cachedAt) {
      localStorage.removeItem(storageKey(normalized))
      return null
    }

    if (!isFresh(entry)) {
      localStorage.removeItem(storageKey(normalized))
      // Remove from queue as well (sweep will handle this, but do it now)
      const queue = readQueue().filter((q) => q !== normalized)
      writeQueue(queue)
      return null
    }

    return entry.results
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded)
    return null
  }
}

/**
 * Store geocoding results in localStorage and broadcast to other tabs.
 *
 * @param query   - Raw query string (will be normalized)
 * @param results - GeoSearchResult[] to cache
 * @param silent  - If true, skip BroadcastChannel broadcast (used when receiving from another tab)
 */
export function setCachedGeo(query: string, results: GeoSearchResult[], silent = false): void {
  const normalized = normalizeQuery(query)
  if (!normalized || results.length === 0) return

  const cachedAt = Date.now()
  const entry: GeoCacheEntry = { query: normalized, results, cachedAt }

  try {
    localStorage.setItem(storageKey(normalized), JSON.stringify(entry))
  } catch {
    // localStorage quota exceeded or unavailable — silently fail
    return
  }

  // Track in FIFO queue
  pushToQueue(normalized)
  evictIfNeeded()
  scheduleSweep()

  if (!silent) {
    broadcast(normalized, results, cachedAt)
  }
}

/**
 * Remove a specific query from the cache.
 * Useful for forcing a fresh fetch on the next request.
 */
export function removeCachedGeo(query: string): void {
  const normalized = normalizeQuery(query)
  if (!normalized) return

  try {
    localStorage.removeItem(storageKey(normalized))
    const queue = readQueue().filter((q) => q !== normalized)
    writeQueue(queue)
  } catch {
    // ignore
  }
}

/**
 * Clear all cached geo entries from localStorage.
 * Useful for testing or user logout.
 */
export function clearGeoCache(): void {
  try {
    const keysToRemove: string[] = []
    const len = localStorage.length
    for (let i = 0; i < len; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX) || key === QUEUE_KEY) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key)
    }
  } catch {
    // ignore
  }
}

/**
 * Get diagnostics about the current geo cache state.
 * Useful for debugging or an admin panel.
 */
export function getGeoCacheDiagnostics(): {
  enabled: boolean
  entryCount: number
  oldestEntryAgeMs: number | null
  ttlMs: number
  maxEntries: number
} {
  let entryCount = 0
  let oldestEntryAgeMs: number | null = null
  const now = Date.now()

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX)) {
        entryCount++
        try {
          const raw = localStorage.getItem(key)
          if (raw) {
            const entry = JSON.parse(raw) as GeoCacheEntry
            if (entry.cachedAt) {
              const age = now - entry.cachedAt
              if (oldestEntryAgeMs === null || age > oldestEntryAgeMs) {
                oldestEntryAgeMs = age
              }
            }
          }
        } catch {
          // skip corrupt entries
        }
      }
    }
  } catch {
    // localStorage unavailable
  }

  return {
    enabled: typeof localStorage !== "undefined",
    entryCount,
    oldestEntryAgeMs,
    ttlMs: GEO_TTL_MS,
    maxEntries: GEO_MAX_ENTRIES,
  }
}

/** Perform a manual sweep of expired entries. Returns count removed. */
export function sweepGeoCache(): number {
  return sweepExpired()
}

export { GEO_TTL_MS, GEO_MAX_ENTRIES }
