import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest, forbidden, handleError, notFound } from "@/lib/api-server"
import { saveAndQueueNotification } from "@/lib/notification-queue"
import { captureError } from "@/lib/sentry"
import { emitRealtime } from "@/lib/realtime-client"
import logger from "@/lib/logger"

type Params = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  try {
    const session = await requireUser()
    const { id } = await params
    if (session.role !== "CLIENT") {
      throw forbidden("Apenas clientes podem agendar serviços")
    }

    const client = await db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, name: true },
    })
    if (!client) throw notFound("Usuário não encontrado")

    const quote = await db.quoteRequest.findUnique({
      where: { id },
      include: {
        items: {
          select: { id: true, serviceId: true, price: true, status: true },
        },
        provider: {
          select: { id: true, name: true, email: true },
        },
      },
    })
    if (!quote) throw notFound("Orçamento não encontrado")
    if (quote.clientId !== session.userId) throw forbidden("Este orçamento não é seu")
    if (quote.status !== "APPROVED") throw badRequest("Orçamento precisa estar aprovado")

    const body = (await request.json()) as { scheduledAt?: string; address?: string }
    if (!body.scheduledAt) throw badRequest("Data e horário são obrigatórios")

    const scheduleDate = new Date(body.scheduledAt)
    if (isNaN(scheduleDate.getTime())) throw badRequest("Data inválida")
    if (scheduleDate <= new Date()) throw badRequest("A data deve ser futura")

    const amount = quote.items.reduce((sum, item) => sum + (item.price ?? 0), 0)
    if (amount <= 0) throw badRequest("Valor do orçamento inválido")

    const firstQuoted = quote.items.find((i) => i.status === "ACCEPTED" || i.price != null)
    if (!firstQuoted) throw badRequest("Nenhum item com preço no orçamento")

    // Atomic: create booking + accept quote items
    const [booking] = await db.$transaction([
      db.booking.create({
        data: {
          clientId: session.userId,
          providerId: quote.providerId,
          serviceId: firstQuoted.serviceId,
          scheduledAt: scheduleDate,
          amount,
          address: body.address ?? quote.address,
          cep: quote.cep,
          lat: quote.lat,
          lng: quote.lng,
          status: "PENDING",
          quoteId: id,
        },
        include: {
          service: { select: { id: true, title: true } },
          provider: { select: { id: true, name: true, avatarUrl: true } },
          client: { select: { id: true, name: true } },
        },
      }),
      db.quoteItem.updateMany({
        where: { requestId: id, status: "QUOTED" },
        data: { status: "ACCEPTED" },
      }),
    ])

    // Notify provider
    saveAndQueueNotification({
      userId: quote.providerId,
      type: "BOOKING_CONFIRMED",
      title: "Novo agendamento!",
      body: `${client.name} agendou um serviço baseado no orçamento.`,
      pushUrl: `/dashboard?booking=${booking.id}`,
    }).catch((e) => {
      logger.error(
        { err: e, bookingId: booking.id },
        "failed to notify provider after quote booking",
      )
    })

    emitRealtime("booking:update", {
      bookingId: booking.id,
      clientId: session.userId,
      providerId: quote.providerId,
      status: "PENDING",
    }).catch((err) => {
      captureError(err, { bookingId: booking.id, context: "quote book realtime" })
    })

    return NextResponse.json({ booking }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}
