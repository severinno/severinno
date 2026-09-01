import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError, badRequest } from "@/lib/api-server"
import { sendPushNotification } from "@/lib/push"
import { saveAndQueueNotification } from "@/lib/notification-queue"
import logger from "@/lib/logger"

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

    const body = await request.json()
    const { userIds, title, body: messageBody, pushUrl, type } = body
    const { sanitizeText } = await import("@/lib/sanitize")

    // Validacoes
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      throw badRequest("Envie um array userIds com pelo menos um ID de usuario.")
    }
    if (userIds.length > 50) {
      throw badRequest("Maximo de 50 usuarios por envio.")
    }
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      throw badRequest("title e obrigatorio.")
    }
    if (title.length > 120) {
      throw badRequest("title deve ter no maximo 120 caracteres.")
    }
    if (messageBody && messageBody.length > 500) {
      throw badRequest("body deve ter no maximo 500 caracteres.")
    }

    const notificationType = type || "ADMIN_MANUAL"
    const notificationTitle = sanitizeText(title.trim())
    const notificationBody = sanitizeText(messageBody?.trim() || "")
    const notificationUrl = pushUrl || "/"

    // Validar pushUrl (seguranca — prevenir javascript: etc)
    if (pushUrl && !/^\/(?!\/)|^https?:\/\//.test(pushUrl)) {
      throw badRequest("pushUrl deve comecar com /, http:// ou https://.")
    }

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
