import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { verifyPassword } from "@/lib/crypto"
import { createSession } from "@/lib/auth"
import { loginSchema } from "@/lib/validators"
import { handleError, unauthorized } from "@/lib/api-server"
import { parseBody } from "@/lib/api-middleware"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { isDemoAccountsEnabled, isDemoAccountEmail } from "@/lib/demo-accounts"

export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.login)
    const data = await parseBody(request, loginSchema)

    const user = await db.user.findUnique({
      where: { email: data.email.toLowerCase() },
    })
    if (!user) {
      throw unauthorized("E-mail ou senha inválidos")
    }
    // 🛡️ Contas demo (dev/staging only): mesmo que o usuário exista no banco
    // (banco clonado, seed antigo, etc.), em produção o login é recusado — a
    // credencial admin@severinno.com/admin123 é pública. A mesma mensagem
    // genérica evita revelar a existência da conta.
    if (!isDemoAccountsEnabled() && isDemoAccountEmail(user.email)) {
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
