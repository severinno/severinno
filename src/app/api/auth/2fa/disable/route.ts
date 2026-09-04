export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { handleError, badRequest } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { verifyTOTP } from "@/lib/totp"
import logger from "@/lib/logger"

/**
 * POST /api/auth/2fa/disable
 * Verify a TOTP code and disable 2FA for the user.
 */
export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.general)
    const session = await requireUser()

    const { code } = await request.json()

    if (!code || typeof code !== "string") {
      throw badRequest("Código TOTP é obrigatório.")
    }

    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, twoFactorEnabled: true, twoFactorSecret: true },
    })

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 })
    }

    if (!user.twoFactorEnabled) {
      throw badRequest("Autenticação de dois fatores não está ativada.")
    }

    if (!user.twoFactorSecret) {
      throw badRequest("Secret TOTP não encontrado.")
    }

    // Verify the TOTP code before disabling
    const valid = verifyTOTP(user.twoFactorSecret, code)
    if (!valid) {
      throw badRequest("Código TOTP inválido.")
    }

    // Disable 2FA and clear secret
    await db.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
      },
    })

    logger.info({ userId: user.id }, "2FA disabled")

    return NextResponse.json({
      ok: true,
      message: "Autenticação de dois fatores desativada.",
    })
  } catch (e) {
    return handleError(e)
  }
}
