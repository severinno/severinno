export const dynamic = "force-dynamic"

import logger from "@/lib/logger"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { badRequest, handleError, notFound } from "@/lib/api-server"
import { z } from "zod"
import { sendText } from "@/lib/evolution"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

type Params = { params: Promise<{ id: string }> }

const adminReviewSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
})

/**
 * PATCH /api/admin/verify-identity/[id]
 * Admin approves or rejects provider KYC identity verification.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.admin)
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { status, reason } = adminReviewSchema.parse(body)

    const provider = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, whatsapp: true, role: true },
    })

    if (!provider) throw notFound("Prestador não encontrado")
    if (provider.role !== "PROVIDER") throw badRequest("O usuário não é um prestador")

    const now = new Date()
    const isApproved = status === "approved"

    const updated = await db.user.update({
      where: { id },
      data: {
        identityStatus: status,
        verified: isApproved,
        identityVerifiedAt: isApproved ? now : null,
      },
      select: {
        id: true,
        name: true,
        verified: true,
        identityStatus: true,
        identityVerifiedAt: true,
      },
    })

    // Notify provider via WhatsApp (best-effort)
    if (provider.whatsapp) {
      const msg = isApproved
        ? `🎉 *Parabéns, ${provider.name}!*\n\nSeu perfil no Severinno foi *verificado com sucesso*! Você agora possui o selo oficial de prestador verificado e terá destaque nas buscas da sua região.`
        : `⚠️ *Aviso de Verificação - Severinno*\n\nOlá, ${provider.name}. Sua solicitação de verificação de identidade não pôde ser aprovada.\n${reason ? `Motivo: ${reason}\n\n` : "\n"}Acesse o app para reenviar documentos legíveis.`

      sendText(provider.whatsapp, msg).catch((err) =>
        logger.warn({ err }, "whatsapp notification failed"),
      )
    }

    return NextResponse.json({
      ok: true,
      message: isApproved ? "Prestador aprovado e verificado!" : "Verificação rejeitada.",
      provider: updated,
    })
  } catch (e) {
    return handleError(e)
  }
}
