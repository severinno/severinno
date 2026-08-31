import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * GET /api/auth/2fa/status
 * Returns whether the current user has 2FA enabled.
 */
export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.general)
    const session = await requireUser()

    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { twoFactorEnabled: true },
    })

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 })
    }

    return NextResponse.json({ twoFactorEnabled: user.twoFactorEnabled })
  } catch (e) {
    return handleError(e)
  }
}
