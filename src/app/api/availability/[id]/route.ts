import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, handleError, notFound } from "@/lib/api-server"

type Params = { params: Promise<{ id: string }> }

// Owner provider or admin: delete a single availability slot
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const session = await requireUser()
    const { id } = await params

    const slot = await db.providerAvailability.findUnique({
      where: { id },
      select: { id: true, providerId: true },
    })
    if (!slot) throw notFound("Horário não encontrado")

    const isOwner = slot.providerId === session.userId
    const isAdmin = session.role === "ADMIN"
    if (!isOwner && !isAdmin) {
      throw forbidden("Você não tem permissão para remover este horário")
    }

    await db.providerAvailability.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
