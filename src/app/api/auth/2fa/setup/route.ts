import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { generateSecret, generateTOTPUri } from "@/lib/totp"

/**
 * POST /api/auth/2fa/setup
 * Generate a TOTP secret and QR code URI for 2FA enrollment.
 * Does NOT enable 2FA yet — user must verify a code first via /api/auth/2fa/enable.
 */
export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.general)
    const session = await requireUser()

    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true, twoFactorEnabled: true },
    })

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 })
    }

    if (user.twoFactorEnabled) {
      return NextResponse.json(
        { error: "Autenticação de dois fatores já está ativada" },
        { status: 400 },
      )
    }

    // Generate new secret
    const secret = generateSecret()
    const uri = generateTOTPUri(secret, user.email)

    // Store the secret temporarily (not enabled yet)
    await db.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: secret },
    })

    return NextResponse.json({ secret, uri })
  } catch (e) {
    return handleError(e)
  }
}
