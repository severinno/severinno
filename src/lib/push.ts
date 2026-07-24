import "server-only"
import webpush from "web-push"
import { db } from "@/lib/db"
import logger from "@/lib/logger"

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

export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  url?: string,
) {
  const subs = await db.pushSubscription.findMany({ where: { userId } })
  if (subs.length === 0) return

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({ title, body, url, timestamp: new Date().toISOString() }),
      ).catch(async (err: { statusCode?: number } & Error) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          try { await db.pushSubscription.delete({ where: { id: sub.id } }) } catch (deleteErr) { logger.error({ err: deleteErr, subId: sub.id }, "failed to delete expired push sub") }
          logger.warn({ endpoint: sub.endpoint.slice(0, 30) }, "removed expired push sub")
        }
        throw err
      }),
    ),
  )

  const succeeded = results.filter((r) => r.status === "fulfilled").length
  if (succeeded < subs.length) {
    logger.warn({ userId, sent: succeeded, total: subs.length }, "push notification partial failure")
  }
}

export async function sendPushToMany(
  userIds: string[],
  title: string,
  body: string,
  url?: string,
) {
  await Promise.allSettled(
    userIds.map((uid) => sendPushNotification(uid, title, body, url)),
  )
}
