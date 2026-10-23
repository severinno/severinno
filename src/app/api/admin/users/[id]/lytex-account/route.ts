export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { badRequest, notFound } from "@/lib/api-server"
import logger from "@/lib/logger"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withParams } from "@/lib/api-route"

export const POST = withParams<{ id: string }>(
  "api.admin.users.:id.lytex-account.POST",
  async (request, { params }) => {
    await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.admin)
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
  },
)

export const DELETE = withParams<{ id: string }>(
  "api.admin.users.:id.lytex-account.DELETE",
  async (_request, { params }) => {
    await requireRole("ADMIN")
    await assertRateLimit(_request, RATE_LIMITS.admin)
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
  },
)
