import "server-only"
import { db } from "@/lib/db"
import { captureMessage } from "@/lib/sentry"
import { sendPushNotification } from "@/lib/push"
import logger from "@/lib/logger"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertSeverity = "warning" | "error" | "info"

export type GeoAlertPayload = {
  /** Alert title (short, one line). */
  title: string
  /** Alert body (detailed description). */
  body: string
  /** Severity level — maps to Sentry level and push priority. */
  severity: AlertSeverity
  /** Optional deep-link URL for the push notification action. */
  url?: string
  /** Tag for push deduplication — same tag replaces previous. */
  tag?: string
  /** Additional structured context for Sentry. */
  context?: Record<string, unknown>
  /** Source identifier (e.g. "geo-performance-alert", "benchmark-cron"). */
  source: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Debounce: minimum interval between push notifications with the same tag. */
const PUSH_DEBOUNCE_MS = 15 * 60 * 1000

/** Debounce: minimum interval between Sentry events with the same tag. */
const SENTRY_DEBOUNCE_MS = 15 * 60 * 1000

const ADMIN_ROLE = "ADMIN"

// ---------------------------------------------------------------------------
// In-memory debounce state (resets on server restart)
// ---------------------------------------------------------------------------

const lastPushByTag = new Map<string, number>()
const lastSentryByTag = new Map<string, number>()

// ---------------------------------------------------------------------------
// Send alert to all admin users
// ---------------------------------------------------------------------------

/**
 * Find all admin user IDs from the database.
 * These receive push notifications for geo regressions.
 */
async function getAdminUserIds(): Promise<string[]> {
  try {
    const admins = await db.user.findMany({
      where: { role: ADMIN_ROLE },
      select: { id: true },
    })
    return admins.map((a) => a.id)
  } catch {
    // DB unavailable — skip push (Sentry still fires)
    return []
  }
}

/**
 * Send a notification to all admin users via multiple channels:
 *   1. Sentry (warning/error event)
 *   2. Push notification (web-push)
 *
 * Push notifications are debounced by `tag` to avoid flooding:
 *   - Same tag = same alert type (e.g. "geo-p95-regression")
 *   - Only sends if at least PUSH_DEBOUNCE_MS have passed since last send
 *
 * @returns Whether the push notification was actually sent (false if debounced).
 */
export async function notifyGeoAlert(payload: GeoAlertPayload): Promise<{
  sentrySent: boolean
  pushSent: boolean
  pushDebounced: boolean
  adminCount: number
}> {
  const { title, body, severity, url, tag, context, source } = payload

  // ── 1. Sentry (debounced by tag) ───────────────────────────────────
  let sentryDebounced = false
  if (tag) {
    const lastSentry = lastSentryByTag.get(tag) ?? 0
    if (Date.now() - lastSentry < SENTRY_DEBOUNCE_MS) {
      sentryDebounced = true
    }
  }

  if (!sentryDebounced) {
    if (tag) lastSentryByTag.set(tag, Date.now())

    captureMessage(
      `[${source}] ${severity === "error" ? "🛑" : severity === "warning" ? "⚠️" : "ℹ️"} ${title}`,
      severity === "error" ? "error" : severity === "warning" ? "warn" : "info",
      { source, ...context },
    )
  }

  // ── 2. Push notification to admins ──────────────────────────────────
  const adminIds = await getAdminUserIds()
  if (adminIds.length === 0) {
    logger.debug("geo-alert-notify: no admin users found — skipping push")
    return { sentrySent: true, pushSent: false, pushDebounced: false, adminCount: 0 }
  }

  // Debounce check
  if (tag) {
    const lastSent = lastPushByTag.get(tag) ?? 0
    if (Date.now() - lastSent < PUSH_DEBOUNCE_MS) {
      logger.debug(
        { tag, lastSent: new Date(lastSent).toISOString() },
        "geo-alert-notify: push debounced",
      )
      return { sentrySent: true, pushSent: false, pushDebounced: true, adminCount: adminIds.length }
    }
  }

  // Update debounce timestamp BEFORE sending (prevents concurrent sends)
  if (tag) {
    lastPushByTag.set(tag, Date.now())
  }

  // Send push to all admins (best-effort, parallel)
  const pushResults = await Promise.allSettled(
    adminIds.map((uid) =>
      sendPushNotification(uid, title, body, url ?? "/admin", {
        tag: tag ?? `geo-alert:${source}:${Date.now()}`,
        source,
        data: context as Record<string, unknown>,
      }),
    ),
  )

  const pushSentCount = pushResults.filter((r) => r.status === "fulfilled").length

  logger.info(
    {
      admins: adminIds.length,
      pushSent: pushSentCount,
      pushFailed: pushResults.length - pushSentCount,
      tag,
      severity,
      source,
    },
    "geo-alert-notify: alert sent",
  )

  return {
    sentrySent: true,
    pushSent: pushSentCount > 0,
    pushDebounced: false,
    adminCount: adminIds.length,
  }
}

// ---------------------------------------------------------------------------
// Reset debounce state (useful for testing)
// ---------------------------------------------------------------------------

export function resetGeoAlertDebounce(): void {
  lastPushByTag.clear()
}
