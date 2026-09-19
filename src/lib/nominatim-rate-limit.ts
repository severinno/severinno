/**
 * Shared in-memory rate limiter for Nominatim (OpenStreetMap) API calls.
 *
 * Nominatim's usage policy requires at most **1 request per second**.
 * Both `/api/geo/search` and `/api/geo/reverse` call Nominatim, and
 * previously each had its own isolated `lastNominatimRequest` variable,
 * which meant they could collectively send 2 req/s — violating the policy.
 *
 * This module uses a FIFO queue with serial processing so that even under
 * burst traffic (e.g. 50 concurrent requests), each Nominatim call is
 * spaced ≥1000ms apart. Requests wait in the queue instead of all sleeping
 * and then firing simultaneously (thundering herd).
 *
 * @see https://operations.osmfoundation.org/policies/nominatim/
 */

let lastNominatimRequest = 0
const queue: Array<{ resolve: () => void }> = []
let processing = false

/**
 * Process queued requests one at a time, ensuring ≥1000ms between each
 * Nominatim API call. Runs until the queue is empty, then stops.
 */
async function processQueue(): Promise<void> {
  if (processing) return
  processing = true

  while (queue.length > 0) {
    const elapsed = Date.now() - lastNominatimRequest
    if (elapsed < 1000) {
      await new Promise<void>((r) => setTimeout(r, 1000 - elapsed))
    }
    lastNominatimRequest = Date.now()
    const item = queue.shift()
    item?.resolve()
  }

  processing = false
}

/**
 * Wait if necessary so that at least 1000 ms have elapsed since the last
 * Nominatim request, then call `fn` and return its result.
 *
 * Under burst traffic, requests are queued and processed serially (FIFO),
 * guaranteeing exactly 1 req/s to Nominatim regardless of concurrency.
 *
 * @example
 *   const results = await rateLimitedNominatim(() => geocodeSearch(q, limit))
 */
export async function rateLimitedNominatim<T>(fn: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => {
    queue.push({ resolve })
    processQueue()
  })
  try {
    return await fn()
  } finally {
    // Ensure queue progresses even if fn() throws
  }
}

/**
 * Reset the rate limiter state (useful in tests).
 */
export function resetNominatimRateLimit(): void {
  lastNominatimRequest = 0
  queue.length = 0
  processing = false
}
