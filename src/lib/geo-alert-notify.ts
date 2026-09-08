import "server-only"
import { db } from "@/lib/db"
import { captureMessage } from "@/lib/sentry"
import { sendPushNotification } from "@/lib/push"
import { sendSlackAlert } from "@/lib/slack-notify"
import { cacheGet, cacheSet } from "@/lib/redis"
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
// Debounce state — Redis-backed (survives restarts, shared across instances)
// Falls back to in-memory when Redis is unavailable.
// ---------------------------------------------------------------------------

const PUSH_DEBOUNCE_REDIS_KEY = "geo:alert:push:debounce:"
const SENTRY_DEBOUNCE_REDIS_KEY = "geo:alert:sentry:debounce:"
const DEBOUNCE_TTL_SECONDS = Math.ceil(PUSH_DEBOUNCE_MS / 1000) // 15 min

// In-memory fallback for when Redis is down
const lastPushByTag = new Map<string, number>()
const lastSentryByTag = new Map<string, number>()

async function isPushDebounced(tag: string): Promise<boolean> {
  try {
    const val = await cacheGet<number>(`${PUSH_DEBOUNCE_REDIS_KEY}${tag}`)
    return val !== null
  } catch {
    // Redis down — fall back to in-memory
    const lastSent = lastPushByTag.get(tag) ?? 0
    return Date.now() - lastSent < PUSH_DEBOUNCE_MS
  }
}

async function markPushSent(tag: string): Promise<void> {
  try {
    await cacheSet(`${PUSH_DEBOUNCE_REDIS_KEY}${tag}`, Date.now(), DEBOUNCE_TTL_SECONDS)
  } catch {
    // Redis down — fall back to in-memory
  }
  lastPushByTag.set(tag, Date.now())
}

async function isSentryDebounced(tag: string): Promise<boolean> {
  try {
    const val = await cacheGet<number>(`${SENTRY_DEBOUNCE_REDIS_KEY}${tag}`)
    return val !== null
  } catch {
    const lastSent = lastSentryByTag.get(tag) ?? 0
    return Date.now() - lastSent < SENTRY_DEBOUNCE_MS
  }
}

async function markSentrySent(tag: string): Promise<void> {
  try {
    await cacheSet(`${SENTRY_DEBOUNCE_REDIS_KEY}${tag}`, Date.now(), DEBOUNCE_TTL_SECONDS)
  } catch {
    // Redis down — fall back to in-memory
  }
  lastSentryByTag.set(tag, Date.now())
}

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

  // ── 1. Sentry (debounced by tag, Redis-backed) ─────────────────────
  let sentryDebounced = false
  if (tag) {
    sentryDebounced = await isSentryDebounced(tag)
  }

  if (!sentryDebounced) {
    if (tag) await markSentrySent(tag)

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

  // Debounce check (Redis-backed, shared across instances)
  if (tag) {
    if (await isPushDebounced(tag)) {
      logger.debug({ tag }, "geo-alert-notify: push debounced")
      return { sentrySent: true, pushSent: false, pushDebounced: true, adminCount: adminIds.length }
    }
  }

  // Mark as sent BEFORE actually sending (prevents concurrent sends)
  if (tag) {
    await markPushSent(tag)
  }

  // Send push to all admins (best-effort, parallel)
  const resolvedTag = tag ?? `geo-alert:${source}:${Date.now()}`
  const pushResults = await Promise.allSettled(
    adminIds.map((uid) =>
      sendPushNotification(uid, title, body, url ?? "/admin", {
        tag: resolvedTag,
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

  // ── 3. Slack webhook (non-blocking, best-effort) ─────────────────
  // sendSlackAlert catches all errors internally, so this never throws.
  sendSlackAlert({
    title,
    body,
    severity,
    url: url ?? "/admin",
    source,
    fields: context
      ? Object.fromEntries(Object.entries(context).map(([k, v]) => [k, String(v ?? "")]))
      : undefined,
  })

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

export async function resetGeoAlertDebounce(): Promise<void> {
  // Clear all known Redis debounce keys
  const allTags = new Set([...lastPushByTag.keys(), ...lastSentryByTag.keys()])
  for (const tag of allTags) {
    try {
      const { cacheInvalidate } = await import("@/lib/redis")
      await cacheInvalidate(`${PUSH_DEBOUNCE_REDIS_KEY}${tag}`)
      await cacheInvalidate(`${SENTRY_DEBOUNCE_REDIS_KEY}${tag}`)
    } catch {
      // best-effort
    }
  }
  lastPushByTag.clear()
  lastSentryByTag.clear()
}
