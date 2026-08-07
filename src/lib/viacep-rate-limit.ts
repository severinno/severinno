/**
 * Shared in-memory rate limiter for ViaCEP API calls.
 *
 * ViaCEP is more permissive than Nominatim: up to 60 requests per minute,
 * with bursts allowed inside the window (sliding window), vs Nominatim's
 * strict 1 req/s spacing (see nominatim-rate-limit.ts).
 *
 * Previously ALL external geo calls (ViaCEP + Nominatim) shared the single
 * Nominatim limiter inside withCachedGeo — a burst of CEP lookups would
 * delay Nominatim searches and vice versa, and ViaCEP was throttled to
 * 1 req/s even though it tolerates ~60 req/min. This module gives ViaCEP
 * its own budget so the two providers never throttle each other.
 *
 * @see https://viacep.com.br/
 */

/** Sliding window: 60 seconds. */
export const VIACEP_WINDOW_MS = 60_000

/** Maximum requests allowed inside the window (60 req/min). */
export const VIACEP_MAX_PER_WINDOW = 60

/** Timestamps (ms) of the requests in the current window. */
let timestamps: number[] = []

/**
 * Wait if necessary so that at most `VIACEP_MAX_PER_WINDOW` requests were
 * made in the last `VIACEP_WINDOW_MS`, then call `fn` and return its result.
 *
 * Bursts up to 60 requests are allowed; the 61st waits until the oldest
 * timestamp falls out of the window.
 *
 * NOTE: like the Nominatim limiter, the guarantee is for SEQUENTIAL callers
 * — N callers waiting in parallel can all pass together when a slot frees
 * (the budget re-fills in bulk). Not a hard 60/min under concurrency.
 *
 * @example
 *   const result = await rateLimitedViaCEP(() => geocodeCEP(cep))
 */
export async function rateLimitedViaCEP<T>(fn: () => Promise<T>): Promise<T> {
  while (true) {
    const now = Date.now()
    timestamps = timestamps.filter((t) => now - t < VIACEP_WINDOW_MS)
    if (timestamps.length < VIACEP_MAX_PER_WINDOW) {
      timestamps.push(now)
      return fn()
    }
    // Budget exhausted — wait until the oldest request leaves the window.
    const oldest = timestamps[0]!
    await new Promise<void>((r) => setTimeout(r, oldest + VIACEP_WINDOW_MS - now))
  }
}

/**
 * Reset the rate limiter state (useful in tests).
 */
export function resetViaCEPRateLimit(): void {
  timestamps = []
}
