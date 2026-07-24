import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { hashPassword } from "@/lib/crypto"
import { handleError, badRequest } from "@/lib/api-server"
import logger from "@/lib/logger"

import { withRateLimit } from "@/lib/with-rate-limit"

export const POST = withRateLimit(async (request: Request) => {
  try {
    const body = await request.json()
    const token = (body.token as string | undefined)?.trim()
    const password = (body.password as string | undefined)?.trim()

    if (!token || !password) {
      return NextResponse.json(
        { error: "Token e nova senha são obrigatórios." },
        { status: 400 },
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "A senha deve ter ao menos 6 caracteres." },
        { status: 400 },
      )
    }

    // Find the token
    const resetToken = await db.resetToken.findUnique({
      where: { token },
      include: { user: { select: { id: true, active: true } } },
    })

    if (!resetToken) {
      return NextResponse.json(
        { error: "Token inválido. Solicite uma nova redefinição de senha." },
        { status: 400 },
      )
    }

    if (resetToken.used) {
      return NextResponse.json(
        { error: "Este token já foi utilizado. Solicite uma nova redefinição de senha." },
        { status: 400 },
      )
    }

    if (new Date() > resetToken.expiresAt) {
      return NextResponse.json(
        { error: "Este token expirou. Solicite uma nova redefinição de senha." },
        { status: 400 },
      )
    }

    if (!resetToken.user.active) {
      return NextResponse.json(
        { error: "Conta desativada. Entre em contato com o suporte." },
        { status: 400 },
      )
    }

    // Hash the new password and update the user
    const passwordHash = hashPassword(password)

    await db.$transaction([
      db.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      db.resetToken.update({
        where: { id: resetToken.id },
        data: { used: true },
      }),
    ])

    logger.info({ userId: resetToken.userId }, "password reset successful")
    return NextResponse.json({
      ok: true,
      message: "Senha redefinida com sucesso! Você já pode fazer login.",
    })
  } catch (e) {
    return handleError(e)
  }
}, 5)
