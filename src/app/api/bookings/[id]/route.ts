import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import {
  badRequest,
  forbidden,
  handleError,
  notFound,
} from "@/lib/api-server"

type Params = { params: Promise<{ id: string }> }

// Allowed status transitions for the MVP.
// - PROVIDER: PENDING -> CONFIRMED, * -> IN_PROGRESS, * -> CANCELLED
// - CLIENT: PENDING/CONFIRMED -> CANCELLED, CONFIRMED/IN_PROGRESS -> COMPLETED
// - ADMIN: any
const PROVIDER_NEXT: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "IN_PROGRESS", "CANCELLED"],
  CONFIRMED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["CANCELLED"],
}
const CLIENT_NEXT: Record<string, string[]> = {
  PENDING: ["CANCELLED"],
  CONFIRMED: ["CANCELLED", "COMPLETED"],
  IN_PROGRESS: ["COMPLETED"],
}

// Participant: get a booking
export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireUser()
    const { id } = await params

    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        service: true,
        provider: { select: { id: true, name: true, avatarUrl: true, whatsapp: true } },
        client: { select: { id: true, name: true, avatarUrl: true, whatsapp: true } },
        reviews: true,
        payment: true,
      },
    })
    if (!booking) throw notFound("Agendamento não encontrado")

    const isParticipant =
      booking.clientId === session.userId ||
      booking.providerId === session.userId ||
      session.role === "ADMIN"
    if (!isParticipant) throw forbidden("Acesso negado a este agendamento")

    return NextResponse.json({ booking })
  } catch (e) {
    return handleError(e)
  }
}

// Participant: update status
export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireUser()
    const { id } = await params

    const booking = await db.booking.findUnique({
      where: { id },
      select: { id: true, clientId: true, providerId: true, status: true, paymentStatus: true },
    })
    if (!booking) throw notFound("Agendamento não encontrado")

    const isClient = booking.clientId === session.userId
    const isProvider = booking.providerId === session.userId
    const isAdmin = session.role === "ADMIN"
    if (!isClient && !isProvider && !isAdmin) {
      throw forbidden("Acesso negado a este agendamento")
    }

    const body = await request.json()
    const next = String(body?.status || "").toUpperCase()
    if (!next) throw badRequest("Informe o novo status")

    // Validate transition
    const allowed = isAdmin
      ? ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]
      : isProvider
        ? PROVIDER_NEXT[booking.status] ?? []
        : isClient
          ? CLIENT_NEXT[booking.status] ?? []
          : []
    if (!allowed.includes(next)) {
      throw badRequest(
        `Transição não permitida: ${booking.status} → ${next}`,
      )
    }

    // Side effects on CONFIRM / COMPLETED / CANCELLED
    const patch: {
      status: string
      paymentStatus?: string
    } = { status: next }

    if (next === "CONFIRMED" && booking.paymentStatus !== "PAID") {
      // Simulate payment capture on confirm
      patch.paymentStatus = "PAID"
    }
    if (next === "CANCELLED") {
      // Refund if it was paid
      if (booking.paymentStatus === "PAID") {
        patch.paymentStatus = "REFUNDED"
      }
    }

    const updated = await db.booking.update({
      where: { id },
      data: patch,
      include: {
        service: true,
        provider: { select: { id: true, name: true, avatarUrl: true } },
        client: { select: { id: true, name: true, avatarUrl: true } },
        payment: true,
        reviews: true,
      },
    })

    // Sync payment record if needed
    if (patch.paymentStatus && updated.payment) {
      await db.payment.update({
        where: { bookingId: id },
        data: { status: patch.paymentStatus },
      })
    }

    return NextResponse.json({ booking: updated })
  } catch (e) {
    return handleError(e)
  }
}
