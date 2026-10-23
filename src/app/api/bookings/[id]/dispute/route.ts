export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest, forbidden, notFound } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { z } from "zod"
import { sanitizeText } from "@/lib/sanitize"

import { withParams } from "@/lib/api-route"

export const disputeCategoryEnum = z.enum([
  "NOT_DELIVERED",
  "POOR_QUALITY",
  "INCOMPLETE",
  "DAMAGED",
  "UNAUTHORIZED_CHARGE",
  "OTHER",
])

export const DISPUTE_CATEGORY_LABELS: Record<z.infer<typeof disputeCategoryEnum>, string> = {
  NOT_DELIVERED: "Serviço não prestado / Ausência do prestador",
  POOR_QUALITY: "Qualidade insatisfatória / Fora do padrão",
  INCOMPLETE: "Trabalho incompleto / Abandonado",
  DAMAGED: "Avaria ou dano material no local",
  UNAUTHORIZED_CHARGE: "Cobrança indevida ou desacordo de valor",
  OTHER: "Outros motivos / Desacordo geral",
}

const disputeSchema = z.object({
  reason: z.string().min(10, "Descreva o motivo da disputa com pelo menos 10 caracteres"),
  category: disputeCategoryEnum.default("OTHER"),
  evidencePhotos: z.array(z.string()).max(6).optional().default([]),
})

/**
 * POST /api/bookings/[id]/dispute
 * Client opens a mediation dispute for a booking held in escrow with evidence photos.
 */
export const POST = withParams<{ id: string }>(
  "api.bookings.:id.dispute.POST",
  async (request, { params }) => {
    await assertRateLimit(request, RATE_LIMITS.bookings)
    const session = await requireUser()
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { reason, category, evidencePhotos } = disputeSchema.parse(body)

    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        disputes: { where: { status: "OPEN" } },
        service: { select: { title: true } },
      },
    })

    if (!booking) throw notFound("Agendamento não encontrado")
    if (booking.clientId !== session.userId && session.role !== "ADMIN") {
      throw forbidden("Apenas o cliente pode abrir uma disputa para este agendamento")
    }

    if (booking.disputes.length > 0) {
      throw badRequest("Já existe uma disputa aberta para este agendamento")
    }

    const categoryLabel = DISPUTE_CATEGORY_LABELS[category] || category
    const formattedReason = `[${categoryLabel}] ${sanitizeText(reason)}`

    // Se foram fornecidas fotos de evidência, mescla com as fotos do laudo para auditoria
    const currentPhotos = Array.isArray(booking.afterPhotos)
      ? (booking.afterPhotos as string[])
      : []
    const updatedPhotos =
      evidencePhotos && evidencePhotos.length > 0
        ? Array.from(new Set([...currentPhotos, ...evidencePhotos]))
        : currentPhotos

    const [dispute] = await db.$transaction([
      db.dispute.create({
        data: {
          bookingId: id,
          reason: formattedReason,
          status: "OPEN",
        },
      }),
      db.booking.update({
        where: { id },
        data: {
          escrowDisputeReason: formattedReason,
          afterPhotos: updatedPhotos,
        },
      }),
    ])

    // Notificação interna ao prestador e admin (best-effort)
    try {
      const { notifyBookingStatus } = await import("@/lib/notifications")
      await notifyBookingStatus(
        booking.providerId,
        id,
        "DISPUTED",
        booking.service?.title ?? "Serviço",
        `O cliente abriu solicitação de mediação (${categoryLabel}). Custódia protegida.`,
      ).catch(() => {})
    } catch {
      // Best-effort
    }

    return NextResponse.json(
      {
        ok: true,
        message:
          "Disputa registrada com sucesso. Nossa equipe de mediação analisará as evidências e o caso em até 48h.",
        dispute,
        evidenceCount: evidencePhotos.length,
      },
      { status: 201 },
    )
  },
)
