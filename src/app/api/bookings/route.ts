export const dynamic = "force-dynamic"

import logger from "@/lib/logger"
import { NextResponse } from "next/server"
import { type BookingStatus } from "@prisma/client"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { bookingSchema } from "@/lib/validators"
import { badRequest, forbidden, notFound, parsePagination } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { notifyNewBooking } from "@/lib/notifications"
import { checkAndNotifyBookingSlotFit } from "@/lib/slot-fit-notifications"
import { withRoute } from "@/lib/api-route"
import { toMoneyNumber } from "@/lib/money"

// CLIENT: create a booking + a PENDING payment record
export const POST = withRoute("api.bookings.POST", async (request, { span }) => {
  await assertRateLimit(request, RATE_LIMITS.bookings)
  const session = await requireUser()
  if (session.role !== "CLIENT") {
    throw forbidden("Apenas clientes podem agendar serviços")
  }
  const body = await request.json()
  const data = bookingSchema.parse(body)
  span.setAttribute("booking.serviceId", data.serviceId)
  span.setAttribute("booking.providerId", data.providerId)
  span.setAttribute("booking.paymentMethod", data.paymentMethod)

  // Validate scheduledAt is in the future
  const scheduledDate = new Date(data.scheduledAt)
  if (isNaN(scheduledDate.getTime())) {
    throw badRequest("Data de agendamento inválida")
  }
  if (scheduledDate <= new Date()) {
    throw badRequest("A data de agendamento deve ser no futuro")
  }

  const service = await db.service.findUnique({
    where: { id: data.serviceId },
    include: { provider: { select: { id: true, verified: true, active: true } } },
  })
  if (!service) throw notFound("Serviço não encontrado")
  if (!service.active) throw badRequest("Serviço inativo")
  if (service.providerId !== data.providerId) {
    throw badRequest("Serviço não pertence ao prestador informado")
  }
  if (!service.provider.verified || !service.provider.active) {
    throw badRequest("Prestador indisponível")
  }
  if (data.providerId === session.userId) {
    throw badRequest("Não é possível agendar com você mesmo")
  }

  // quantity: validada pelo schema (1..1000); unit precisa conferir com o
  // serviço (evita adulteração — Booking não tem coluna unit).
  const quantity = data.quantity ?? 1
  if (data.unit !== undefined && data.unit !== service.unit) {
    throw badRequest("Unidade do serviço divergente")
  }

  // amount: sempre calculado no servidor (basePrice × quantity) para impedir
  // override pelo cliente. O frontend exibe o mesmo cálculo.
  const rawAmount = Number(service.basePrice) * quantity
  const amount = Math.round(rawAmount * 100) / 100 // Decimal(10,2) — sem poeira de float
  span.setAttribute("booking.amount", amount.toString())
  span.setAttribute("booking.quantity", quantity)

  const booking = await db.booking.create({
    data: {
      clientId: session.userId,
      providerId: data.providerId,
      serviceId: data.serviceId,
      scheduledAt: data.scheduledAt,
      status: "PENDING",
      address: data.address,
      cep: data.cep,
      lat: data.lat,
      lng: data.lng,
      amount,
      quantity,
      unit: service.unit,
      paymentMethod: data.paymentMethod,
      paymentStatus: "PENDING",
      notes: data.notes || null,
      payment: {
        create: {
          amount,
          method: data.paymentMethod,
          status: "PENDING",
        },
      },
    },
    include: {
      service: true,
      provider: { select: { id: true, name: true, avatarUrl: true } },
      client: { select: { id: true, name: true, avatarUrl: true } },
      payment: true,
    },
  })

  span.setAttribute("booking.id", booking.id)
  logger.info({ bookingId: booking.id, providerId: data.providerId, amount }, "booking created")

  // Notificar provider via WhatsApp + in-app (best-effort)
  notifyNewBooking(
    session.userId,
    data.providerId,
    booking.id,
    service.title,
    data.scheduledAt,
    booking.client?.name ?? "Cliente",
  ).catch((err) => logger.warn({ err }, "notification failed (fire-and-forget)"))

  // Notificação proativa se for encaixe perfeito na rota do dia
  checkAndNotifyBookingSlotFit(booking.id).catch((err) =>
    logger.warn({ err }, "slot-fit proactive check failed (fire-and-forget)"),
  )

  return NextResponse.json({ booking }, { status: 201 })
})

// Any user: list bookings relevant to them
export const GET = withRoute("api.bookings.GET", async (request, { span }) => {
  await assertRateLimit(request, RATE_LIMITS.bookings)
  const session = await requireUser()
  const { searchParams } = new URL(request.url)
  const role = (searchParams.get("role") || session.role) as "CLIENT" | "PROVIDER" | "ADMIN"
  const status = (searchParams.get("status") || undefined) as BookingStatus | undefined
  const { page, limit, skip, take } = parsePagination(searchParams)

  if (role === "ADMIN" && session.role !== "ADMIN") {
    throw forbidden("Apenas administradores podem visualizar todos os agendamentos")
  }

  span.setAttribute("booking.role", role)
  span.setAttribute("booking.status", status ?? "all")
  span.setAttribute("booking.page", page)

  const where =
    session.role === "ADMIN" && role === "ADMIN"
      ? { ...(status ? { status } : {}) } // ADMIN sees all
      : session.role === "PROVIDER" || role === "PROVIDER"
        ? { providerId: session.userId, ...(status ? { status } : {}) }
        : { clientId: session.userId, ...(status ? { status } : {}) }

  const [items, total] = await Promise.all([
    db.booking.findMany({
      where,
      include: {
        service: { select: { id: true, title: true, photos: true } },
        provider: {
          select: { id: true, name: true, avatarUrl: true, whatsapp: true },
        },
        client: { select: { id: true, name: true, avatarUrl: true } },
        payment: { select: { status: true, amount: true } },
      },
      orderBy: { scheduledAt: "desc" },
      skip,
      take,
    }),
    db.booking.count({ where }),
  ])

  span.setAttribute("booking.resultCount", items.length)
  span.setAttribute("booking.totalCount", total)

  // money_decimal: booking.amount e payment.amount são Decimal no Prisma —
  // serializam como STRING CRU no JSON (concatenação nos dashboards).
  // A fronteira converte para number (contrato JSON do frontend).
  const serialized = items.map((b) => ({
    ...b,
    amount: toMoneyNumber(b.amount),
    payment: b.payment ? { ...b.payment, amount: toMoneyNumber(b.payment.amount) } : b.payment,
  }))

  return NextResponse.json({ items: serialized, total, page, limit })
})
