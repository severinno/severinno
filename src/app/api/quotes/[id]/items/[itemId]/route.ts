export const dynamic = "force-dynamic"

import logger from "@/lib/logger"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { sanitizeText } from "@/lib/sanitize"
import { quoteItemResponseSchema } from "@/lib/validators"
import { forbidden, handleError, notFound } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { notifyQuoteResponse } from "@/lib/notifications"

type Params = { params: Promise<{ id: string; itemId: string }> }

// PROVIDER (the item's provider): respond with price/note/status.
// Sets request status to RESPONDED.
export async function PATCH(request: Request, { params }: Params) {
  try {
    await assertRateLimit(request, RATE_LIMITS.bookings)
    const session = await requireUser()
    const { id, itemId } = await params

    const item = await db.quoteItem.findUnique({
      where: { id: itemId },
      include: { request: { select: { id: true, status: true } } },
    })
    if (!item) throw notFound("Item de orçamento não encontrado")
    if (item.requestId !== id) {
      throw notFound("Item não pertence a este orçamento")
    }
    if (item.providerId !== session.userId && session.role !== "ADMIN") {
      throw forbidden("Apenas o prestador do item pode respondê-lo")
    }

    const body = await request.json()
    const data = quoteItemResponseSchema.parse(body)

    const updated = await db.quoteItem.update({
      where: { id: itemId },
      data: {
        price: data.price,
        providerNote: data.providerNote ? sanitizeText(data.providerNote) : null,
        status: data.status,
      },
    })

    // Update parent request status to RESPONDED (if still PENDING)
    const wasPending = item.request.status === "PENDING"
    if (wasPending) {
      await db.quoteRequest.update({
        where: { id },
        data: { status: "RESPONDED" },
      })
    }

    // Notificar cliente sobre resposta (best-effort)
    if (wasPending && data.price) {
      const quote = await db.quoteRequest.findUnique({
        where: { id },
        select: {
          clientId: true,
          provider: { select: { name: true } },
        },
      })
      if (quote) {
        notifyQuoteResponse(
          quote.clientId,
          id,
          quote.provider?.name ?? "Prestador",
          data.price,
        ).catch((err) => logger.warn({ err }, "quote item notification failed"))
      }
    }

    return NextResponse.json({ item: updated })
  } catch (e) {
    return handleError(e)
  }
}
