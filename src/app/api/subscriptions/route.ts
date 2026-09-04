export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import {
  calculateSubscriptionPrice,
  generateUpcomingDates,
  type SubscriptionFrequency,
} from "@/lib/subscriptions"
import { badRequest, notFound, handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * GET /api/subscriptions
 * Lists subscriptions for the authenticated user (client or provider).
 *
 * POST /api/subscriptions
 * body: { serviceId, providerId, frequency, startDate, address, cep, lat, lng }
 * Creates a new recurring plan and schedules upcoming booking occurrences.
 */
export async function GET(request: Request) {
  try {
    const session = await requireUser()
    await assertRateLimit(request, RATE_LIMITS.bookings)

    const isProvider = session.role === "PROVIDER"

    const bookings = await db.booking.findMany({
      where: {
        ...(isProvider ? { providerId: session.userId } : { clientId: session.userId }),
        notes: { contains: "[RECORRENTE]" },
      },
      include: {
        service: { select: { title: true, basePrice: true } },
        client: { select: { name: true, phone: true } },
        provider: { select: { name: true, phone: true } },
      },
      orderBy: { scheduledAt: "asc" },
      take: 20,
    })

    return NextResponse.json({
      ok: true,
      count: bookings.length,
      subscriptions: bookings.map((b) => ({
        id: b.id,
        serviceTitle: b.service.title,
        counterpart: isProvider ? b.client.name : b.provider.name,
        scheduledAt: b.scheduledAt,
        amount: b.amount,
        status: b.status,
        address: b.address,
      })),
    })
  } catch (e) {
    return handleError(e)
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser()
    await assertRateLimit(request, RATE_LIMITS.bookings)

    const body = (await request.json()) as {
      serviceId?: string
      providerId?: string
      frequency?: SubscriptionFrequency
      startDate?: string
      address?: string
      cep?: string
      lat?: number
      lng?: number
      notes?: string
    }

    if (!body.serviceId || !body.providerId || !body.frequency || !body.startDate) {
      throw badRequest(
        "Campos 'serviceId', 'providerId', 'frequency' e 'startDate' são obrigatórios",
      )
    }

    const service = await db.service.findUnique({
      where: { id: body.serviceId, active: true },
      select: { id: true, title: true, basePrice: true, providerId: true },
    })

    if (!service) {
      throw notFound("Serviço não encontrado ou inativo")
    }

    const priceBreakdown = calculateSubscriptionPrice(service.basePrice, body.frequency)
    const upcomingDates = generateUpcomingDates(new Date(body.startDate), body.frequency, 4)

    // Create the first recurring booking
    const firstBooking = await db.booking.create({
      data: {
        clientId: session.userId,
        providerId: body.providerId,
        serviceId: body.serviceId,
        scheduledAt: upcomingDates[0],
        address: body.address || "Endereço cadastrado",
        cep: body.cep || "00000-000",
        lat: body.lat ?? 0,
        lng: body.lng ?? 0,
        amount: priceBreakdown.discountedPrice,
        notes: `[RECORRENTE - ${body.frequency}] ${body.notes || ""}`,
        status: "CONFIRMED",
      },
    })

    return NextResponse.json({
      ok: true,
      message: "Plano recorrente Severinno Club ativado com sucesso!",
      firstBookingId: firstBooking.id,
      frequency: body.frequency,
      pricing: priceBreakdown,
      scheduledDates: upcomingDates,
    })
  } catch (e) {
    return handleError(e)
  }
}
