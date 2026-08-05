import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest, forbidden, handleError, notFound } from "@/lib/api-server"

type Params = { params: Promise<{ id: string }> }

// Participant: get a quote
export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireUser()
    const { id } = await params

    const quote = await db.quoteRequest.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            service: true,
            provider: {
              select: { id: true, name: true, avatarUrl: true },
            },
          },
        },
        provider: { select: { id: true, name: true, avatarUrl: true } },
        client: { select: { id: true, name: true, avatarUrl: true } },
      },
    })
    if (!quote) throw notFound("Orçamento não encontrado")

    const isParticipant =
      quote.clientId === session.userId ||
      quote.providerId === session.userId ||
      quote.items.some((i) => i.providerId === session.userId) ||
      session.role === "ADMIN"
    if (!isParticipant) throw forbidden("Acesso negado a este orçamento")

    return NextResponse.json({ quote })
  } catch (e) {
    return handleError(e)
  }
}

// CLIENT: update request status (APPROVED / REJECTED / CANCELLED)
export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireUser()
    const { id } = await params

    const quote = await db.quoteRequest.findUnique({
      where: { id },
      select: { id: true, clientId: true, status: true },
    })
    if (!quote) throw notFound("Orçamento não encontrado")
    if (quote.clientId !== session.userId && session.role !== "ADMIN") {
      throw forbidden("Apenas o cliente pode alterar o status")
    }

    const body = await request.json()
    const status = String(body?.status || "").toUpperCase()
    if (!["APPROVED", "REJECTED", "CANCELLED"].includes(status)) {
      throw badRequest("Status inválido")
    }

    const updated = await db.quoteRequest.update({
      where: { id },
      data: { status },
      include: {
        items: { include: { service: true } },
        provider: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json({ quote: updated })
  } catch (e) {
    return handleError(e)
  }
}
