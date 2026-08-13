import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { bookingSchema } from "@/lib/validators"
import {
  badRequest,
  forbidden,
  handleError,
  notFound,
  parsePagination,
} from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { notifyNewBooking } from "@/lib/notifications"

// CLIENT: create a booking + a PENDING payment record
export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.bookings)
    const session = await requireUser()
    if (session.role !== "CLIENT") {
      throw forbidden("Apenas clientes podem agendar serviços")
    }
    const body = await request.json()
    const data = bookingSchema.parse(body)

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

    // amount: use payload if provided, otherwise service.basePrice
    const amount = Number.isFinite(body?.amount) ? Number(body.amount) : service.basePrice

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

    // Notificar provider via WhatsApp + in-app (best-effort)
    notifyNewBooking(
      session.userId,
      data.providerId,
      booking.id,
      service.title,
      data.scheduledAt,
      booking.client?.name ?? "Cliente",
    ).catch(() => {})

    return NextResponse.json({ booking }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}

// Any user: list bookings relevant to them
export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.bookings)
    const session = await requireUser()
    const { searchParams } = new URL(request.url)
    const role = (searchParams.get("role") || session.role) as
      | "CLIENT"
      | "PROVIDER"
      | "ADMIN"
    const status = searchParams.get("status") as any
    const { page, limit, skip, take } = parsePagination(searchParams)

    const where: any =
      role === "CLIENT"
        ? { clientId: session.userId, ...(status ? { status } : {}) }
        : role === "PROVIDER"
          ? { providerId: session.userId, ...(status ? { status } : {}) }
          : { ...(status ? { status } : {}) } // ADMIN sees all

    const [items, total] = await Promise.all([
      db.booking.findMany({
        where,
        include: {
          service: true,
          provider: {
            select: { id: true, name: true, avatarUrl: true, whatsapp: true },
          },
          client: { select: { id: true, name: true, avatarUrl: true } },
          reviews: true,
          payment: true,
        },
        orderBy: { scheduledAt: "desc" },
        skip,
        take,
      }),
      db.booking.count({ where }),
    ])

    return NextResponse.json({ items, total, page, limit })
  } catch (e) {
    return handleError(e)
  }
}
