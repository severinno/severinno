/**
 * Shared in-memory rate limiter for Nominatim (OpenStreetMap) API calls.
 *
 * Nominatim's usage policy requires at most **1 request per second**.
 * Both `/api/geo/search` and `/api/geo/reverse` call Nominatim, and
 * previously each had its own isolated `lastNominatimRequest` variable,
 * which meant they could collectively send 2 req/s — violating the policy.
 *
 * This module uses a single module-level timestamp so all Nominatim calls
 * from the same Node.js process share one queue.
 *
 * @see https://operations.osmfoundation.org/policies/nominatim/
 */

let lastNominatimRequest = 0

/**
 * Wait if necessary so that at least 1000 ms have elapsed since the last
 * Nominatim request, then call `fn` and return its result.
 *
 * @example
 *   const results = await rateLimitedNominatim(() => geocodeSearch(q, limit))
 */
export async function rateLimitedNominatim<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const elapsed = now - lastNominatimRequest
  if (elapsed < 1000) {
    await new Promise<void>((r) => setTimeout(r, 1000 - elapsed))
  }
  lastNominatimRequest = Date.now()
  return fn()
}

/**
 * Reset the rate limiter state (useful in tests).
 */
export function resetNominatimRateLimit(): void {
  lastNominatimRequest = 0
}
