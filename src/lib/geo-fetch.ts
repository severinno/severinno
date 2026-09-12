/**
 * Geo-specific fetch with retry + exponential backoff.
 *
 * External geo APIs (Nominatim, ViaCEP) occasionally return transient 5xx errors
 * or connection timeouts. This wrapper retries once on transient failures before
 * giving up — preventing unnecessary fallback to local DB for a single hiccup.
 *
 * Retry policy:
 *   - Max 1 retry (total 2 attempts)
 *   - Only on: 5xx, ECONNRESET, ETIMEDOUT, network errors
 *   - NOT on: 4xx (client errors), parse errors, AbortError (timeout)
 *   - Backoff: exponential (1s, 2s) + random jitter (0-500ms)
 */
import logger from "./logger"

interface GeoFetchOptions extends RequestInit {
  /** Timeout per attempt in ms (default: 5000) */
  timeoutMs?: number
  /** Max retries on transient failure (default: 1) */
  maxRetries?: number
  /** Label for logging */
  label?: string
}

/** Whether an error is transient and worth retrying */
function isTransientError(error: Error): boolean {
  const msg = error.message.toLowerCase()
  // Network-level errors
  if (msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("econnrefused"))
    return true
  if (msg.includes("socket hang up") || msg.includes("network")) return true
  // AbortError = timeout — don't retry (circuit breaker handles this)
  if (error.name === "AbortError") return false
  return false
}

/** Whether an HTTP status is transient (retryable) */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

/**
 * Fetch with retry for geo API calls.
 *
 * @returns Response on success
 * @throws Error on final failure (after retries exhausted)
 */
export async function geoFetchWithRetry(
  url: string | URL,
  options: GeoFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 5_000, maxRetries = 1, label = "geo-fetch", ...fetchOptions } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      })
      clearTimeout(timer)

      // Check for retryable HTTP errors
      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        logger.warn(
          { label, url: String(url), status: response.status, attempt },
          `[geo-fetch] ${label} retryable status ${response.status}, attempt ${attempt + 1}/${maxRetries + 1}`,
        )
        // Respect Retry-After header if present (Nominatim sends it on 429)
        const retryAfter = response.headers.get("Retry-After")
        const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 0
        const jitter = Math.random() * 500
        const backoffMs = Math.max(retryAfterMs, 1000 * Math.pow(2, attempt) + jitter)
        await new Promise((r) => setTimeout(r, backoffMs))
        continue
      }

      return response
    } catch (error) {
      clearTimeout(timer)
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry AbortError (timeout) — let circuit breaker handle it
      if (lastError.name === "AbortError") {
        throw lastError
      }

      // Retry on transient errors
      if (isTransientError(lastError) && attempt < maxRetries) {
        logger.warn(
          { label, url: String(url), error: lastError.message, attempt },
          `[geo-fetch] ${label} transient error, retrying in 1s`,
        )
        const jitter = Math.random() * 500
        const backoffMs = 1000 * Math.pow(2, attempt) + jitter
        await new Promise((r) => setTimeout(r, backoffMs))
        continue
      }
    }
  }

  throw lastError || new Error(`geoFetchWithRetry failed: ${label}`)
}
