import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, handleError } from "@/lib/api-server"
import { z } from "zod"

const verifyIdentitySchema = z.object({
  docUrl: z.string().url("URL do documento inválida"),
  selfieUrl: z.string().url("URL da selfie inválida"),
})

/**
 * POST /api/provider/verify-identity
 * Provider submits identity documents (RG/CNH + Selfie) for admin verification.
 */
export async function POST(request: Request) {
  try {
    const session = await requireUser()
    if (session.role !== "PROVIDER") {
      throw forbidden("Apenas prestadores podem solicitar verificação de identidade")
    }

    const body = await request.json().catch(() => ({}))
    const { docUrl, selfieUrl } = verifyIdentitySchema.parse(body)

    const user = await db.user.update({
      where: { id: session.userId },
      data: {
        identityDocUrl: docUrl,
        identitySelfieUrl: selfieUrl,
        identityStatus: "pending",
      },
      select: {
        id: true,
        name: true,
        identityStatus: true,
      },
    })

    return NextResponse.json({
      ok: true,
      message:
        "Documentos enviados com sucesso! Nossa equipe analisará sua verificação em até 24h.",
      user,
    })
  } catch (e) {
    return handleError(e)
  }
}
