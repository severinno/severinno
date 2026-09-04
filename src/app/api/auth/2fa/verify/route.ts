export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { createSession } from "@/lib/auth"
import { handleError, badRequest, unauthorized } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { verifyTOTP, verifyBackupCodeFromStore } from "@/lib/totp"
import { cacheGet, cacheInvalidate } from "@/lib/redis"
import logger from "@/lib/logger"

const TEMP_TOKEN_PREFIX = "auth:2fa:temp:"

/**
 * POST /api/auth/2fa/verify
 * Verify TOTP code or backup code during login (second factor).
 * Requires a temporary token from the login flow.
 */
export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.login)

    const { tempToken, code, isBackupCode } = await request.json()

    if (!tempToken || typeof tempToken !== "string") {
      throw badRequest("Token temporário é obrigatório.")
    }

    if (!code || typeof code !== "string") {
      throw badRequest("Código é obrigatório.")
    }

    // Retrieve the temporary token data
    const tempData = await cacheGet<{ userId: string; role: string }>(
      `${TEMP_TOKEN_PREFIX}${tempToken}`,
    )

    if (!tempData) {
      throw badRequest("Token temporário inválido ou expirado. Faça login novamente.")
    }

    // Invalidate the temporary token (one-time use)
    await cacheInvalidate(`${TEMP_TOKEN_PREFIX}${tempToken}`)

    const user = await db.user.findUnique({
      where: { id: tempData.userId },
      select: {
        id: true,
        role: true,
        sessionVersion: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
      },
    })

    if (!user) {
      throw unauthorized("Usuário não encontrado.")
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw badRequest("Autenticação de dois fatores não está configurada.")
    }

    let valid = false

    if (isBackupCode) {
      // Verify backup code
      if (!user.twoFactorBackupCodes) {
        throw badRequest("Nenhum código de backup disponível.")
      }
      const result = verifyBackupCodeFromStore(code, user.twoFactorBackupCodes)
      valid = result.valid

      if (valid) {
        // Update the backup codes (remove the used one)
        await db.user.update({
          where: { id: user.id },
          data: { twoFactorBackupCodes: result.updatedCodes },
        })
      }
    } else {
      // Verify TOTP code
      valid = verifyTOTP(user.twoFactorSecret, code)
    }

    if (!valid) {
      throw unauthorized("Código inválido.")
    }

    // Create the session
    await createSession(user.id, user.role as "CLIENT" | "PROVIDER" | "ADMIN", user.sessionVersion)

    logger.info({ userId: user.id }, "2FA verification successful")

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        role: user.role,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
