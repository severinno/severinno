import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { db } from "@/lib/db"
import { handleError } from "@/lib/api-server"
import { sendMail, passwordResetHtml } from "@/lib/mail"
import { saveAndQueueNotification } from "@/lib/notification-queue"
import { captureError } from "@/lib/sentry"
import logger from "@/lib/logger"
import { withRateLimit } from "@/lib/with-rate-limit"

export const POST = withRateLimit(async (request: Request) => {
  try {
    // Parse body safely — always return 200 to prevent email enumeration
    let rawEmail = ""
    try {
      const body = await request.json()
      rawEmail = body.email ?? ""
    } catch {
      // Malformed JSON — still return 200
    }

    const email = typeof rawEmail === "string" ? rawEmail.toLowerCase().trim() : ""

    if (!email) {
      return NextResponse.json({
        ok: true,
        message: "Se o e-mail existir, você receberá as instruções de recuperação.",
      })
    }

    const user = await db.user.findUnique({ where: { email } })
    if (!user) {
      return NextResponse.json({
        ok: true,
        message: "Se o e-mail existir, você receberá as instruções de recuperação.",
      })
    }

    // Invalidate any existing unused tokens for this user
    await db.resetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    })

    const token = randomBytes(32).toString("hex")
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

    await db.resetToken.create({
      data: { userId: user.id, token, expiresAt },
    })

    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://severinno.com.br"}/auth/reset-password/${token}`

    await sendMail({
      to: email,
      subject: "Redefinição de senha — Severinno",
      html: passwordResetHtml({ userName: user.name, resetLink: resetUrl }),
    })

    logger.info({ userId: user.id }, "password reset email sent")

    // Send push notification as security alert (fire-and-forget)
    saveAndQueueNotification({
      userId: user.id,
      type: "PASSWORD_RESET_REQUESTED",
      title: "Redefinição de senha solicitada",
      body: "Alguém solicitou a redefinição da sua senha. Se não foi você, ignore este aviso.",
      pushUrl: "/auth/reset-password",
    }).catch((err) => {
      captureError(err, { userId: user.id, context: "forgot-password notification" })
    })

    return NextResponse.json({
      ok: true,
      message: "Se o e-mail existir, você receberá as instruções de recuperação.",
    })
  } catch (e) {
    return handleError(e)
  }
}, 5)
