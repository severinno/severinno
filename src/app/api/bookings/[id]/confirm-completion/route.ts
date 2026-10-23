export const dynamic = "force-dynamic"

import logger from "@/lib/logger"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest, forbidden, notFound } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { notifyPaymentConfirmed } from "@/lib/notifications"
import { toMoneyNumber } from "@/lib/money"
import { processReferralFirstBookingConversion } from "@/lib/referral"
import { awardPoints } from "@/lib/loyalty"

import { withParams } from "@/lib/api-route"

/**
 * POST /api/bookings/[id]/confirm-completion
 * Client confirms service delivery, releasing escrow funds to provider.
 */
export const POST = withParams<{ id: string }>(
  "api.bookings.:id.confirm-completion.POST",
  async (_request, { params }) => {
    await assertRateLimit(_request, RATE_LIMITS.bookings)
    const session = await requireUser()
    const { id } = await params

    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        service: { select: { title: true } },
        provider: { select: { id: true, name: true } },
      },
    })

    if (!booking) throw notFound("Agendamento não encontrado")
    if (booking.clientId !== session.userId && session.role !== "ADMIN") {
      throw forbidden("Apenas o cliente contratante pode confirmar a conclusão")
    }

    if (booking.status !== "COMPLETED" && booking.status !== "IN_PROGRESS") {
      throw badRequest("O serviço precisa ter sido executado para ser confirmado")
    }

    if (booking.paymentStatus === "PAID" && booking.escrowReleasedAt != null) {
      throw badRequest("A custódia deste agendamento já foi liberada anteriormente")
    }

    const now = new Date()

    // Atualização atômica condicional: só atualiza se escrowReleasedAt ainda for null
    const [bookingUpdateResult] = await db.$transaction([
      db.booking.updateMany({
        where: { id, escrowReleasedAt: null },
        data: {
          status: "COMPLETED",
          paymentStatus: "PAID",
          escrowReleasedAt: now,
        },
      }),
      db.payment.updateMany({
        where: { bookingId: id, status: { not: "PAID" } },
        data: {
          status: "PAID",
          paidAt: now,
        },
      }),
    ])

    if (bookingUpdateResult.count === 0) {
      throw badRequest(
        "A custódia deste agendamento já foi liberada por outra operação concorrente",
      )
    }

    const updated = await db.booking.findUnique({
      where: { id },
      include: {
        service: true,
        provider: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
      },
    })

    // Notify provider that escrow was released
    notifyPaymentConfirmed(booking.providerId, booking.id, toMoneyNumber(booking.amount)).catch(
      (err) => logger.warn({ err }, "payment notification failed (fire-and-forget)"),
    )

    // Trigger referral first booking conversion check for client & provider
    processReferralFirstBookingConversion(booking.id, booking.clientId, booking.providerId).catch(
      (err) => logger.warn({ err }, "referral conversion check failed (fire-and-forget)"),
    )

    // Award loyalty points to both client and provider for completing the booking (+10 pts)
    awardPoints(booking.clientId, "booking_completed").catch((err) =>
      logger.warn({ err }, "loyalty points award for client failed (fire-and-forget)"),
    )
    awardPoints(booking.providerId, "booking_completed").catch((err) =>
      logger.warn({ err }, "loyalty points award for provider failed (fire-and-forget)"),
    )

    return NextResponse.json({
      ok: true,
      message: "Conclusão confirmada e pagamento liberado ao prestador com sucesso!",
      pointsAwarded: 10,
      booking: updated,
    })
  },
)
