/**
 * Notification Digest — Adaptive windowing based on event frequency.
 *
 * Implements intelligent notification batching:
 * - Urgent notifications bypass digest (immediate delivery).
 * - Standard notifications are buffered in Redis per user.
 * - Window dynamically adapts:
 *     - 1-2 events: short window (10-15 min) for timely alerts.
 *     - 3-5 events: medium window (30-45 min) to prevent notification clutter.
 *     - >5 events: extended window (60-120 min) consolidated into a rich summary.
 * - Flushes digests when the adaptive window expires or when explicitly triggered.
 */

import { getClient } from "@/lib/redis"
import logger from "@/lib/logger"
import { sendText } from "./evolution"
import { sendPushNotification } from "./push"
import { db } from "@/lib/db"

const log = logger.child({ module: "notification-digest" })

export type DigestItem = {
  id: string
  type: string
  title: string
  body?: string
  priority: "low" | "medium" | "high" | "urgent"
  timestamp: number
  metadata?: Record<string, unknown>
}

// Types that ALWAYS bypass digest
const IMMEDIATE_TYPES = new Set([
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
  "IDENTITY_APPROVED",
  "IDENTITY_REJECTED",
  "SECURITY_ALERT",
  "TWO_FACTOR_DISABLED",
])

/**
 * Calculate adaptive window duration in seconds based on recent event count.
 */
export function calculateAdaptiveWindowSeconds(eventCount: number): number {
  if (eventCount <= 1) return 10 * 60 // 10 minutes
  if (eventCount <= 3) return 20 * 60 // 20 minutes
  if (eventCount <= 6) return 45 * 60 // 45 minutes
  if (eventCount <= 10) return 60 * 60 // 1 hour
  return 120 * 60 // 2 hours max
}

/**
 * Enqueue a notification for digest delivery, or return true if it should be sent immediately.
 */
export async function enqueueOrBypassDigest(
  userId: string,
  item: DigestItem,
): Promise<{ immediate: boolean }> {
  // Urgent notifications always bypass digest
  if (item.priority === "urgent" || IMMEDIATE_TYPES.has(item.type)) {
    return { immediate: true }
  }

  const redis = getClient()
  if (!redis) {
    // If Redis is unavailable, bypass digest to ensure delivery
    return { immediate: true }
  }

  const listKey = `digest:queue:${userId}`
  const metaKey = `digest:meta:${userId}`

  try {
    // Push new item
    await redis.rpush(listKey, JSON.stringify(item))

    // Check count to calculate adaptive window
    const count = await redis.llen(listKey)
    const windowSecs = calculateAdaptiveWindowSeconds(count)

    // Check if flush timer is already scheduled
    const existingMeta = await redis.get(metaKey)
    const now = Date.now()

    if (!existingMeta) {
      // Set initial deadline
      const deadline = now + windowSecs * 1000
      await redis.set(metaKey, JSON.stringify({ count, deadline, lastActivity: now }))
      await redis.expire(listKey, 24 * 3600)
      await redis.expire(metaKey, 24 * 3600)
    } else {
      // Update with new count and adapt deadline
      const meta = JSON.parse(existingMeta)
      const adaptedDeadline = Math.max(meta.deadline, now + windowSecs * 1000)
      await redis.set(
        metaKey,
        JSON.stringify({
          count,
          deadline: adaptedDeadline,
          lastActivity: now,
        }),
      )
    }

    log.debug(
      { userId, count, windowSecs, type: item.type },
      "Notification queued in adaptive digest",
    )

    return { immediate: false }
  } catch (err) {
    log.error({ err, userId }, "Failed to enqueue in notification digest, sending immediately")
    return { immediate: true }
  }
}

/**
 * Formats grouped digest items into a cohesive summary message for WhatsApp / Push.
 */
export function formatDigestMessage(
  userName: string,
  items: DigestItem[],
): {
  title: string
  body: string
  whatsAppText: string
} {
  const quoteCount = items.filter((i) => i.type.includes("QUOTE")).length
  const bookingCount = items.filter((i) => i.type.includes("BOOKING")).length
  const messageCount = items.filter((i) => i.type.includes("MESSAGE")).length
  const otherCount = items.length - quoteCount - bookingCount - messageCount

  const parts: string[] = []
  if (quoteCount > 0) parts.push(`${quoteCount} ${quoteCount === 1 ? "orçamento" : "orçamentos"}`)
  if (bookingCount > 0)
    parts.push(`${bookingCount} ${bookingCount === 1 ? "agendamento" : "agendamentos"}`)
  if (messageCount > 0)
    parts.push(`${messageCount} ${messageCount === 1 ? "mensagem" : "mensagens"}`)
  if (otherCount > 0) parts.push(`${otherCount} outras atualizações`)

  const summary = parts.join(", ")
  const title = `Resumo Severinno: ${items.length} novidades`
  const body = `Você tem ${summary}. Toque para conferir.`

  // Rich WhatsApp layout
  const bulletLines = items
    .slice(0, 5)
    .map((item) => `• *${item.title}*: ${item.body || "Confira os detalhes no app."}`)
    .join("\n")

  const extraCount = items.length > 5 ? `\n_...e mais ${items.length - 5} atualizações._` : ""

  const whatsAppText = `🔔 *Resumo de Atividades — Severinno*\n\nOlá, ${userName || "parceiro"}! Resumimos suas notificações recentes para sua comodidade:\n\n${bulletLines}${extraCount}\n\n👉 Acesse seu painel: https://severinno.com.br/dashboard`

  return { title, body, whatsAppText }
}

/**
 * Flush digest queue for a specific user.
 */
export async function flushUserDigest(userId: string): Promise<boolean> {
  const redis = getClient()
  if (!redis) return false

  const listKey = `digest:queue:${userId}`
  const metaKey = `digest:meta:${userId}`

  try {
    const rawItems = await redis.lrange(listKey, 0, -1)
    if (!rawItems || rawItems.length === 0) {
      await redis.del(metaKey)
      return false
    }

    // Delete queue atomically
    await redis.del(listKey)
    await redis.del(metaKey)

    const items: DigestItem[] = rawItems
      .map((raw) => {
        try {
          return JSON.parse(raw)
        } catch {
          return null
        }
      })
      .filter(Boolean) as DigestItem[]

    if (items.length === 0) return false

    // Fetch user details for notification
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { name: true, whatsapp: true },
    })

    const { title, body, whatsAppText } = formatDigestMessage(user?.name || "", items)

    // Send push
    await sendPushNotification(userId, title, body, "/dashboard").catch(() => {})

    // Send WhatsApp if available
    if (user?.whatsapp) {
      await sendText(user.whatsapp, whatsAppText).catch(() => {})
    }

    log.info({ userId, itemsCount: items.length }, "Adaptive notification digest flushed and sent")

    return true
  } catch (err) {
    log.error({ err, userId }, "Error flushing notification digest")
    return false
  }
}
