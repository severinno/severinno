export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, badRequest } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { validateKycDocuments } from "@/lib/kyc-document-validator"
import { z } from "zod"

import { withRoute } from "@/lib/api-route"

const verifyIdentitySchema = z.object({
  docUrl: z.string().url("URL do documento inválida"),
  selfieUrl: z.string().url("URL da selfie inválida"),
  docType: z.enum(["RG", "CNH"]).optional(),
})

/**
 * POST /api/provider/verify-identity
 * Provider submits identity documents (RG/CNH + Selfie) for documentoscopy and KYC verification.
 */
export const POST = withRoute("api.provider.verify-identity.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)
  const session = await requireUser()
  if (session.role !== "PROVIDER") {
    throw forbidden("Apenas prestadores podem solicitar verificação de identidade")
  }

  const body = await request.json().catch(() => ({}))
  const { docUrl, selfieUrl, docType } = verifyIdentitySchema.parse(body)

  const currentUser = await db.user.findUnique({
    where: { id: session.userId },
    select: { cpfCnpj: true, name: true },
  })

  // 1. Run automated KYC documentoscopy validation
  const kycResult = await validateKycDocuments({
    docUrl,
    selfieUrl,
    docType,
    cpfCnpj: currentUser?.cpfCnpj ?? undefined,
    fullName: currentUser?.name ?? undefined,
  })

  if (!kycResult.isValid) {
    throw badRequest(
      kycResult.flags[0] || "Validação de documentos rejeitada. Verifique as fotos enviadas.",
    )
  }

  const isApproved = kycResult.autoApprove

  const user = await db.user.update({
    where: { id: session.userId },
    data: {
      identityDocUrl: docUrl,
      identitySelfieUrl: selfieUrl,
      identityStatus: isApproved ? "approved" : "pending",
      identityVerifiedAt: isApproved ? new Date() : null,
      verified: isApproved ? true : undefined,
    },
    select: {
      id: true,
      name: true,
      identityStatus: true,
      verified: true,
    },
  })

  const message = isApproved
    ? "Identidade verificada com sucesso via validação automatizada de documentoscopia! Selo de verificação concedido."
    : "Documentos enviados com sucesso! Nossa equipe analisará sua verificação em até 24h."

  return NextResponse.json({
    ok: true,
    message,
    user,
    kyc: {
      autoApproved: isApproved,
      confidenceScore: kycResult.confidenceScore,
      faceMatchScore: kycResult.faceMatchScore,
      riskLevel: kycResult.riskLevel,
    },
  })
})
