import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, handleError, notFound } from "@/lib/api-server"

type Params = { params: Promise<{ id: string }> }

// Owner: mark a notification as read
export async function PATCH(_request: Request, { params }: Params) {
  try {
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
