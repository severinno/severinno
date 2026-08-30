/**
 * stale-while-revalidate.ts
 *
 * Implements the Stale-While-Revalidate (SWR) caching pattern.
 *
 * Strategy:
 *   1. Return cached data immediately (even if stale) for instant response
 *   2. Trigger a background revalidation if the data is stale
 *   3. Next request gets the fresh data
 *
 * This gives users instant responses (perceived 0ms) while keeping data
 * fresh via async background updates.
 *
 * Cache entry structure:
 *   { data: T, timestamp: number }
 *   - data: the cached value
 *   - timestamp: when the data was last fetched
 */

import { cacheGet, cacheSet } from "@/lib/redis"
import logger from "./logger"

export interface SWROptions {
  /** Maximum age in seconds before data is considered stale */
  maxAge: number
  /** Maximum time in seconds before forcing revalidation (even if fresh) */
  maxStaleAge?: number
}

interface CacheEntry<T> {
  data: T
  timestamp: number
}

/**
 * Cache-aside with Stale-While-Revalidate.
 *
 * Returns cached data immediately if available (even if stale).
 * Triggers background revalidation when data is stale.
 *
 * @param key - Cache key
 * @param fn  - Factory function to produce fresh data
 * @param opts - SWR options (maxAge, maxStaleAge)
 * @returns The cached or freshly computed data
 *
 * @example
 * ```ts
 * const providers = await withSWR(
 *   `providers:${lat}:${lng}:${radius}`,
 *   () => fetchProvidersFromDB(lat, lng, radius),
 *   { maxAge: 60, maxStaleAge: 300 },
 * )
 * ```
 */
export async function withSWR<T>(key: string, fn: () => Promise<T>, opts: SWROptions): Promise<T> {
  const { maxAge, maxStaleAge = maxAge * 5 } = opts
  const now = Date.now()

  // Try to get cached entry
  const cached = await cacheGet<CacheEntry<T>>(key)

  if (cached) {
    const ageSeconds = (now - cached.timestamp) / 1000

    // Data is fresh — return it
    if (ageSeconds < maxAge) {
      return cached.data
    }

    // Data is stale but within maxStaleAge — return stale + revalidate in background
    if (ageSeconds < maxStaleAge) {
      // Fire-and-forget background revalidation
      revalidateInBackground(key, fn, maxAge).catch(() => {})
      return cached.data
    }

    // Data is too old — fetch fresh (blocking)
    const freshData = await fn()
    await cacheSet(key, { data: freshData, timestamp: now } satisfies CacheEntry<T>, maxStaleAge)
    return freshData
  }

  // No cache — fetch fresh (blocking)
  const freshData = await fn()
  await cacheSet(key, { data: freshData, timestamp: now } satisfies CacheEntry<T>, maxStaleAge)
  return freshData
}

/**
 * Background revalidation — non-blocking, best-effort.
 *
 * Fetches fresh data and updates the cache without blocking the response.
 * Errors are logged but never thrown (fire-and-forget).
 */
async function revalidateInBackground<T>(
  key: string,
  fn: () => Promise<T>,
  maxAge: number,
): Promise<void> {
  try {
    const freshData = await fn()
    const now = Date.now()
    await cacheSet(key, { data: freshData, timestamp: now } satisfies CacheEntry<T>, maxAge * 5)
  } catch (err) {
    // Non-critical — log and continue
    logger.warn({ err, key }, "[swr] Background revalidation failed")
  }
}
