import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import {
  badRequest,
  forbidden,
  handleError,
  notFound,
} from "@/lib/api-server"
import { randomUUID } from "crypto"

type Params = { params: Promise<{ id: string }> }

// CLIENT (booking owner): simulate a successful payment.
// Sets paymentStatus=PAID; allows booking to move to CONFIRMED.
export async function POST(_request: Request, { params }: Params) {
  try {
    const session = await requireUser()
    const { id } = await params

    const booking = await db.booking.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        status: true,
        paymentStatus: true,
        amount: true,
        paymentMethod: true,
      },
    })
    if (!booking) throw notFound("Agendamento não encontrado")
    if (booking.clientId !== session.userId && session.role !== "ADMIN") {
      throw forbidden("Apenas o cliente pode pagar este agendamento")
    }
    if (booking.status === "CANCELLED") {
      throw badRequest("Agendamento cancelado")
    }
    if (booking.paymentStatus === "PAID") {
      throw badRequest("Pagamento já realizado")
    }

    const transactionId = `SIM-${randomUUID().slice(0, 8).toUpperCase()}`

    await db.payment.upsert({
      where: { bookingId: id },
      create: {
        bookingId: id,
        amount: booking.amount,
        method: booking.paymentMethod,
        status: "PAID",
        transactionId,
      },
      update: { status: "PAID", transactionId },
    })

    const updated = await db.booking.update({
      where: { id },
      data: { paymentStatus: "PAID" },
      include: {
        service: true,
        provider: { select: { id: true, name: true, avatarUrl: true } },
        client: { select: { id: true, name: true, avatarUrl: true } },
        payment: true,
        reviews: true,
      },
    })

    return NextResponse.json({ ok: true, booking: updated })
  } catch (e) {
    return handleError(e)
  }
}
