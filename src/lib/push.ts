import "server-only"
import webpush from "web-push"
import { db } from "@/lib/db"
import logger from "@/lib/logger"
import { trackPushFailure } from "./push-monitor"

const publicKey = process.env.VAPID_PUBLIC_KEY ?? ""
const privateKey = process.env.VAPID_PRIVATE_KEY ?? ""
const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@severinno.com.br"

// Only configure web-push when VAPID keys are available (production).
// In dev/test, push notifications are silently skipped.
if (publicKey && privateKey) {
  webpush.setVapidDetails(subject, publicKey, privateKey)
} else {
  logger.warn("VAPID keys not configured — push notifications disabled")
}

// ── Retry config ────────────────────────────────────────────────────────────

const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 4000

/** Sleep helper */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Exponential backoff with jitter: waits baseDelay * 2^attempt + random(0, jitter)
 */
function getBackoffDelay(attempt: number): number {
  const exponential = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
  const jitter = Math.random() * RETRY_BASE_DELAY_MS
  return Math.min(exponential + jitter, MAX_RETRY_DELAY_MS)
}

/**
 * Returns true if the error represents a transient failure (network, timeout, 5xx).
 * Permanent failures (410 gone, 404 not found, 401 unauthorized) are NOT retried.
 */
function isTransientError(err: { statusCode?: number; message?: string }): boolean {
  if (!err.statusCode) {
    // No statusCode = network / timeout / DNS failure — transient
    return err.message !== "push cancelled"
  }
  // 5xx — server errors are transient
  if (err.statusCode >= 500 && err.statusCode < 600) return true
  // 429 — rate limited, retry after backoff
  if (err.statusCode === 429) return true
  // 4xx other than 410/404 — possibly transient
  if (err.statusCode === 408) return true // Request Timeout
  return false
}

// ── Types ─────────────────────────────────────────────────────────────────

export type PushOptions = {
  /** Deep link URL */
  url?: string
  /** Notification image URL (appears as large image in the notification) */
  image?: string
  /** Custom icon URL (defaults to /icon-192.png) */
  icon?: string
  /** Badge icon URL (small icon, shown on the app icon) */
  badge?: string
  /** Notification tag — notifications with same tag replace each other */
  tag?: string
  /** Timestamp (defaults to now) */
  timestamp?: string
  /** Additional metadata stored in notification.data */
  data?: Record<string, unknown>
}

export type PushAction = {
  action: string
  title: string
  icon?: string
}

// Available action types — corresponds to notification types
const ACTION_PRESETS: Record<string, { actions: PushAction[] }> = {
  // Botões Aceitar/Recusar aparecem na notificação push para o provider
  // quando um novo agendamento é criado. O service worker redireciona
  // o clique para /api/push/action que valida e executa a ação.
  BOOKING_CREATED: {
    actions: [
      { action: "accept", title: "✅ Aceitar" },
      { action: "reject", title: "❌ Recusar" },
    ],
  },
}

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Maximum safe payload size before we switch to signal-only pattern.
 * Web Push encrypted payload limit is ~4096 bytes. We use 3072 as threshold
 * to account for encryption overhead (VAPID headers, padding, AES-GCM).
 * Above this, we store the payload server-side and send only a reference ID.
 */
const MAX_INLINE_PAYLOAD_BYTES = 3072

// ── Send ──────────────────────────────────────────────────────────────────

