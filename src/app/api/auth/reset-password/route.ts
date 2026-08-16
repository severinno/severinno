import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { hashPassword } from "@/lib/crypto"
import { handleError } from "@/lib/api-server"
import logger from "@/lib/logger"
import { isDemoAccountsEnabled, isDemoAccountEmail } from "@/lib/demo-accounts"

import { withRateLimit } from "@/lib/with-rate-limit"

export const POST = withRateLimit(async (request: Request) => {
  try {
    const body = await request.json()
    const token = (body.token as string | undefined)?.trim()
    const password = (body.password as string | undefined)?.trim()

    if (!token || !password) {
      return NextResponse.json({ error: "Token e nova senha são obrigatórios." }, { status: 400 })
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
      include: { user: { select: { id: true, active: true, email: true } } },
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

    // 🛡️ Contas demo são dev/staging only — mesmo com token válido (criado em
    // dev contra banco compartilhado, ou por fluxo anterior ao gate), em
    // produção o reset é recusado. Resposta genérica para não revelar motivo.
    if (!isDemoAccountsEnabled() && isDemoAccountEmail(resetToken.user.email)) {
      return NextResponse.json(
        { error: "Token inválido. Solicite uma nova redefinição de senha." },
        { status: 400 },
      )
    }

    // Hash the new password and update the user. passwordChangedAt alimenta o
    // cron revoke-inactive-sessions (revoga sockets antigos pós-troca de senha).
    const passwordHash = hashPassword(password)

    await db.$transaction([
      db.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          // Nova troca de senha limpa o marcador once-only do cron de
          // revogação (mesma semântica do change-password).
          revokedByCronAt: null,
        },
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
