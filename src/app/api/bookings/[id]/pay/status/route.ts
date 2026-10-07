export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { notFound, forbidden } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withParams } from "@/lib/api-route"
import { toMoneyNumber } from "@/lib/money"

/**
 * GET /api/bookings/[id]/pay/status
 *
 * Polling endpoint for the PIX checkout component.
 * Returns the current payment status without triggering a new charge.
 * Designed for lightweight, frequent polling (every 5s).
 */
export const GET = withParams<{ id: string }>(
  "api.bookings.:id.pay.status.GET",
  async (request, { params }) => {
    const session = await requireUser()
    const { id } = await params

    await assertRateLimit(request, {
      ...RATE_LIMITS.general,
      prefix: `pay-status:${id}`,
    })

    const booking = await db.booking.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        paymentStatus: true,
        paymentMethod: true,
        amount: true,
        payment: {
          select: {
            status: true,
            lytexStatus: true,
            paidAt: true,
            qrCode: true,
            qrCodeImage: true,
            lytexId: true,
          },
        },
      },
    })

    if (!booking) throw notFound("Agendamento não encontrado")
    if (booking.clientId !== session.userId && session.role !== "ADMIN") {
      throw forbidden("Acesso restrito")
    }

    const payment = booking.payment

    return NextResponse.json({
      bookingId: id,
      paymentMethod: booking.paymentMethod,
      paymentStatus: booking.paymentStatus,
      // money_decimal: Decimal → number na fronteira (cru serializa string)
      amount: toMoneyNumber(booking.amount),
      payment: payment
        ? {
            status: payment.status,
            lytexStatus: payment.lytexStatus,
            paidAt: payment.paidAt,
            qrCode: payment.qrCode,
            qrCodeImage: payment.qrCodeImage,
            lytexId: payment.lytexId,
          }
        : null,
    })
  },
)
