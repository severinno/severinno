export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { handleError, badRequest, forbidden, notFound } from "@/lib/api-server"
import { notifyBookingStatus } from "@/lib/notifications"
import logger from "@/lib/logger"

/**
 * Atualiza o registro PushAnalytics mais recente para o par
 * (userId, bookingId) com a ação executada.
 * Permite correlacionar cliques em push com ações tomadas.
 */
async function logPushAction(
  userId: string,
  bookingId: string,
  action: string,
  actionResult: string,
): Promise<void> {
  try {
    // Busca o analytics mais recente para este usuário + booking
    const recent = await db.pushAnalytics.findFirst({
      where: { userId, bookingId, status: "sent" },
      orderBy: { createdAt: "desc" },
    })

    if (recent) {
      await db.pushAnalytics.update({
        where: { id: recent.id },
        data: { action, actionResult, clickedAt: new Date(), status: "clicked" },
      })
      logger.info(
        { analyticsId: recent.id, userId, action, actionResult, bookingId },
        "push action logged",
      )
    } else {
      // Sem PushAnalytics prévio — cria um registro de ação avulso
      await db.pushAnalytics.create({
        data: {
          userId,
          title: `Ação: ${actionResult}`,
          type: "ACTION_LOG",
          source: "push_action",
          status: "clicked",
          action,
          actionResult,
          bookingId,
          clickedAt: new Date(),
        },
      })
      logger.info({ userId, action, actionResult, bookingId }, "push action logged (standalone)")
    }
  } catch (err) {
    logger.error({ err, userId, bookingId, action }, "failed to log push action")
  }
}

/**
 * POST /api/push/action
 *
 * Callback para botões de ação em notificações push.
 * O service worker redireciona o clique do botão para o dashboard,
 * e o dashboard faz uma requisição a este endpoint para executar a ação.
 *
 * Body:
 *   action    — "accept" | "reject" | "view"
 *   bookingId — ID do agendamento
 *
 * Ações:
 *   accept → Confirma o agendamento (provider)
 *   reject → Cancela o agendamento (provider)
 *   view   → Marca como lido e redireciona (qualquer role)
 */
export async function POST(request: Request) {
  try {
    const session = await requireUser()
    const body = await request.json()
    const { action, bookingId } = body

    if (!action || !bookingId) {
      throw badRequest("action e bookingId são obrigatórios")
    }

    if (!["accept", "reject", "view"].includes(action)) {
      throw badRequest(`Ação inválida: ${action}. Use: accept, reject, view`)
    }

    logger.info({ userId: session.userId, action, bookingId }, "push action triggered")

    // Fetch booking to validate permission
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        providerId: true,
        status: true,
        service: { select: { title: true } },
      },
    })

    if (!booking) throw notFound("Agendamento não encontrado")

    // ── Accept (provider confirms booking) ─────────────────────────────
    if (action === "accept") {
      if (session.userId !== booking.providerId) {
        throw forbidden("Apenas o prestador pode confirmar o agendamento")
      }
      if (booking.status !== "PENDING") {
        throw badRequest(`Agendamento já está "${booking.status}". Não é possível confirmar.`)
      }

      await db.booking.update({
        where: { id: bookingId },
        data: { status: "CONFIRMED" },
      })

      // Log action in PushAnalytics
      await logPushAction(session.userId, bookingId, "accept", "CONFIRMED")

      // Notify both parties
      await Promise.allSettled([
        notifyBookingStatus(booking.clientId, bookingId, "CONFIRMED", booking.service.title),
        notifyBookingStatus(booking.providerId, bookingId, "CONFIRMED", booking.service.title),
      ])

      return NextResponse.json({
        ok: true,
        action: "confirmed",
        message: "Agendamento confirmado com sucesso!",
        redirectUrl: `/dashboard?tab=bookings&booking=${bookingId}`,
      })
    }

    // ── Reject (provider cancels booking) ──────────────────────────────
    if (action === "reject") {
      if (session.userId !== booking.providerId) {
        throw forbidden("Apenas o prestador pode recusar o agendamento")
      }
      if (booking.status !== "PENDING") {
        throw badRequest(`Agendamento já está "${booking.status}". Não é possível recusar.`)
      }

      await db.booking.update({
        where: { id: bookingId },
        data: { status: "CANCELLED" },
      })

      // Log action in PushAnalytics
      await logPushAction(session.userId, bookingId, "reject", "CANCELLED")

      // Notify client
      await notifyBookingStatus(
        booking.clientId,
        bookingId,
        "CANCELLED",
        booking.service.title,
        "O prestador recusou o agendamento.",
      )

      return NextResponse.json({
        ok: true,
        action: "cancelled",
        message: "Agendamento recusado.",
        redirectUrl: `/dashboard?tab=bookings`,
      })
    }

    // ── View (just mark as read, already handled by SW opening URL) ────
    await logPushAction(session.userId, bookingId, "view", "viewed").catch((err) =>
      logger.warn({ err }, "push action log failed"),
    )

    return NextResponse.json({
      ok: true,
      action: "viewed",
      message: "Redirecionando...",
      redirectUrl: `/dashboard?tab=bookings&booking=${bookingId}`,
    })
  } catch (e) {
    return handleError(e)
  }
}
