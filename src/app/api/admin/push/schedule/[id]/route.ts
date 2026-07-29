import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError, notFound } from "@/lib/api-server"
import logger from "@/lib/logger"

/**
 * PATCH /api/admin/push/schedule/[id]
 *
 * Cancela uma notificacao agendada (so pode cancelar se status = "PENDING").
 * Requer role ADMIN.
 *
 * Body:
 *   action — "cancel" (unico suportado por enquanto)
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireRole("ADMIN")
    const { id } = await params

    const body = await request.json()
    const { action } = body

    if (action !== "cancel") {
      return NextResponse.json(
        { ok: false, error: 'Acao invalida. Use action: "cancel".' },
        { status: 400 },
      )
    }

    const scheduled = await db.scheduledPushNotification.findUnique({
      where: { id },
    })

    if (!scheduled) {
      throw notFound("Agendamento nao encontrado.")
    }

    if (scheduled.status !== "PENDING") {
      return NextResponse.json(
        {
          ok: false,
          error: `So e possivel cancelar agendamentos com status PENDING. Status atual: ${scheduled.status}.`,
        },
        { status: 400 },
      )
    }

    await db.scheduledPushNotification.update({
      where: { id },
      data: { status: "CANCELLED" },
    })

    logger.info({ scheduledId: id, title: scheduled.title }, "scheduled push cancelled")

    return NextResponse.json({ ok: true, message: "Agendamento cancelado com sucesso." })
  } catch (e) {
    return handleError(e)
  }
}
