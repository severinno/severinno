export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest, forbidden, notFound } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { z } from "zod"
import { sanitizeText } from "@/lib/sanitize"

import { withParams } from "@/lib/api-route"

const disputeSchema = z.object({
  reason: z.string().min(10, "Descreva o motivo da disputa com pelo menos 10 caracteres"),
})

/**
 * POST /api/bookings/[id]/dispute
 * Client opens a mediation dispute for a booking held in escrow.
 */
export const POST = withParams<{ id: string }>(
  "api.bookings.:id.dispute.POST",
  async (request, { params }) => {
    await assertRateLimit(request, RATE_LIMITS.bookings)
    const session = await requireUser()
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { reason } = disputeSchema.parse(body)

    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        disputes: { where: { status: "OPEN" } },
      },
    })

    if (!booking) throw notFound("Agendamento não encontrado")
    if (booking.clientId !== session.userId && session.role !== "ADMIN") {
      throw forbidden("Apenas o cliente pode abrir uma disputa para este agendamento")
    }

    if (booking.disputes.length > 0) {
      throw badRequest("Já existe uma disputa aberta para este agendamento")
    }

    const [dispute] = await db.$transaction([
      db.dispute.create({
        data: {
          bookingId: id,
          reason: sanitizeText(reason),
          status: "OPEN",
        },
      }),
      db.booking.update({
        where: { id },
        data: {
          escrowDisputeReason: sanitizeText(reason),
        },
      }),
    ])

    return NextResponse.json(
      {
        ok: true,
        message:
          "Disputa registrada com sucesso. Nossa equipe de mediação analisará o caso em até 48h.",
        dispute,
      },
      { status: 201 },
    )
  },
)
