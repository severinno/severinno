/**
 * external-circuit-breakers.ts
 *
 * Circuit breaker instances for non-geo external services.
 * Protects against cascading failures when third-party services go down.
 *
 * Usage:
 *   import { evolutionBreaker } from "./external-circuit-breakers"
 *   const result = await evolutionBreaker.execute(() => fetch(url))
 */

import { createCircuitBreaker } from "./circuit-breaker"

// ---------------------------------------------------------------------------
// Evolution API (WhatsApp integration)
// ---------------------------------------------------------------------------

/**
 * Protects Evolution API calls (message sending, webhook processing).
 *
 * When Evolution API becomes unreachable, the breaker opens after 3 failures
 * and fast-fails instantly — messages are queued for retry instead of blocking
 * the webhook handler.
 */
export const evolutionBreaker = createCircuitBreaker("evolution", {
  failureThreshold: 3,
  cooldownMs: 60_000,
})

// ---------------------------------------------------------------------------
// Push Notification Service (Expo / FCM)
// ---------------------------------------------------------------------------

/**
 * Protects push notification sends.
 *
 * When the push service is down, notifications are silently dropped
 * (fire-and-forget) — the breaker just prevents hanging on timeouts.
 */
export const pushBreaker = createCircuitBreaker("push", {
  failureThreshold: 5, // more tolerant — push is best-effort
  cooldownMs: 120_000,
})

// ---------------------------------------------------------------------------
// Email Service (SMTP / Resend / SendGrid)
// ---------------------------------------------------------------------------

/**
 * Protects email sends.
 *
 * When the email service is down, transactional emails fail gracefully
 * (password reset, booking confirmation) — the user gets an in-app
 * notification as fallback.
 */
export const emailBreaker = createCircuitBreaker("email", {
  failureThreshold: 5,
  cooldownMs: 120_000,
})

// ---------------------------------------------------------------------------
// Lytex Payment Gateway
// ---------------------------------------------------------------------------

/**
 * Protects Lytex payment API calls (charge creation, refund processing).
 *
 * When Lytex is down, the webhook handler still processes events (the
 * breaker only protects outgoing calls). Payments are queued for retry.
 */
export const lytexBreaker = createCircuitBreaker("lytex", {
  failureThreshold: 3,
  cooldownMs: 60_000,
})
