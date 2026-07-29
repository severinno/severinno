/**
 * client-cep-cache.ts
 *
 * Client-side cache for ViaCEP results with:
 *   - localStorage persistence (survives page refreshes and tab switches)
 *   - 7-day TTL (CEP data rarely changes)
 *   - BroadcastChannel sync (if tab A fetches a CEP, tab B gets it instantly)
 *
 * Usage:
 *   import { getCachedCep, setCachedCep, subscribeCepUpdates } from "@/lib/client-cep-cache"
 *
 *   // Before calling the API
 *   const cached = getCachedCep("01310100")
 *   if (cached) return cached
 *
 *   // After successful API call
 *   setCachedCep("01310100", result)
 *
 *   // Listen for updates from other tabs
 *   const unsub = subscribeCepUpdates(({ cep, data }) => { ... })
 *   unsub() // cleanup
 */

import type { CepResult } from "@/lib/api"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 7 days in milliseconds */
const CEP_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** localStorage key prefix */
const STORAGE_PREFIX = "severinno:cep:"

/** BroadcastChannel name for cross-tab CEP sync */
const CHANNEL_NAME = "severinno:cep-cache"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CepCacheEntry = {
  data: CepResult
  cachedAt: number // timestamp when cached (ms)
}

export type CepUpdateEvent = {
  cep: string
  data: CepResult
  cachedAt: number
}

// ---------------------------------------------------------------------------
// Singleton helpers
// ---------------------------------------------------------------------------

/** Format a CEP cleanly for use as a key (8 digits, no mask). */
function cleanCep(cep: string): string {
  return cep.replace(/\D/g, "")
}

/** Build the localStorage key for a given CEP. */
function storageKey(cep: string): string {
  return `${STORAGE_PREFIX}${cep}`
}

/** Check if a cache entry is still within the 7-day TTL. */
function isFresh(entry: CepCacheEntry): boolean {
  return Date.now() - entry.cachedAt < CEP_TTL_MS
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
 * Subscribe to CEP cache updates from other tabs.
 * Returns an unsubscribe function.
 *
 * @example
 *   React.useEffect(() => {
 *     return subscribeCepUpdates(({ cep, data }) => {
 *       // Update local state when another tab caches a CEP
 *       if (!getCachedCep(cep)) {
 *         setCachedCep(cep, data, true) // silent — no broadcast loop
 *       }
 *     })
 *   }, [])
 */
export function subscribeCepUpdates(callback: (event: CepUpdateEvent) => void): () => void {
  const channel = getChannel()
  if (!channel) return () => {}

  const handler = (ev: MessageEvent) => {
    const payload = ev.data as CepUpdateEvent
    if (payload && payload.cep && payload.data) {
      callback(payload)
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

/** Broadcast a CEP cache update to other tabs. */
function broadcast(cep: string, data: CepResult, cachedAt: number): void {
  const channel = getChannel()
  if (!channel) return
  try {
    channel.postMessage({ cep, data, cachedAt } satisfies CepUpdateEvent)
  } catch {
    // Channel closed or payload too large — ignore
  }
}

// ---------------------------------------------------------------------------
// Core cache operations
// ---------------------------------------------------------------------------

/**
 * Get a cached CEP result from localStorage.
 * Returns null if not cached or expired (7-day TTL).
 *
 * @param cep - Raw CEP (with or without mask: "01310-100" or "01310100")
 */
export function getCachedCep(cep: string): CepResult | null {
  try {
    const raw = localStorage.getItem(storageKey(cleanCep(cep)))
    if (!raw) return null

    const entry = JSON.parse(raw) as CepCacheEntry
    if (!entry.data || !entry.cachedAt) {
      localStorage.removeItem(storageKey(cleanCep(cep)))
      return null
    }

    if (!isFresh(entry)) {
      localStorage.removeItem(storageKey(cleanCep(cep)))
      return null
    }

    return entry.data
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded)
    return null
  }
}

/**
 * Store a CEP result in localStorage and broadcast to other tabs.
 *
 * @param cep    - Raw CEP (with or without mask)
 * @param data   - ViaCEP result to cache
 * @param silent - If true, skip BroadcastChannel broadcast (used when receiving from another tab)
 */
export function setCachedCep(cep: string, data: CepResult, silent = false): void {
  const cachedAt = Date.now()
  const entry: CepCacheEntry = { data, cachedAt }
  const key = storageKey(cleanCep(cep))

  try {
    localStorage.setItem(key, JSON.stringify(entry))
  } catch {
    // localStorage quota exceeded or unavailable — silently fail
    return
  }

  if (!silent) {
    broadcast(cleanCep(cep), data, cachedAt)
  }
}

/**
 * Remove a specific CEP from the cache.
 * Useful for forcing a fresh fetch on the next request.
 */
export function removeCachedCep(cep: string): void {
  try {
    localStorage.removeItem(storageKey(cleanCep(cep)))
  } catch {
    // ignore
  }
}

/**
 * Clear all cached CEP entries from localStorage.
 * Useful for testing or user logout.
 */
export function clearCepCache(): void {
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX)) {
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
 * Get diagnostics about the current CEP cache state.
 * Useful for debugging or an admin panel.
 */
export function getCepCacheDiagnostics(): {
  enabled: boolean
  entryCount: number
  oldestEntryAgeMs: number | null
  ttlMs: number
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
            const entry = JSON.parse(raw) as CepCacheEntry
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
    ttlMs: CEP_TTL_MS,
  }
}

export { CEP_TTL_MS }
