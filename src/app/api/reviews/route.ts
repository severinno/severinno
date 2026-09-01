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

// CLIENT or PROVIDER: create/update a review for a completed booking
// Client reviews provider (rating + comment)
// Provider reviews client (providerRating + providerComment) — bidirectional
export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.reviews)
    const session = await requireUser()
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
    if (booking.status !== "COMPLETED") {
      throw badRequest("Só é possível avaliar agendamentos concluídos")
    }

    // ── Provider rating the client (bidirectional) ────────────────────────
    if (session.role === "PROVIDER") {
      if (booking.providerId !== session.userId) {
        throw forbidden("Você só pode avaliar seus próprios agendamentos")
      }
      if (!data.providerRating) {
        throw badRequest("Rating do provider é obrigatório")
      }

      const existing = await db.review.findUnique({
        where: { bookingId: booking.id },
        select: { id: true, providerRating: true },
      })
      if (existing?.providerRating) {
        throw badRequest("Este agendamento já foi avaliado pelo prestador")
      }

      // Update existing review or create new one
      if (existing) {
        const review = await db.review.update({
          where: { bookingId: booking.id },
          data: {
            providerRating: data.providerRating,
            providerComment: data.providerComment ? sanitizeText(data.providerComment) : null,
          },
        })
        fireEvent("review.created", { reviewId: review.id, bookingId: booking.id })
        return NextResponse.json({ review }, { status: 200 })
      }

      // Create review with only provider side (client hasn't reviewed yet)
      const review = await db.review.create({
        data: {
          bookingId: booking.id,
          clientId: booking.clientId,
          providerId: session.userId,
          serviceId: booking.serviceId,
          rating: 0, // placeholder — client hasn't reviewed yet
          providerRating: data.providerRating,
          providerComment: data.providerComment ? sanitizeText(data.providerComment) : null,
        },
      })
      fireEvent("review.created", { reviewId: review.id, bookingId: booking.id })
      return NextResponse.json({ review }, { status: 201 })
    }

    // ── Client rating the provider (original flow) ───────────────────────
    if (session.role !== "CLIENT") {
      throw forbidden("Apenas clientes e prestadores podem avaliar")
    }
    if (booking.clientId !== session.userId) {
      throw forbidden("Você só pode avaliar seus próprios agendamentos")
    }

    const existing = await db.review.findUnique({
      where: { bookingId: booking.id },
      select: { id: true, rating: true },
    })
    if (existing && existing.rating > 0) {
      throw badRequest("Este agendamento já foi avaliado")
    }

    // Update existing review (provider rated first) or create new
    if (existing) {
      const review = await db.review.update({
        where: { bookingId: booking.id },
        data: {
          rating: data.rating,
          comment: data.comment ? sanitizeText(data.comment) : null,
        },
      })
      fireEvent("review.created", { reviewId: review.id, bookingId: booking.id })
      return NextResponse.json({ review }, { status: 200 })
    }

    const rating = data.rating ?? 0
    if (rating <= 0) {
      throw badRequest("Rating do cliente é obrigatório")
    }

    const review = await db.review.create({
      data: {
        bookingId: booking.id,
        clientId: session.userId,
        providerId: booking.providerId,
        serviceId: booking.serviceId,
        rating,
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
