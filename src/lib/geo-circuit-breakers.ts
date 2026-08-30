/**
 * geo-circuit-breakers.ts
 *
 * Pre-configured circuit breaker instances for external geo APIs.
 *
 * When an API is down (e.g. Nominatim returning 503), instead of every
 * request waiting 5s for a timeout, the circuit breaker opens after
 * 3 consecutive failures and fast-fails instantly for 60s.
 *
 * After the cooldown, a single test request probes the service. If it
 * succeeds, the circuit closes and normal operation resumes.
 *
 * All geo functions already have graceful fallbacks (local DB providers),
 * so the circuit breaker just makes those fallbacks trigger faster.
 */

import { createCircuitBreaker } from "./circuit-breaker"
import { isEnabled } from "./feature-flags"

// ---------------------------------------------------------------------------
// Nominatim (forward + reverse geocoding)
// ---------------------------------------------------------------------------

/**
 * Protects Nominatim API calls.
 *
 * Nominatim has a strict 1 req/s rate limit. When it starts returning
 * 429/503, the breaker opens after 3 failures and skips the 5s timeout
 * on every subsequent request — falling through to local DB instantly.
 */
export const nominatimBreaker = createCircuitBreaker("nominatim", {
  failureThreshold: 3,
  cooldownMs: 60_000,
  disabled: !isEnabled("circuit-breaker-nominatim"),
})

// ---------------------------------------------------------------------------
// ViaCEP (CEP lookup)
// ---------------------------------------------------------------------------

/**
 * Protects ViaCEP API calls.
 *
 * ViaCEP is a free third-party service. When it goes down, the breaker
 * opens after 3 failures and falls through to the local DB CEP search
 * without waiting for the 5s timeout.
 */
export const viacepBreaker = createCircuitBreaker("viacep", {
  failureThreshold: 3,
  cooldownMs: 60_000,
  disabled: !isEnabled("circuit-breaker-viacep"),
})

// ---------------------------------------------------------------------------
// OSRM (routing + distance matrix)
// ---------------------------------------------------------------------------

/**
 * Protects OSRM routing API calls.
 *
 * OSRM is either self-hosted or the public router. When it becomes
 * unreachable, the breaker opens and the urban-coefficient fallback
 * kicks in instantly (haversine × 1.35).
 */
export const osrmBreaker = createCircuitBreaker("osrm", {
  failureThreshold: 3,
  cooldownMs: 30_000,
  disabled: !isEnabled("circuit-breaker-osrm"),
})

/**
 * Protects OSRM Table API (distance matrix).
 *
 * Same as osrmBreaker but separate instance — the Table endpoint
 * may have different availability than the Route endpoint.
 */
export const osrmTableBreaker = createCircuitBreaker("osrm-table", {
  failureThreshold: 3,
  cooldownMs: 30_000,
  disabled: !isEnabled("circuit-breaker-osrm"),
})
