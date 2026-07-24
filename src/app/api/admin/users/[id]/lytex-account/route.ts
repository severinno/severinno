import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { handleError, badRequest, notFound, forbidden } from "@/lib/api-server"
import logger from "@/lib/logger"

type Params = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  try {
    const session = await requireUser()
    if (session.role !== "ADMIN") throw forbidden("Acesso restrito a administradores")

    const { id } = await params
    const body = await request.json()
    const { lytexRecipientId } = body

    if (!lytexRecipientId || typeof lytexRecipientId !== "string") {
      throw badRequest("lytexRecipientId é obrigatório")
    }

    const user = await db.user.findUnique({ where: { id } })
    if (!user) throw notFound("Usuário não encontrado")

    const updated = await db.user.update({
      where: { id },
      data: { lytexRecipientId },
      select: { id: true, name: true, lytexRecipientId: true },
    })

    logger.info({ userId: id, lytexRecipientId }, "admin linked lytex sub-account")
    return NextResponse.json({ user: updated })
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const session = await requireUser()
    if (session.role !== "ADMIN") throw forbidden("Acesso restrito a administradores")

    const { id } = await params

    const user = await db.user.findUnique({ where: { id } })
    if (!user) throw notFound("Usuário não encontrado")

    const updated = await db.user.update({
      where: { id },
      data: { lytexRecipientId: null },
      select: { id: true, name: true },
    })

    logger.info({ userId: id }, "admin unlinked lytex sub-account")
    return NextResponse.json({ user: updated })
  } catch (e) {
    return handleError(e)
  }
}
