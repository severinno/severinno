import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { quoteItemResponseSchema } from "@/lib/validators"
import {
  forbidden,
  handleError,
  notFound,
} from "@/lib/api-server"

type Params = { params: Promise<{ id: string; itemId: string }> }

// PROVIDER (the item's provider): respond with price/note/status.
// Sets request status to RESPONDED.
export async function PATCH(request: Request, { params }: Params) {
  try {
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
        providerNote: data.providerNote || null,
        status: data.status,
      },
    })

    // Update parent request status to RESPONDED (if still PENDING)
    if (item.request.status === "PENDING") {
      await db.quoteRequest.update({
        where: { id },
        data: { status: "RESPONDED" },
      })
    }

    return NextResponse.json({ item: updated })
  } catch (e) {
    return handleError(e)
  }
}
