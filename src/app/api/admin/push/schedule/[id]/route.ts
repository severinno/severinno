export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { notFound } from "@/lib/api-server"
import logger from "@/lib/logger"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withParams } from "@/lib/api-route"

/**
 * PATCH /api/admin/push/schedule/[id]
 *
 * Cancela uma notificacao agendada (so pode cancelar se status = "PENDING").
 * Requer role ADMIN.
 *
 * Body:
 *   action — "cancel" (unico suportado por enquanto)
 */
export const PATCH = withParams<{ id: string }>(
  "api.admin.push.schedule.:id.PATCH",
  async (request, { params }) => {
    await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.admin)
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
  },
)
