import "server-only"

/**
 * PushMonitor — Sliding-window failure tracker for web-push notifications.
 *
 * Counts permanent push failures (after all retries exhausted) in a 5-minute
 * sliding window and fires a Sentry event when the threshold of 10 failures
 * is exceeded. This enables GlitchTip alert rules to fire when web-push is
 * broken (e.g., VAPID keys expired, push service down, endpoint provider
 * blacklisting).
 *
 * Threshold:   > 10 failures in the last 5 minutes
 * Debounce:    Only one Sentry event per 5-minute window after crossing
 * Cooldown:    5 minutes of quiet resets the alert state
 *
 * Usage:
 *   import { trackPushFailure } from "@/lib/push-monitor"
 *
 *   // In sendPushNotification, after all retries exhausted:
 *   trackPushFailure(userId, subEndpoint, errorMessage)
 *
 *   // Diagnostic endpoint:
 *   import { getPushFailureStats } from "@/lib/push-monitor"
 *   const stats = getPushFailureStats()
 */

import { captureMessage } from "./sentry"
import logger from "./logger"

// ── Constants ───────────────────────────────────────────────────────────────

/** Sliding window duration in milliseconds (5 minutes) */
const WINDOW_MS = 5 * 60 * 1000

/** Failure threshold before alerting */
const FAILURE_THRESHOLD = 10

/** Cooldown: don't re-alert until this long after the last alert */
const ALERT_COOLDOWN_MS = 5 * 60 * 1000

// ── State (in-memory, resets on server restart) ─────────────────────────────

interface FailureRecord {
  timestamp: number
  userId: string
  endpoint: string
  errorMessage: string
}

/** Sliding window of recent failures (FIFO, auto-pruned) */
const recentFailures: FailureRecord[] = []

/** Timestamp of the last Sentry alert sent, or 0 if none */
let lastAlertAt = 0

// ── Prune old entries ───────────────────────────────────────────────────────

function pruneWindow(): void {
  const cutoff = Date.now() - WINDOW_MS
  while (recentFailures.length > 0 && recentFailures[0]!.timestamp < cutoff) {
    recentFailures.shift()
  }
}

// ── Track failure ────────────────────────────────────────────────────────────

/**
 * Record a permanent push notification failure.
 * If the failure count in the sliding window exceeds FAILURE_THRESHOLD,
 * a Sentry event is dispatched (debounced to once per ALERT_COOLDOWN_MS).
 *
 * Safe to call from any server context (API route, worker, queue consumer).
 */
export function trackPushFailure(userId: string, endpoint: string, errorMessage: string): void {
  const now = Date.now()

  // Record the failure
  recentFailures.push({ timestamp: now, userId, endpoint, errorMessage })

  // Prune old entries
  pruneWindow()

  // Count failures in the current window
  const count = recentFailures.length

  logger.warn(
    {
      userId,
      endpoint: endpoint.slice(0, 30) + "…",
      errorMessage,
      failureCount: count,
      windowMinutes: WINDOW_MS / 60_000,
    },
    "push failure tracked",
  )

  // Check if we need to alert
  if (count > FAILURE_THRESHOLD && now - lastAlertAt > ALERT_COOLDOWN_MS) {
    lastAlertAt = now

    // Collect unique users and errors for context
    const uniqueUsers = new Set(recentFailures.map((r) => r.userId))
    const recentErrors = recentFailures
      .slice(-5) // last 5 distinct errors
      .map((r) => ({ userId: r.userId, error: r.errorMessage }))

    const context: Record<string, unknown> = {
      failureCount: count,
      windowMinutes: WINDOW_MS / 60_000,
      alertThreshold: FAILURE_THRESHOLD,
      affectedUsers: uniqueUsers.size,
      recentErrors,
    }

    captureMessage(
      `[PushMonitor] 🛑 Web-Push broken — ${count} failures in the last 5 minutes. Check VAPID keys, push service, and endpoint health.`,
      "error",
      context,
    )

    logger.error(
      { failureCount: count, uniqueUsers: uniqueUsers.size, recentErrors },
      "push-monitor: alert sent — web-push failure threshold exceeded",
    )
  }
}

// ── Diagnostic stats ────────────────────────────────────────────────────────

export interface PushFailureStats {
  currentWindowFailures: number
  windowMinutes: number
  threshold: number
  isAlerting: boolean
  lastAlertAt: string | null
  lastAlertSecondsAgo: number | null
  sampleErrors: Array<{ userId: string; error: string }>
}

/**
 * Return current push failure statistics for diagnostic / health endpoints.
 */
export function getPushFailureStats(): PushFailureStats {
  pruneWindow()

  const now = Date.now()
  const count = recentFailures.length
  const sampleErrors = recentFailures
    .slice(-5)
    .map((r) => ({ userId: r.userId.slice(0, 12) + "…", error: r.errorMessage }))

  return {
    currentWindowFailures: count,
    windowMinutes: WINDOW_MS / 60_000,
    threshold: FAILURE_THRESHOLD,
    isAlerting: count > FAILURE_THRESHOLD,
    lastAlertAt: lastAlertAt > 0 ? new Date(lastAlertAt).toISOString() : null,
    lastAlertSecondsAgo: lastAlertAt > 0 ? Math.round((now - lastAlertAt) / 1000) : null,
    sampleErrors,
  }
}

/**
 * Reset all tracked state (useful for testing or manual recovery).
 */
export function resetPushMonitor(): void {
  recentFailures.length = 0
  lastAlertAt = 0
}
