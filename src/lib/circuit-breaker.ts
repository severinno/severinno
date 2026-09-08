/**
 * circuit-breaker.ts
 *
 * Reusable circuit breaker pattern for external API calls.
 *
 * Prevents cascading timeouts when an external service (Nominatim, ViaCEP,
 * OSRM) is down. Instead of waiting 5s for every request that will fail,
 * the circuit opens after N consecutive failures and fast-fails for a
 * configurable cooldown period.
 *
 * States:
 *   CLOSED  — normal operation, requests go through
 *   OPEN    — too many failures, requests are rejected immediately
 *   HALF_OPEN — cooldown expired, one test request goes through
 *
 * Usage:
 *   const breaker = createCircuitBreaker("nominatim", { failureThreshold: 3, cooldownMs: 60_000 })
 *   const result = await breaker.execute(() => fetch(url))
 */

import logger from "./logger"

// ---------------------------------------------------------------------------

export type CircuitState = "closed" | "open" | "half-open"

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 3 */
  failureThreshold?: number
  /** Time in ms to stay open before trying half-open. Default: 60s */
  cooldownMs?: number
  /** Time in ms to wait for the half-open test request. Default: 10s */
  testTimeoutMs?: number
  /** When true, circuit breaker is bypassed — all requests go through directly. */
  disabled?: boolean
}

export interface CircuitBreakerStats {
  name: string
  state: CircuitState
  failures: number
  successes: number
  lastFailureAt: string | null
  openedAt: string | null
  /** Transition counters for observability */
  transitions: {
    openCount: number
    halfOpenSuccessCount: number
    halfOpenFailCount: number
  }
  /** Percentage of time spent in CLOSED state since creation */
  uptimePercent: number
}

// ---------------------------------------------------------------------------

export function createCircuitBreaker(name: string, opts: CircuitBreakerOptions = {}) {
  const failureThreshold = opts.failureThreshold ?? 3
  const cooldownMs = opts.cooldownMs ?? 60_000
  const _testTimeoutMs = opts.testTimeoutMs ?? 10_000
  const disabled = opts.disabled ?? false

  let state: CircuitState = "closed"
  let failures = 0
  let successes = 0
  let lastFailureAt: number | null = null
  let openedAt: number | null = null

  // Transition counters for observability
  let openCount = 0
  let halfOpenSuccessCount = 0
  let halfOpenFailCount = 0
  const createdAt = Date.now()
  let totalOpenMs = 0
  let lastOpenedAt: number | null = null

  function isOpen(): boolean {
    if (state !== "open") return false
    if (Date.now() - (openedAt ?? 0) >= cooldownMs) {
      state = "half-open"
      logger.debug({ name }, "circuit-breaker: transitioning to half-open")
      return false
    }
    return true
  }

  async function execute<T>(fn: () => Promise<T>): Promise<T> {
    if (disabled) return fn() // bypass: pass through directly
    if (isOpen()) {
      throw new CircuitOpenError(name, cooldownMs)
    }

    try {
      const result = await fn()
      // Success
      if (state === "half-open") {
        state = "closed"
        halfOpenSuccessCount++
        if (lastOpenedAt) {
          totalOpenMs += Date.now() - lastOpenedAt
          lastOpenedAt = null
        }
        logger.info({ name }, "circuit-breaker: recovered to closed")
      }
      failures = 0
      successes++
      return result
    } catch (err) {
      failures++
      lastFailureAt = Date.now()

      if (failures >= failureThreshold && state === "closed") {
        state = "open"
        openedAt = Date.now()
        openCount++
        lastOpenedAt = Date.now()
        logger.warn(
          { name, failures, cooldownMs },
          "circuit-breaker: opened after consecutive failures",
        )
      } else if (state === "half-open") {
        state = "open"
        openedAt = Date.now()
        halfOpenFailCount++
        lastOpenedAt = Date.now()
        logger.warn(
          { name, failures, cooldownMs },
          "circuit-breaker: half-open test failed, reopening",
        )
      }

      throw err
    }
  }

  function getStats(): CircuitBreakerStats {
    const currentOpenMs = state !== "closed" && lastOpenedAt ? Date.now() - lastOpenedAt : 0
    const totalElapsed = Date.now() - createdAt
    const openMs = totalOpenMs + currentOpenMs
    const uptimePercent = totalElapsed > 0 ? +((1 - openMs / totalElapsed) * 100).toFixed(1) : 100

    return {
      name,
      state,
      failures,
      successes,
      lastFailureAt: lastFailureAt ? new Date(lastFailureAt).toISOString() : null,
      openedAt: openedAt ? new Date(openedAt).toISOString() : null,
      transitions: { openCount, halfOpenSuccessCount, halfOpenFailCount },
      uptimePercent,
    }
  }

  function reset(): void {
    state = "closed"
    failures = 0
    openedAt = null
  }

  return { execute, getStats, reset }
}

// ---------------------------------------------------------------------------

export class CircuitOpenError extends Error {
  public readonly circuitName: string
  public readonly cooldownMs: number

  constructor(name: string, cooldownMs: number) {
    super(`Circuit "${name}" is open — retry after ${cooldownMs}ms`)
    this.name = "CircuitOpenError"
    this.circuitName = name
    this.cooldownMs = cooldownMs
  }
}
