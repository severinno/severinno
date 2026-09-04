export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, handleError, notFound } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

type Params = { params: Promise<{ id: string }> }

// Owner: mark a notification as read
export async function PATCH(request: Request, { params }: Params) {
  try {
    await assertRateLimit(request, RATE_LIMITS.general)
    const session = await requireUser()
    const { id } = await params

    const notification = await db.notification.findUnique({
      where: { id },
      select: { id: true, userId: true },
    })
    if (!notification) throw notFound("Notificação não encontrada")
    if (notification.userId !== session.userId && session.role !== "ADMIN") {
      throw forbidden("Acesso negado")
    }

    const updated = await db.notification.update({
      where: { id },
      data: { read: true },
    })
    return NextResponse.json({ notification: updated })
  } catch (e) {
    return handleError(e)
  }
}
