export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, notFound } from "@/lib/api-server"
import logger from "@/lib/logger"

import { withParams } from "@/lib/api-route"

// DELETE: remove a date block by id (owner or admin only)
export const DELETE = withParams<{ id: string }>(
  "api.availability.blocks.:id.DELETE",
  async (_request, { params }) => {
    const session = await requireUser()
    if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
      throw forbidden("Apenas prestadores e administradores podem remover bloqueios")
    }

    const { id } = await params

    const block = await db.dateBlock.findUnique({ where: { id } })
    if (!block) throw notFound("Bloqueio não encontrado")
    if (block.providerId !== session.userId && session.role !== "ADMIN") {
      throw forbidden("Você não pode remover este bloqueio")
    }

    await db.dateBlock.delete({ where: { id } })

    logger.info({ blockId: id, providerId: session.userId }, "date block deleted")

    return NextResponse.json({ ok: true })
  },
)
