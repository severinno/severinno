import "server-only"
import { publish } from "./queue"
import { db as prisma } from "./db"
import logger from "./logger"
import { sendPushNotification } from "./push"
import { sendWhatsApp } from "./whatsapp"
import { emitRealtime } from "./realtime-client"

type NotificationPayload = {
  notificationId: string
  userId: string
  type: string
  title: string
  body?: string
  pushUrl?: string
}

export type SaveNotificationOptions = {
  userId: string
  type: string
  title: string
  body?: string
  /** Deep link URL for push notification click (e.g. "/?view=client.bookings") */
  pushUrl?: string
}

export async function queueNotification(payload: NotificationPayload): Promise<void> {
  await publish({
    routingKey: "notification",
    payload: { ...payload, timestamp: new Date().toISOString() },
  })
}

/**
 * Save in-app notification + queue RabbitMQ for async dispatch.
 * The actual dispatch (push, WhatsApp, realtime) happens in the
 * queue consumer (handleNotification) for reliability and retries.
 */
export async function saveAndQueueNotification(payload: SaveNotificationOptions): Promise<void> {
  const created = await prisma.notification.create({
    data: {
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
    },
  })

  await queueNotification({
    notificationId: created.id,
    userId: payload.userId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    pushUrl: payload.pushUrl,
  })
}

async function dispatchPush(userId: string, title: string, body: string, pushUrl?: string): Promise<void> {
  try {
    await sendPushNotification(userId, title, body, pushUrl)
  } catch (err) {
    logger.error({ err, userId, title }, "push notification failed")
  }
}

async function dispatchWhatsApp(userId: string, title: string, body?: string, url?: string): Promise<void> {
  try {
    await sendWhatsApp({ userId, title, body, url })
  } catch (err) {
    logger.error({ err, userId, title }, "whatsapp notification failed")
  }
}

async function dispatchRealtime(notificationId: string, userId: string, type: string, title: string, body: string | undefined, createdAt: Date): Promise<void> {
  try {
    await emitRealtime("notification:new", {
      toId: userId,
      notification: {
        id: notificationId,
        type,
        title,
        body,
        read: false,
        createdAt: createdAt.toISOString(),
      },
    })
  } catch (err) {
    logger.error({ err, userId }, "realtime notification failed")
  }
}

export async function handleNotification(msg: Record<string, unknown>): Promise<void> {
  const { notificationId, userId, type, title, body, pushUrl } = msg as unknown as NotificationPayload

  logger.info({ userId, type, title, notificationId }, "dispatching notification")

  if (!notificationId || !userId || !type || !title) {
    logger.warn({ msg }, "invalid notification payload — skipping")
    return
  }

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: { id: true, createdAt: true },
  })

  if (!notification) {
    logger.error({ notificationId, userId }, "notification not found in DB — skipping dispatch")
    return
  }

  // Check user preferences before dispatching (raw SQL because Prisma client
  // may not have been regenerated with the new model yet)
  const rows = await prisma.$queryRawUnsafe<
    Array<{ pushEnabled: boolean; emailEnabled: boolean; whatsappEnabled: boolean; soundEnabled: boolean }>
  >(
    `SELECT "pushEnabled", "emailEnabled", "whatsappEnabled", "soundEnabled"
     FROM "NotificationPreference"
     WHERE "userId" = $1 AND "type" = $2`,
    [userId, type],
  )

  const pref = rows[0] // null = no preference set → enabled by default

  const dispatches: Promise<void>[] = []

  if (!pref || pref.soundEnabled || pref.pushEnabled) {
    dispatches.push(
      dispatchRealtime(notification.id, userId, type, title, body, notification.createdAt),
    )
  }
  if (!pref || pref.pushEnabled) {
    dispatches.push(
      dispatchPush(userId, title, body ?? "", pushUrl),
    )
  }
  if (!pref || pref.whatsappEnabled) {
    dispatches.push(
      dispatchWhatsApp(userId, title, body, pushUrl),
    )
  }

  await Promise.allSettled(dispatches)
}
