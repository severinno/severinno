/**
 * Shared fetch-timeout helpers.
 *
 * Eliminates the duplicated `Math.max(1, Number(env) || default)` guard +
 * `AbortSignal.timeout()` pattern that was copy-pasted across HTTP clients
 * (lytex, evolution, realtime-client, sentry tunnel, alert webhooks, admin
 * gateway routes).
 *
 * Why the guard: an upstream service that accepts TCP but never responds
 * would leave the fetch pending forever (hanging the calling flow — booking
 * creation, logout, alert dispatch). `AbortSignal.timeout()` aborts after the
 * deadline (rejects with TimeoutError). Invalid env values are guarded:
 * missing/empty/NaN → fallback; 0/negative → clamped to 1ms (a 0ms timeout
 * would abort immediately, a negative one throws).
 */

/**
 * Resolve a timeout in milliseconds from an env var, guarding against
 * invalid values:
 *   - missing/empty/non-numeric (NaN) → `fallbackMs`
 *   - "0" (falsy) → `fallbackMs`
 *   - negative → clamped to 1
 * Mirrors the previous inline `Math.max(1, Number(env) || default)`.
 */
export function resolveTimeoutMs(envName: string, fallbackMs: number): number {
  return Math.max(1, Number(process.env[envName]) || fallbackMs)
}

/**
 * `AbortSignal.timeout()` with a timeout resolved from env (same guard as
 * `resolveTimeoutMs`). Convenience wrapper for fetch calls:
 *
 *   signal: envTimeoutSignal("LYTEX_TIMEOUT_MS", 10_000)
 */
export function envTimeoutSignal(envName: string, fallbackMs: number): AbortSignal {
  return AbortSignal.timeout(resolveTimeoutMs(envName, fallbackMs))
}
