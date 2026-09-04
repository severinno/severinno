export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { handleError, badRequest } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { verifyTOTP, generateBackupCodes, hashBackupCodes } from "@/lib/totp"
import logger from "@/lib/logger"

/**
 * POST /api/auth/2fa/backup-codes
 * Regenerate backup codes. Requires TOTP verification.
 */
export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.general)
    const session = await requireUser()

    const { code } = await request.json()

    if (!code || typeof code !== "string") {
      throw badRequest("Código TOTP é obrigatório para regenerar codes de backup.")
    }

    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, twoFactorEnabled: true, twoFactorSecret: true },
    })

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 })
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw badRequest("Autenticação de dois fatores não está ativada.")
    }

    // Verify TOTP code before regenerating
    const valid = verifyTOTP(user.twoFactorSecret, code)
    if (!valid) {
      throw badRequest("Código TOTP inválido.")
    }

    // Generate new backup codes
    const backupCodes = generateBackupCodes()
    const hashedBackupCodes = hashBackupCodes(backupCodes)

    await db.user.update({
      where: { id: user.id },
      data: { twoFactorBackupCodes: hashedBackupCodes },
    })

    logger.info({ userId: user.id }, "backup codes regenerated")

    return NextResponse.json({
      ok: true,
      backupCodes,
      message:
        "Códigos de backup regenerados. Salve em local seguro — não serão exibidos novamente.",
    })
  } catch (e) {
    return handleError(e)
  }
}
