export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { sanitizeText } from "@/lib/sanitize"
import { forbidden, notFound } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { z } from "zod"

import { withParams } from "@/lib/api-route"

const photoItemSchema = z.union([
  z.string().url("URL de foto inválida"),
  z.object({
    url: z.string().url("URL de foto inválida"),
    caption: z.string().max(255).optional(),
    timestamp: z.string().optional(),
  }),
])

const checklistItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  checked: z.boolean(),
  category: z.string().optional(),
  required: z.boolean().optional(),
})

const photosSchema = z.object({
  type: z.enum(["before", "after"]),
  photos: z.array(photoItemSchema).min(1, "Envie pelo menos 1 foto").max(8, "Máximo de 8 fotos"),
  completionNote: z.string().optional(),
  checklist: z.array(checklistItemSchema).optional(),
})

/**
 * GET /api/bookings/[id]/photos
 * Returns inspection photos, checklist notes, and verification status.
 */
export const GET = withParams<{ id: string }>(
  "api.bookings.:id.photos.GET",
  async (request, { params }) => {
    await assertRateLimit(request, RATE_LIMITS.bookings)
    const session = await requireUser()
    const { id } = await params

    const booking = await db.booking.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        providerId: true,
        status: true,
        paymentStatus: true,
        beforePhotos: true,
        afterPhotos: true,
        completionNote: true,
        completionPin: true,
        escrowReleasedAt: true,
        createdAt: true,
        updatedAt: true,
        service: {
          select: {
            id: true,
            title: true,
            category: { select: { name: true } },
          },
        },
        provider: { select: { id: true, name: true, phone: true } },
        client: { select: { id: true, name: true, phone: true } },
      },
    })

    if (!booking) throw notFound("Agendamento não encontrado")

    const isParticipant =
      booking.clientId === session.userId ||
      booking.providerId === session.userId ||
      session.role === "ADMIN"

    if (!isParticipant) throw forbidden("Acesso negado a este agendamento")

    return NextResponse.json({
      ok: true,
      booking: {
        ...booking,
        beforePhotos: Array.isArray(booking.beforePhotos) ? booking.beforePhotos : [],
        afterPhotos: Array.isArray(booking.afterPhotos) ? booking.afterPhotos : [],
      },
    })
  },
)

/**
 * POST /api/bookings/[id]/photos
 * Provider or client uploads before/after service photos and technical inspection checklist.
 */
export const POST = withParams<{ id: string }>(
  "api.bookings.:id.photos.POST",
  async (request, { params }) => {
    await assertRateLimit(request, RATE_LIMITS.bookings)
    const session = await requireUser()
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { type, photos, completionNote, checklist } = photosSchema.parse(body)

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

    const updateData: Record<string, unknown> = {}

    if (type === "before") {
      updateData.beforePhotos = photos
    } else {
      updateData.afterPhotos = photos
      let noteText = completionNote ? sanitizeText(completionNote) : ""
      if (checklist && checklist.length > 0) {
        const checklistSummary = checklist
          .map((item) => `${item.checked ? "[x]" : "[ ]"} ${item.label}`)
          .join("\n")
        noteText = noteText
          ? `${noteText}\n\n--- Checklist de Vistoria ---\n${checklistSummary}`
          : `--- Checklist de Vistoria ---\n${checklistSummary}`
      }
      if (noteText) {
        updateData.completionNote = noteText
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
      message: `Fotos e laudo do ${type === "before" ? "antes" : "depois"} salvos com sucesso!`,
      booking: updated,
    })
  },
)
