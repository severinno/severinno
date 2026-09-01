import logger from "@/lib/logger"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest, forbidden, handleError, notFound } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { notifyPaymentConfirmed } from "@/lib/notifications"

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/bookings/[id]/confirm-completion
 * Client confirms service delivery, releasing escrow funds to provider.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
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

    const now = new Date()

    // Atomic: booking + payment must both update or neither
    const [updated] = await db.$transaction([
      db.booking.update({
        where: { id },
        data: {
          status: "COMPLETED",
          paymentStatus: "PAID",
          escrowReleasedAt: now,
        },
        include: {
          service: true,
          provider: { select: { id: true, name: true } },
          client: { select: { id: true, name: true } },
        },
      }),
      db.payment.updateMany({
        where: { bookingId: id },
        data: {
          status: "PAID",
          paidAt: now,
        },
      }),
    ])

    // Notify provider that escrow was released
    notifyPaymentConfirmed(booking.providerId, booking.id, booking.amount).catch((err) =>
      logger.warn({ err }, "payment notification failed (fire-and-forget)"),
    )

    return NextResponse.json({
      ok: true,
      message: "Conclusão confirmada e pagamento liberado ao prestador com sucesso!",
      booking: updated,
    })
  } catch (e) {
    return handleError(e)
  }
}
