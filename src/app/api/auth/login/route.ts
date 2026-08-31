import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { verifyPassword } from "@/lib/crypto"
import { createSession } from "@/lib/auth"
import { loginSchema } from "@/lib/validators"
import { handleError, unauthorized } from "@/lib/api-server"
import { parseBody } from "@/lib/api-middleware"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { isDemoAccountsEnabled, isDemoAccountEmail } from "@/lib/demo-accounts"
import { cacheGet, cacheSet, cacheInvalidate } from "@/lib/redis"
import { randomBytes } from "crypto"
import logger from "@/lib/logger"

// ── Account lockout (per-email brute force protection) ─────────────────────
// 5 failed attempts → lock for 15 minutes. Redis-backed, degrades gracefully.
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_SECONDS = 15 * 60 // 15 minutes
const LOCKOUT_PREFIX = "auth:lockout:"
const TEMP_TOKEN_PREFIX = "auth:2fa:temp:"
const TEMP_TOKEN_TTL = 300 // 5 minutes

async function isLockedOut(email: string): Promise<boolean> {
  const lockout = await cacheGet<{ lockedUntil: number }>(`${LOCKOUT_PREFIX}${email}`)
  if (!lockout) return false
  if (Date.now() > lockout.lockedUntil) {
    await cacheInvalidate(`${LOCKOUT_PREFIX}${email}`)
    return false
  }
  return true
}

async function recordFailedAttempt(email: string): Promise<void> {
  const key = `${LOCKOUT_PREFIX}${email}`
  const existing = await cacheGet<{ count: number; lockedUntil?: number }>(key)
  const count = (existing?.count ?? 0) + 1

  if (count >= MAX_FAILED_ATTEMPTS) {
    await cacheSet(key, {
      count,
      lockedUntil: Date.now() + LOCKOUT_SECONDS * 1000,
    }, LOCKOUT_SECONDS)
    logger.warn({ email }, "Account locked after too many failed attempts")
  } else {
    await cacheSet(key, { count }, LOCKOUT_SECONDS)
  }
}

async function clearFailedAttempts(email: string): Promise<void> {
  await cacheInvalidate(`${LOCKOUT_PREFIX}${email}`)
}

export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.login)
    const data = await parseBody(request, loginSchema)

    const email = data.email.toLowerCase()

    // 🛡️ Account lockout check
    if (await isLockedOut(email)) {
      throw unauthorized("Conta temporariamente bloqueada. Tente novamente em 15 minutos.")
    }

    const user = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        role: true,
        active: true,
        email: true,
        passwordHash: true,
        sessionVersion: true,
        twoFactorEnabled: true,
      },
    })
    if (!user) {
      // Use generic message to prevent email enumeration
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
      await recordFailedAttempt(email)
      throw unauthorized("E-mail ou senha inválidos")
    }

    // 🛡️ Login successful — clear lockout counter
    await clearFailedAttempts(email)

    // 🛡️ 2FA: If enabled, return a temporary token instead of creating a session
    if (user.twoFactorEnabled) {
      const tempToken = randomBytes(32).toString("hex")
      await cacheSet(
        `${TEMP_TOKEN_PREFIX}${tempToken}`,
        { userId: user.id, role: user.role },
        TEMP_TOKEN_TTL,
      )

      return NextResponse.json({
        requires2FA: true,
        tempToken,
        message: "Digite o código do seu aplicativo autenticador.",
      })
    }

    // No 2FA — create session directly
    await createSession(user.id, user.role as "CLIENT" | "PROVIDER" | "ADMIN", user.sessionVersion)

    const { passwordHash: _ignored, ...safe } = user
    return NextResponse.json({ user: safe })
  } catch (e) {
    return handleError(e)
  }
}
