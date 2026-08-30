/**
 * Safe Fetch — fetch wrapper with AbortController timeout.
 *
 * Prevents requests from hanging indefinitely when external services
 * (Nominatim, ViaCEP, OSRM, Evolution, etc.) are slow or unresponsive.
 *
 * Usage:
 *   import { safeFetch } from "@/lib/safe-fetch"
 *   const response = await safeFetch(url, { timeoutMs: 10_000 })
 */
import logger from "./logger"

export interface SafeFetchOptions extends RequestInit {
  /** Timeout in milliseconds (default: 10s) */
  timeoutMs?: number
  /** Label for logging (e.g. "nominatim", "viacep") */
  label?: string
  /** Max retries (default: 0 — no retry) */
  retries?: number
  /** Base delay between retries in ms (default: 1000) */
  retryDelayMs?: number
}

/**
 * Fetch with automatic timeout via AbortController.
 *
 * If the request doesn't complete within `timeoutMs`, it aborts and
 * throws a TimeoutError. Circuit breakers upstream can catch this.
 */
export async function safeFetch(
  url: string | URL,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 10_000,
    label = "fetch",
    retries = 0,
    retryDelayMs = 1_000,
    ...fetchOptions
  } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      })
      clearTimeout(timer)

      // Log slow requests for long timeouts
      if (timeoutMs >= 5_000) {
        logger.debug(
          { label, url: String(url), status: response.status, attempt },
          `[safe-fetch] ${label} completed`,
        )
      }

      return response
    } catch (error) {
      clearTimeout(timer)
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry on abort (timeout) — circuit breaker handles this
      if (lastError.name === "AbortError") {
        logger.warn(
          { label, url: String(url), timeoutMs, attempt },
          `[safe-fetch] ${label} timed out after ${timeoutMs}ms`,
        )
        break
      }

      // Don't retry on non-network errors
      if (attempt < retries) {
        const delay = retryDelayMs * Math.pow(2, attempt)
        logger.debug(
          { label, url: String(url), attempt, delay, error: lastError.message },
          `[safe-fetch] ${label} retrying in ${delay}ms`,
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }
    }
  }

  throw lastError || new Error(`safeFetch failed: ${label}`)
}

/**
 * Quick helper for JSON APIs with timeout.
 * Returns parsed JSON or throws.
 */
export async function safeFetchJson<T = unknown>(
  url: string | URL,
  options: SafeFetchOptions = {},
): Promise<T> {
  const response = await safeFetch(url, options)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  return response.json() as Promise<T>
}
