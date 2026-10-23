export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest, notFound, forbidden } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { sanitizeText } from "@/lib/sanitize"

import { withParams } from "@/lib/api-route"

// =============================================================================
// POST /api/reviews/[id]/reply — Provider replies to a review
// =============================================================================
export const POST = withParams<{ id: string }>(
  "api.reviews.:id.reply.POST",
  async (request, { params }) => {
    await assertRateLimit(request, RATE_LIMITS.general)
    const session = await requireUser()
    const { id } = await params
    const { reply } = await request.json()

    if (!reply || typeof reply !== "string" || reply.trim().length < 2) {
      throw badRequest("Resposta deve ter pelo menos 2 caracteres")
    }

    if (reply.length > 500) {
      throw badRequest("Resposta deve ter no máximo 500 caracteres")
    }

    const review = await db.review.findUnique({
      where: { id },
      select: { providerId: true, providerReply: true },
    })

    if (!review) throw notFound("Avaliação não encontrada")
    if (review.providerId !== session.userId) {
      throw forbidden("Só o prestador pode responder esta avaliação")
    }
    if (review.providerReply) {
      throw badRequest("Você já respondeu esta avaliação")
    }

    const updated = await db.review.update({
      where: { id },
      data: {
        providerReply: sanitizeText(reply.trim()),
        providerReplyAt: new Date(),
      },
    })

    return NextResponse.json({ review: updated })
  },
)
