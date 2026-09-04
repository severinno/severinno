export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest, forbidden, handleError, notFound } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

type Params = { params: Promise<{ id: string }> }

// CLIENT only: toggle favorite
export async function POST(request: Request, { params }: Params) {
  try {
    await assertRateLimit(request, RATE_LIMITS.general)
    const session = await requireUser()
    if (session.role !== "CLIENT") {
      throw forbidden("Apenas clientes podem favoritar prestadores")
    }
    const { id } = await params

    const provider = await db.user.findFirst({
      where: { id, role: "PROVIDER" },
      select: { id: true },
    })
    if (!provider) throw notFound("Prestador não encontrado")
    if (id === session.userId) throw badRequest("Operação inválida")

    const existing = await db.favorite.findUnique({
      where: {
        clientId_providerId: { clientId: session.userId, providerId: id },
      },
      select: { id: true },
    })

    if (existing) {
      await db.favorite.delete({ where: { id: existing.id } })
      return NextResponse.json({ favorited: false })
    }

    await db.favorite.create({
      data: { clientId: session.userId, providerId: id },
    })
    return NextResponse.json({ favorited: true }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}
