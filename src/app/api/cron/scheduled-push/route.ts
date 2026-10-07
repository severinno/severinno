export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import logger from "@/lib/logger"
import { sendPushNotification } from "@/lib/push"
import { captureError } from "@/lib/sentry"

import { withRoute } from "@/lib/api-route"

/**
 * GET /api/cron/scheduled-push
 *
 * Cron job que verifica notificacoes push agendadas com scheduledAt <= now
 * e status = PENDING, e as envia para todos os usuarios da lista.
 *
 * Seguranca: requer header Authorization: Bearer CRON_SECRET.
 *
 * Deve ser chamado a cada 5 minutos por um cron externo (crontab, UptimeRobot,
 * CronJob.org, etc).
 *
 * Exemplo de chamada:
 *   curl -H "Authorization: Bearer ${CRON_SECRET}" \
 *     https://severinno.com.br/api/cron/scheduled-push
 */
export const GET = withRoute("api.cron.scheduled-push.GET", async (request) => {
  const auth = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()

  // Busca notificacoes agendadas com scheduledAt <= now e status PENDING
  const dueNotifications = await db.scheduledPushNotification.findMany({
    where: {
      status: "PENDING",
      scheduledAt: { lte: now },
    },
  })

  logger.info(
    { found: dueNotifications.length },
    "cron scheduled-push: processing due notifications",
  )

  const results: Array<{
    id: string
    title: string
    status: string
    sentCount: number
    errorCount: number
  }> = []

  for (const notification of dueNotifications) {
    const userIds = notification.userIds as string[]
    let sentCount = 0
    let errorCount = 0

    // Filtra apenas usuarios que tem push subscriptions ativas
    const subs = await db.pushSubscription.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds } },
    })

    const activeUserIds = subs.map((s) => s.userId)

    if (activeUserIds.length === 0) {
      logger.warn(
        { scheduledId: notification.id, title: notification.title },
        "scheduled push: no active subscriptions for any userId — marking as FAILED",
      )
      await db.scheduledPushNotification.update({
        where: { id: notification.id },
        data: { status: "FAILED", errorCount: userIds.length },
      })
      results.push({
        id: notification.id,
        title: notification.title,
        status: "FAILED",
        sentCount: 0,
        errorCount: userIds.length,
      })
      continue
    }

    // Envia push para cada usuario com subscription ativa
    for (const uid of activeUserIds) {
      try {
        const title = notification.title
        const body = notification.body ?? ""
        const pushUrl = notification.pushUrl ?? "/"

        await sendPushNotification(uid, title, body, pushUrl)
        sentCount++
      } catch (err) {
        errorCount++
        captureError(err, {
          scheduledId: notification.id,
          userId: uid,
          context: "cron scheduled-push send",
        })
        logger.error(
          { err, scheduledId: notification.id, userId: uid },
          "scheduled push: send failed",
        )
      }
    }

    // Atualiza status da notificacao agendada
    const finalStatus = errorCount === 0 ? "SENT" : sentCount > 0 ? "SENT" : "FAILED"
    await db.scheduledPushNotification.update({
      where: { id: notification.id },
      data: {
        status: finalStatus,
        sentCount,
        errorCount,
        sentAt: now,
      },
    })

    results.push({
      id: notification.id,
      title: notification.title,
      status: finalStatus,
      sentCount,
      errorCount,
    })

    logger.info(
      {
        scheduledId: notification.id,
        title: notification.title,
        status: finalStatus,
        sentCount,
        errorCount,
      },
      "scheduled push: processed",
    )
  }

  return NextResponse.json({
    ok: true,
    processed: dueNotifications.length,
    results,
  })
})
