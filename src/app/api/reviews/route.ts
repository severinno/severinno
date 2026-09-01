import logger from "@/lib/logger"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { reviewSchema } from "@/lib/validators"
import { parseBody } from "@/lib/api-middleware"
import { badRequest, forbidden, handleError, notFound, parsePagination } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { fireEvent } from "@/lib/event-hub"
import { sanitizeText } from "@/lib/sanitize"

// Public: list reviews (filter by providerId or bookingId)
export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.reviews)
    const { searchParams } = new URL(request.url)
    const providerId = searchParams.get("providerId") || undefined
    const bookingId = searchParams.get("bookingId") || undefined
    const { page, limit, skip, take } = parsePagination(searchParams)

    const where = {
      ...(providerId ? { providerId } : {}),
      ...(bookingId ? { bookingId } : {}),
    }

    const [items, total] = await Promise.all([
      db.review.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, avatarUrl: true } },
          booking: { select: { id: true, serviceId: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      db.review.count({ where }),
    ])

    return NextResponse.json({ items, total, page, limit })
  } catch (e) {
    return handleError(e)
  }
}

// CLIENT: create a review for a completed booking (one per booking)
export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.reviews)
    const session = await requireUser()
    if (session.role !== "CLIENT") {
      throw forbidden("Apenas clientes podem avaliar")
    }
    const data = await parseBody(request, reviewSchema)

    const booking = await db.booking.findUnique({
      where: { id: data.bookingId },
      select: {
        id: true,
        clientId: true,
        providerId: true,
        serviceId: true,
        status: true,
      },
    })
    if (!booking) throw notFound("Agendamento não encontrado")
    if (booking.clientId !== session.userId) {
      throw forbidden("Você só pode avaliar seus próprios agendamentos")
    }
    if (booking.status !== "COMPLETED") {
      throw badRequest("Só é possível avaliar agendamentos concluídos")
    }

    const existing = await db.review.findUnique({
      where: { bookingId: booking.id },
      select: { id: true },
    })
    if (existing) {
      throw badRequest("Este agendamento já foi avaliado")
    }

    const review = await db.review.create({
      data: {
        bookingId: booking.id,
        clientId: session.userId,
        providerId: booking.providerId,
        serviceId: booking.serviceId,
        rating: data.rating,
        comment: data.comment ? sanitizeText(data.comment) : null,
      },
      include: {
        client: { select: { id: true, name: true, avatarUrl: true } },
        booking: {
          select: {
            service: { select: { title: true } },
            provider: { select: { name: true } },
          },
        },
      },
    })

    // 🔔 Fire event webhook for review.created — scoped to the provider who was reviewed
    fireEvent(
      "review.created",
      {
        clientName: review.client.name,
        providerName: review.booking?.provider?.name ?? "",
        serviceName: review.booking?.service?.title ?? "",
        rating: String(review.rating),
        comment: review.comment ?? "",
      },
      { scopedUserIds: [booking.providerId] },
    ).catch((err) => logger.warn({ err }, "review notification failed (fire-and-forget)"))

    return NextResponse.json({ review }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}
