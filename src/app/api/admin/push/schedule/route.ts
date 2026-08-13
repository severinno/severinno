/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError, badRequest } from "@/lib/api-server"
import logger from "@/lib/logger"

/**
 * POST /api/admin/push/schedule
 *
 * Agenda uma notificacao push para ser enviada em horario futuro.
 * Requer role ADMIN.
 *
 * Body:
 *   userIds     — array de IDs de usuarios (ate 50)
 *   title       — titulo da notificacao (max 120 chars)
 *   body        — corpo da notificacao (max 500 chars, opcional)
 *   pushUrl     — URL para abrir ao clicar (opcional, default "/")
 *   type        — tipo da notificacao (opcional, default "ADMIN_MANUAL")
 *   scheduledAt — ISO timestamp para envio (obrigatorio, deve ser futuro)
 */
export async function POST(request: Request) {
  try {
    const session = await requireRole("ADMIN")

    const body = await request.json()
    const { userIds, title, body: messageBody, pushUrl, type, scheduledAt } = body

    // ── Validacoes ──────────────────────────────────────────────────────
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      throw badRequest("Envie um array userIds com pelo menos um ID.")
    }
    if (userIds.length > 50) {
      throw badRequest("Maximo de 50 usuarios por agendamento.")
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
    if (!scheduledAt) {
      throw badRequest("scheduledAt (ISO timestamp) e obrigatorio.")
    }

    const scheduleDate = new Date(scheduledAt)
    if (isNaN(scheduleDate.getTime())) {
      throw badRequest("scheduledAt invalido — deve ser uma data ISO valida.")
    }

    // Validar pushUrl (seguranca — prevenir javascript: etc)
    if (pushUrl && !/^\/(?!\/)|^https?:\/\//.test(pushUrl)) {
      throw badRequest("pushUrl deve comecar com /, http:// ou https://.")
    }

    const notificationType = type || "ADMIN_MANUAL"
    const notificationTitle = title.trim()
    const notificationBody = messageBody?.trim() || null
    const notificationUrl = pushUrl || "/"

    logger.info(
      {
        adminId: session.userId,
        userIds: userIds.length,
        title: notificationTitle,
        type: notificationType,
        scheduledAt: scheduleDate.toISOString(),
      },
      "admin scheduling push notification",
    )

    const scheduled = await db.scheduledPushNotification.create({
      data: {
        scheduledAt: scheduleDate,
        title: notificationTitle,
        body: notificationBody,
        pushUrl: notificationUrl,
        type: notificationType,
        userIds,
        createdBy: session.userId,
      },
    })

    // ── Audit log ────────────────────────────────────────────────────
    db.pushSendLog
      .create({
        data: {
          adminId: session.userId,
          action: "manual_schedule",
          title: notificationTitle,
          body: notificationBody,
          pushUrl: notificationUrl,
          notificationType,
          recipientCount: (userIds as string[]).length,
          sentCount: 0,
          errorCount: 0,
          directPushCount: 0,
          metadata: {
            scheduleId: scheduled.id,
            scheduledAt: scheduleDate.toISOString(),
            sampleUserIds: (userIds as string[]).slice(0, 5),
          },
        },
      })
      .catch((err) => logger.error({ err }, "failed to create push audit log"))

    return NextResponse.json(
      {
        ok: true,
        scheduled: {
          id: scheduled.id,
          scheduledAt: scheduled.scheduledAt.toISOString(),
          title: scheduled.title,
          body: scheduled.body,
          pushUrl: scheduled.pushUrl,
          type: scheduled.type,
          userIdsCount: (userIds as string[]).length,
          status: scheduled.status,
        },
      },
      { status: 201 },
    )
  } catch (e) {
    return handleError(e)
  }
}

/**
 * GET /api/admin/push/schedule
 *
 * Lista notificacoes agendadas com paginacao e filtro por status.
 *
 * Query params:
 *   status  — "PENDING" | "SENT" | "CANCELLED" | "FAILED" (opcional)
 *   page    — numero da pagina (default 1)
 *   limit   — itens por pagina (default 20, max 100)
 */
export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || undefined
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20))
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = {}
    if (status && ["PENDING", "SENT", "CANCELLED", "FAILED"].includes(status)) {
      where.status = status
    }

    const [items, total] = await Promise.all([
      db.scheduledPushNotification.findMany({
        where: where as any,
        orderBy: { scheduledAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          scheduledAt: true,
          status: true,
          title: true,
          body: true,
          pushUrl: true,
          type: true,
          sentCount: true,
          errorCount: true,
          sentAt: true,
          createdAt: true,
          userIds: true,
        },
      }),
      db.scheduledPushNotification.count({ where: where as any }),
    ])

    const mapped = items.map((item) => ({
      ...item,
      scheduledAt: item.scheduledAt.toISOString(),
      sentAt: item.sentAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      userIdsCount: (item.userIds as string[]).length,
    }))

    return NextResponse.json({
      ok: true,
      items: mapped,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    })
  } catch (e) {
    return handleError(e)
  }
}
