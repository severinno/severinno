import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest, forbidden, handleError, notFound } from "@/lib/api-server"
import { refundCharge, getCharge, lytexLogger } from "@/lib/lytex"
import {
  notifyBookingStatus,
  notifyCompletionRequest,
  notifyPaymentConfirmed,
} from "@/lib/notifications"
import type { BookingStatus, PaymentStatus } from "@/generated/prisma/enums"

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
        ? (PROVIDER_NEXT[booking.status] ?? [])
        : isClient
          ? (CLIENT_NEXT[booking.status] ?? [])
          : []
    if (!allowed.includes(next)) {
      throw badRequest(`Transição não permitida: ${booking.status} → ${next}`)
    }

    // Side effects on CONFIRM / CANCELLED
    const patch: {
      status: BookingStatus
      paymentStatus?: PaymentStatus
    } = { status: next as BookingStatus }

    // Se provider CONFIRMA sem pagamento ainda, cria cobrança PIX automática
    // (fluxo alternativo: provider "cobra na confirmação")
    if (next === "CONFIRMED" && booking.paymentStatus !== "PAID") {
      // Mantém o fluxo original: agenda sem cobrança prévia
      // O pagamento será feito via POST /api/bookings/[id]/pay
    }

    // Escrow logic: when provider completes service, hold funds in escrow
    if (next === "COMPLETED") {
      if (isProvider) {
        // Provider completed -> funds held in escrow awaiting client confirmation
        patch.paymentStatus = "HELD"
      } else {
        // Client or Admin marked completed -> funds released immediately
        patch.paymentStatus = "PAID"
      }
    }

    if (
      next === "CANCELLED" &&
      (booking.paymentStatus === "PAID" || booking.paymentStatus === "HELD")
    ) {
      // Tentar estornar no Lytex
      const payment = await db.payment.findUnique({
        where: { bookingId: id },
        select: { lytexId: true, status: true, method: true },
      })

      if (payment?.lytexId) {
        try {
          // Primeiro consulta o status atual no Lytex
          const charge = await getCharge(payment.lytexId)

          if (charge.status === "paid") {
            await refundCharge(payment.lytexId)
            lytexLogger.info(
              { bookingId: id, lytexId: payment.lytexId },
              "Cancel: reembolso solicitado no Lytex",
            )
          }
        } catch (e) {
          lytexLogger.error({ err: e, bookingId: id }, "Cancel: erro ao estornar no Lytex")
          // Se falhou, ainda atualiza o status local (reembolso manual pode ser necessário)
        }
      }

      patch.paymentStatus = "REFUNDED"
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

    // Sync payment record if needed — now includes lytexStatus update
    if (patch.paymentStatus && updated.payment) {
      await db.payment.update({
        where: { bookingId: id },
        data: {
          status: patch.paymentStatus,
          ...(patch.paymentStatus === "REFUNDED" ? { lytexStatus: "refunded" } : {}),
        },
      })
    }

    // Notificar as partes sobre a mudança de status (best-effort)
    const newStatus = next
    const serviceName = updated.service?.title ?? "Serviço"

    if (next === "COMPLETED" && isProvider) {
      // Pedir ao cliente para confirmar conclusão e liberar custódia
      notifyCompletionRequest(updated.clientId, id, updated.provider.name).catch(() => {})
    } else if (next === "COMPLETED" && !isProvider) {
      // Liberou pagamento
      notifyPaymentConfirmed(updated.providerId, id, updated.amount).catch(() => {})
    }

    // Notificar o cliente
    notifyBookingStatus(updated.clientId, id, newStatus, serviceName).catch(() => {})

    // Notificar o provider (se não for o mesmo que o cliente)
    if (updated.clientId !== updated.providerId) {
      notifyBookingStatus(updated.providerId, id, newStatus, serviceName).catch(() => {})
    }

    return NextResponse.json({ booking: updated })
  } catch (e) {
    return handleError(e)
  }
}
