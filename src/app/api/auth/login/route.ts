import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { verifyPassword } from "@/lib/crypto"
import { createSession } from "@/lib/auth"
import { loginSchema } from "@/lib/validators"
import { handleError, unauthorized } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.login)
    const body = await request.json()
    const data = loginSchema.parse(body)

    const user = await db.user.findUnique({
      where: { email: data.email.toLowerCase() },
    })
    if (!user) {
      throw unauthorized("E-mail ou senha inválidos")
    }
    if (!user.active) {
      throw unauthorized("Conta desativada")
    }
    const ok = verifyPassword(data.password, user.passwordHash)
    if (!ok) {
      throw unauthorized("E-mail ou senha inválidos")
    }

    await createSession(user.id, user.role as "CLIENT" | "PROVIDER" | "ADMIN")

    const { passwordHash: _ignored, ...safe } = user
    return NextResponse.json({ user: safe })
  } catch (e) {
    return handleError(e)
  }
}