export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  url?: string,
  opts?: PushOptions & { notificationType?: string; bookingId?: string; source?: string },
) {
  const subs = await db.pushSubscription.findMany({ where: { userId } })
  if (subs.length === 0) return

  // Build rich payload
  const payload: Record<string, unknown> = {
    title,
    body,
    url: url || "/",
    icon: opts?.icon || "/icon-192.png",
    badge: opts?.badge || "/icon-192.png",
    timestamp: opts?.timestamp || new Date().toISOString(),
    tag: opts?.tag,
    data: {
      url: url || "/",
      notificationId: "", // filled below with analytics ID
      ...opts?.data,
    },
  }

  // Add large image if provided
  if (opts?.image) {
    payload.image = opts.image
  }

  // Add action buttons based on notification type
  const notifType = opts?.notificationType
  if (notifType && ACTION_PRESETS[notifType]) {
    payload.actions = ACTION_PRESETS[notifType].actions
    if (opts?.bookingId) {
      const pd = payload.data as Record<string, unknown>
      pd.bookingId = opts.bookingId
      pd.notificationType = notifType
    }
  }

  const source = opts?.source ?? "auto"
  const pushType = notifType || "ADMIN_MANUAL"

  // Create analytics record with status "sent"
  const analytics = await db.pushAnalytics.create({
    data: {
      userId,
      title,
      body: body || null,
      type: pushType,
      source,
      status: "sent",
      deviceCount: subs.length,
    },
  })

  // Embed analytics ID in payload data so SW can report clicks
  const payloadData = payload.data as Record<string, unknown>
  payloadData.notificationId = analytics.id

  // ── Signal-only pattern for large payloads ────────────────────────────
  const serialized = JSON.stringify(payload)
  let wirePayload: string

  if (serialized.length > MAX_INLINE_PAYLOAD_BYTES) {
    const { storePayload } = await import("./push-store")
    const payloadId = await storePayload(payload)
    wirePayload = JSON.stringify({
      _signal: true,
      payloadId,
      title,
      body: body.length > 80 ? `${body.slice(0, 80)}…` : body,
      url: url || "/",
      data: payloadData,
    })
    logger.info(
      { size: serialized.length, payloadId },
      "push payload too large — stored server-side",
    )
  } else {
    wirePayload = serialized
  }

  // ── Send with retry ───────────────────────────────────────────────────
  const startTime = Date.now()
  let succeeded = 0
  let bounced = 0
  let failed = 0

  for (const sub of subs) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          wirePayload,
        )
        succeeded++
        break // success — exit retry loop
      } catch (err) {
        const webpushErr = err as { statusCode?: number } & Error

        // Permanent failure (410/404) — remove subscription immediately
        if (webpushErr.statusCode === 410 || webpushErr.statusCode === 404) {
          db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
          logger.warn({ endpoint: sub.endpoint.slice(0, 30) }, "removed expired push sub")
          bounced++
          break // don't retry expired subs
        }

        // Transient failure — retry with backoff
        if (isTransientError(webpushErr) && attempt < MAX_RETRIES - 1) {
          const delay = getBackoffDelay(attempt)
          logger.warn(
            { attempt: attempt + 1, delay, err: webpushErr.message },
            "push transient failure — retrying",
          )
          await sleep(delay)
          continue
        }

        // Non-transient or max retries exceeded
        failed++
        logger.error(
          { err: webpushErr.message, subId: sub.id, attempt: attempt + 1 },
          "push permanent failure",
        )
        trackPushFailure(userId, sub.endpoint, `${webpushErr.message ?? ""}`)
        break
      }
    }
  }

  const latencyMs = Date.now() - startTime

  // Update analytics record with final status
  const finalStatus = failed > 0 && succeeded === 0 ? "failed" : succeeded > 0 ? "sent" : "bounced"
  await db.pushAnalytics
    .update({
      where: { id: analytics.id },
      data: {
        status: finalStatus,
        latencyMs,
        errorMessage: failed > 0 ? `${failed} device(s) failed after ${MAX_RETRIES} retries` : null,
      },
    })
    .catch(() => {})

  if (failed > 0 || bounced > 0) {
    logger.warn(
      { userId, sent: succeeded, bounced, failed, total: subs.length, latencyMs },
      "push notification delivery report",
    )
  }
}

export async function sendPushToMany(
  userIds: string[],
  title: string,
  body: string,
  url?: string,
  opts?: PushOptions & { notificationType?: string; bookingId?: string; source?: string },
) {
  await Promise.allSettled(userIds.map((uid) => sendPushNotification(uid, title, body, url, opts)))
}
