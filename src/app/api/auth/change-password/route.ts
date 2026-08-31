import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { hashPassword, verifyPassword } from "@/lib/crypto"
import { requireUser } from "@/lib/auth"
import { handleError, badRequest } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { saveAndQueueNotification } from "@/lib/notification-queue"
import { sendMail, passwordChangedHtml } from "@/lib/mail"
import { captureError } from "@/lib/sentry"
import { cacheInvalidate } from "@/lib/redis"
import { invalidateSessionCache } from "@/lib/auth"
import { passwordSchema } from "@/lib/validators"
import logger from "@/lib/logger"

export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.general)
    const session = await requireUser()

    const { currentPassword, newPassword } = await request.json()

    if (!currentPassword || !newPassword) {
      throw badRequest("Senha atual e nova senha são obrigatórias.")
    }

    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      throw badRequest("Senhas inválidas.")
    }

    // Validate new password complexity
    const pwResult = passwordSchema.safeParse(newPassword)
    if (!pwResult.success) {
      throw badRequest(pwResult.error.issues[0]?.message ?? "Senha não atende aos requisitos de segurança.")
    }

    // Fetch user with current password hash
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, passwordHash: true, name: true, email: true },
    })

    if (!user) {
      throw badRequest("Usuário não encontrado.")
    }

    // Verify current password
    const isValid = verifyPassword(currentPassword, user.passwordHash)
    if (!isValid) {
      throw badRequest("Senha atual incorreta.")
    }

    // Hash and save new password, increment sessionVersion to revoke all other sessions
    const newHash = hashPassword(newPassword)
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        sessionVersion: { increment: 1 },
      },
    })

    // Invalidate all cached session data for this user (security: force re-auth)
    await cacheInvalidate(`user:active:${user.id}`)
    await invalidateSessionCache(user.id)

    // Send push notification as security alert
    saveAndQueueNotification({
      userId: user.id,
      type: "PASSWORD_CHANGED",
      title: "Senha alterada",
      body: "Sua senha foi alterada com sucesso. Se não foi você, entre em contato com o suporte imediatamente.",
      pushUrl: "/?view=profile",
    }).catch((err) => {
      captureError(err, { userId: user.id, context: "change-password notification" })
    })

    // Send transactional email as security alert
    sendMail({
      to: user.email,
      subject: "Sua senha foi alterada — Severinno",
      html: passwordChangedHtml({ userName: user.name, email: user.email }),
    }).catch((err) => {
      captureError(err, { userId: user.id, context: "change-password email" })
    })

    logger.info({ userId: user.id }, "password changed successfully")

    return NextResponse.json({
      ok: true,
      message: "Senha alterada com sucesso!",
    })
  } catch (e) {
    return handleError(e)
  }
}
