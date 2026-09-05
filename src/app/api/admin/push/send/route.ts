export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError, badRequest } from "@/lib/api-server"
import { sendPushNotification } from "@/lib/push"
import { saveAndQueueNotification } from "@/lib/notification-queue"
import logger from "@/lib/logger"
import { z } from "zod"
import { parseBody } from "@/lib/api-middleware"

const pushSendSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
  title: z.string().min(1).max(120),
  body: z.string().max(500).optional(),
  pushUrl: z
    .string()
    .regex(/^\/(?!\/)|^https?:\/\//, "pushUrl must start with /, http:// or https://")
    .optional(),
  type: z.string().max(50).optional(),
})

/**
 * POST /api/admin/push/send
 *
 * Envia uma notificacao push manual para um ou mais usuarios.
 * Requer role ADMIN. Cria notificacao in-app e dispara push.
 *
 * Body:
 *   userIds   — array de IDs de usuarios (ate 50 por vez)
 *   title     — titulo da notificacao (max 120 chars)
 *   body      — corpo da notificacao (max 500 chars)
 *   pushUrl   — URL para abrir ao clicar na notificacao (opcional)
 *   type      — tipo da notificacao (default: "ADMIN_MANUAL")
 */
export async function POST(request: Request) {
  try {
    const session = await requireRole("ADMIN")
    const { assertRateLimit, RATE_LIMITS } = await import("@/lib/rate-limit")
    await assertRateLimit(request, RATE_LIMITS.admin)

    const parsed = await parseBody(request, pushSendSchema)
    const { userIds, title, body: messageBody, pushUrl, type } = parsed
    const { sanitizeText } = await import("@/lib/sanitize")

    const notificationType = type || "ADMIN_MANUAL"
    const notificationTitle = sanitizeText(title.trim())
    const notificationBody = sanitizeText(messageBody?.trim() || "")
    const notificationUrl = pushUrl || "/"

    logger.info(
      {
        adminId: session.userId,
        userIds: userIds.length,
        title: notificationTitle,
        type: notificationType,
      },
      "admin sending manual push notification",
    )

    // Para cada usuario, criar notificacao in-app e enviar push.
    // Tenta via RabbitMQ primeiro; se a fila estiver indisponivel,
    // faz fallback para push direto (sem dependencia externa).
    let sentCount = 0
    let directPushCount = 0
    let errorCount = 0

    for (const userId of userIds) {
      try {
        // Tenta enfileirar via RabbitMQ
        await saveAndQueueNotification({
          userId,
          type: notificationType,
          title: notificationTitle,
          body: notificationBody,
          pushUrl: notificationUrl,
        })
        sentCount++
      } catch (queueErr) {
        // RabbitMQ indisponivel — fallback para push direto
        logger.warn({ err: queueErr, userId }, "queue unavailable, falling back to direct push")
        try {
          await sendPushNotification(userId, notificationTitle, notificationBody, notificationUrl)
          await db.notification.create({
            data: {
              userId,
              type: notificationType,
              title: notificationTitle,
              body: notificationBody || null,
            },
          })
          directPushCount++
          sentCount++
        } catch (fallbackErr) {
          errorCount++
          logger.error({ err: fallbackErr, userId }, "direct push also failed")
        }
      }
    }

    // ── Audit log ────────────────────────────────────────────────────
    db.pushSendLog
      .create({
        data: {
          adminId: session.userId,
          action: "manual_send",
          title: notificationTitle,
          body: notificationBody || null,
          pushUrl: notificationUrl,
          notificationType,
          recipientCount: userIds.length,
          sentCount,
          errorCount,
          directPushCount,
          metadata: {
            total: userIds.length,
            sampleUserIds: userIds.slice(0, 5),
            hasFallback: directPushCount > 0,
          },
        },
      })
      .catch((err) => logger.error({ err }, "failed to create push audit log"))

    const hasFallback = directPushCount > 0
    const responseMessage = hasFallback
      ? `Notificacao enviada — ${sentCount} de ${userIds.length} sucesso (${directPushCount} via fallback direto). ${errorCount} erro(s).`
      : `Notificacao enfileirada para ${sentCount} de ${userIds.length} usuario(s).`

    return NextResponse.json({
      ok: true,
      sentCount,
      directPushCount,
      errorCount,
      total: userIds.length,
      message: responseMessage,
    })
  } catch (e) {
    return handleError(e)
  }
}
