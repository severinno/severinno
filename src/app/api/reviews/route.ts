import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { reviewSchema } from "@/lib/validators";
import { badRequest, forbidden, handleError, notFound } from "@/lib/api-server";

// Public: list reviews (filter by providerId or bookingId)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("providerId") || undefined;
    const bookingId = searchParams.get("bookingId") || undefined;

    const reviews = await db.review.findMany({
      where: {
        ...(providerId ? { providerId } : {}),
        ...(bookingId ? { bookingId } : {}),
      },
      include: {
        client: { select: { id: true, name: true, avatarUrl: true } },
        booking: { select: { id: true, serviceId: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ items: reviews, total: reviews.length });
  } catch (e) {
    return handleError(e);
  }
}

// CLIENT: create a review for a completed booking (one per booking)
export async function POST(request: Request) {
  try {
    const session = await requireUser();
    if (session.role !== "CLIENT") {
      throw forbidden("Apenas clientes podem avaliar");
    }
    const body = await request.json();
    const data = reviewSchema.parse(body);

    const booking = await db.booking.findUnique({
      where: { id: data.bookingId },
      select: {
        id: true,
        clientId: true,
        providerId: true,
        serviceId: true,
        status: true,
      },
    });
    if (!booking) throw notFound("Agendamento não encontrado");
    if (booking.clientId !== session.userId) {
      throw forbidden("Você só pode avaliar seus próprios agendamentos");
    }
    if (booking.status !== "COMPLETED") {
      throw badRequest("Só é possível avaliar agendamentos concluídos");
    }

    const existing = await db.review.findUnique({
      where: { bookingId: booking.id },
      select: { id: true },
    });
    if (existing) {
      throw badRequest("Este agendamento já foi avaliado");
    }

    const review = await db.review.create({
      data: {
        bookingId: booking.id,
        clientId: session.userId,
        providerId: booking.providerId,
        serviceId: booking.serviceId,
        rating: data.rating,
        comment: data.comment || null,
      },
      include: {
        client: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
    return NextResponse.json({ review }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
