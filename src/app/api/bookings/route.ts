import logger from "@/lib/logger"
import { NextResponse } from "next/server"
import { type BookingStatus } from "@prisma/client"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { bookingSchema } from "@/lib/validators"
import { badRequest, forbidden, handleError, notFound, parsePagination } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { notifyNewBooking } from "@/lib/notifications"
import { traceSpan } from "@/lib/tracing"

// CLIENT: create a booking + a PENDING payment record
export async function POST(request: Request) {
  return traceSpan("api.bookings.POST", async (span) => {
    try {
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

      // amount: always use server-side price to prevent client-side override
      const amount = service.basePrice
      span.setAttribute("booking.amount", amount)

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

      return NextResponse.json({ booking }, { status: 201 })
    } catch (e) {
      return handleError(e)
    }
  })
}

// Any user: list bookings relevant to them
export async function GET(request: Request) {
  return traceSpan("api.bookings.GET", async (span) => {
    try {
      await assertRateLimit(request, RATE_LIMITS.bookings)
      const session = await requireUser()
      const { searchParams } = new URL(request.url)
      const role = (searchParams.get("role") || session.role) as "CLIENT" | "PROVIDER" | "ADMIN"
      const status = (searchParams.get("status") || undefined) as BookingStatus | undefined
      const { page, limit, skip, take } = parsePagination(searchParams)
      span.setAttribute("booking.role", role)
      span.setAttribute("booking.status", status ?? "all")
      span.setAttribute("booking.page", page)

      const where =
        role === "CLIENT"
          ? { clientId: session.userId, ...(status ? { status } : {}) }
          : role === "PROVIDER"
            ? { providerId: session.userId, ...(status ? { status } : {}) }
            : { ...(status ? { status } : {}) } // ADMIN sees all

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
      return NextResponse.json({ items, total, page, limit })
    } catch (e) {
      return handleError(e)
    }
  })
}
