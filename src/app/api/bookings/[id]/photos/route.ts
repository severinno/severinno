import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { sanitizeText } from "@/lib/sanitize"
import { forbidden, handleError, notFound } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { z } from "zod"

type Params = { params: Promise<{ id: string }> }

const photosSchema = z.object({
  type: z.enum(["before", "after"]),
  photos: z
    .array(z.string().url("URL de foto inválida"))
    .min(1, "Envie pelo menos 1 foto")
    .max(4, "Máximo de 4 fotos"),
  completionNote: z.string().optional(),
})

/**
 * POST /api/bookings/[id]/photos
 * Provider or client uploads before/after service photos for proof.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    await assertRateLimit(request, RATE_LIMITS.bookings)
    const session = await requireUser()
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { type, photos, completionNote } = photosSchema.parse(body)

    const booking = await db.booking.findUnique({
      where: { id },
      select: { id: true, clientId: true, providerId: true, beforePhotos: true, afterPhotos: true },
    })

    if (!booking) throw notFound("Agendamento não encontrado")
    const isParticipant =
      booking.clientId === session.userId ||
      booking.providerId === session.userId ||
      session.role === "ADMIN"

    if (!isParticipant) throw forbidden("Acesso negado a este agendamento")

    const updateData: Record<string, string | string[]> = {}

    if (type === "before") {
      updateData.beforePhotos = photos
    } else {
      updateData.afterPhotos = photos
      if (completionNote) {
        updateData.completionNote = sanitizeText(completionNote)
      }
    }

    const updated = await db.booking.update({
      where: { id },
      data: updateData as Record<string, never>,
      select: {
        id: true,
        beforePhotos: true,
        afterPhotos: true,
        completionNote: true,
      },
    })

    return NextResponse.json({
      ok: true,
      message: `Fotos do ${type === "before" ? "antes" : "depois"} salvas com sucesso!`,
      booking: updated,
    })
  } catch (e) {
    return handleError(e)
  }
}
