import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { handleError, badRequest } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { verifyTOTP, generateBackupCodes, hashBackupCodes } from "@/lib/totp"
import logger from "@/lib/logger"

/**
 * POST /api/auth/2fa/enable
 * Verify a TOTP code and enable 2FA for the user.
 * Requires a secret to have been generated via /api/auth/2fa/setup first.
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

    if (user.twoFactorEnabled) {
      throw badRequest("Autenticação de dois fatores já está ativada.")
    }

    if (!user.twoFactorSecret) {
      throw badRequest("Execute o setup primeiro (/api/auth/2fa/setup).")
    }

    // Verify the TOTP code
    const valid = verifyTOTP(user.twoFactorSecret, code)
    if (!valid) {
      throw badRequest("Código TOTP inválido. Verifique o horário do seu dispositivo.")
    }

    // Generate backup codes
    const backupCodes = generateBackupCodes()
    const hashedBackupCodes = hashBackupCodes(backupCodes)

    // Enable 2FA
    await db.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: true,
        twoFactorBackupCodes: hashedBackupCodes,
      },
    })

    logger.info({ userId: user.id }, "2FA enabled successfully")

    // Return backup codes to the user (shown once, never stored in plain text)
    return NextResponse.json({
      ok: true,
      message: "Autenticação de dois fatores ativada com sucesso!",
      backupCodes,
    })
  } catch (e) {
    return handleError(e)
  }
}
