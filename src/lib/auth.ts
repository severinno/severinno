import { cookies } from "next/headers"
import { createHmac, randomBytes, timingSafeEqual } from "crypto"
import { db } from "@/lib/db"
import { cacheGet, cacheSet, cacheInvalidate } from "@/lib/redis"
import { isDemoAccountsEnabled, isDemoAccountEmail } from "@/lib/demo-accounts"
import { traceSpan } from "./tracing"

/**
 * Lightweight HMAC-signed session cookie (no JWT lib).
 * Cookie format: `${userId}.${role}.${expiresAt}.${signatureHex}`
 */

const COOKIE_NAME = "severinno_session"
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days
const ROTATION_THRESHOLD_SECONDS = COOKIE_MAX_AGE_SECONDS / 2 // 15 days

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error("SESSION_SECRET environment variable is not set")
  return secret
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex")
}

export type SessionPayload = {
  userId: string
  role: "CLIENT" | "PROVIDER" | "ADMIN"
  sessionVersion?: number
}

/**
 * Create a signed session cookie and set it on the response.
 */
export async function createSession(
  userId: string,
  role: SessionPayload["role"],
  sessionVersion = 0,
) {
  return traceSpan("auth.createSession", async (span) => {
    span.setAttribute("auth.userId", userId)
    span.setAttribute("auth.role", role)
    const expiresAt = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS
    const payload = `${userId}.${role}.${expiresAt}.${sessionVersion}`
    const signature = sign(payload)
    const value = `${payload}.${signature}`

    const store = await cookies()
    store.set(COOKIE_NAME, value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    })

    return { userId, role, expiresAt }
  })
}

/**
 * Reissue the session cookie with a new expiry (sliding extension).
 * Used when the session is past the rotation threshold.
 */
async function reissueSession(
  userId: string,
  role: SessionPayload["role"],
  sessionVersion: number,
) {
  await createSession(userId, role, sessionVersion)
}

/**
 * Read & verify the session cookie. Returns the session payload or null.
 * Automatically rotates (reissues) the cookie if past the rotation threshold.
 * Supports both old 4-part (backward compat) and new 5-part cookies.
 */
export async function getSession(): Promise<SessionPayload | null> {
  return traceSpan("auth.getSession", async (span) => {
    try {
      const store = await cookies()
      const cookie = store.get(COOKIE_NAME)
      if (!cookie?.value) {
        span.setAttribute("auth.session", "missing")
        return null
      }

      const parts = cookie.value.split(".")

      // New format: userId.role.expiresAt.sessionVersion.signature (5 parts)
      // Old format: userId.role.expiresAt.signature (4 parts) — backward compat
      let userId: string
      let role: string
      let expiresAtStr: string
      let sessionVersion: number
      let signature: string

      if (parts.length === 5) {
        const sessionVersionStr = parts[3]
        ;[userId, role, expiresAtStr, , signature] = parts
        sessionVersion = Number(sessionVersionStr)
      } else if (parts.length === 4) {
        ;[userId, role, expiresAtStr, signature] = parts
        sessionVersion = 0 // old cookie — assume version 0
      } else {
        span.setAttribute("auth.session", "invalid_format")
        return null
      }

      if (!userId || !role || !expiresAtStr || !signature) return null
      if (parts.length === 5 && isNaN(sessionVersion)) return null

      const payload =
        parts.length === 5
          ? `${userId}.${role}.${expiresAtStr}.${sessionVersion}`
          : `${userId}.${role}.${expiresAtStr}`
      const expected = sign(payload)

      const a = Buffer.from(signature, "hex")
      const b = Buffer.from(expected, "hex")
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        span.setAttribute("auth.session", "invalid_signature")
        return null
      }

      const expiresAt = Number(expiresAtStr)
      if (!Number.isFinite(expiresAt)) return null
      if (expiresAt * 1000 < Date.now()) {
        span.setAttribute("auth.session", "expired")
        return null
      }

      // Verify sessionVersion against database (cached 5min in Redis)
      const dbVersion = await getUserSessionVersion(userId)
      if (dbVersion === null) return null
      if (sessionVersion !== dbVersion) {
        span.setAttribute("auth.session", "version_mismatch")
        return null
      }

      const remaining = expiresAt - Math.floor(Date.now() / 1000)
      if (remaining < ROTATION_THRESHOLD_SECONDS) {
        await reissueSession(userId, role as SessionPayload["role"], sessionVersion)
      }

      span.setAttribute("auth.userId", userId)
      span.setAttribute("auth.role", role)
      span.setAttribute("auth.session", "valid")
      return {
        userId,
        role: role as SessionPayload["role"],
        sessionVersion,
      }
    } catch {
      return null
    }
  })
}

/**
 * Clear the session cookie (logout).
 */
export async function destroySession() {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}

// ── Ticket de socket (handshake autenticado do realtime) ────────────────────

/** TTL do ticket de socket, em segundos. Single-use e curto: janela de replay mínima. */
export const SOCKET_TICKET_TTL_SECONDS = 60

/** Prefixo no Redis compartilhado — o mini-service consome com GETDEL. */
export const SOCKET_TICKET_PREFIX = "auth:socket-ticket:"

/**
 * Emite um ticket de socket SINGLE-USE para autenticar o handshake do
 * realtime. O app autentica a sessão (getSession — cookie HMAC + versão de
 * sessão no banco) e grava a identidade no Redis TTL curto; o mini-service
 * (outro processo, MESMO Redis da base do compose) consome o ticket no
 * handshake com GETDEL e estampa socket.data.userId/role.
 *
 * Por que ticket e não o cookie direto: o cookie NÃO chega no websocket
 * cross-origin do gateway (a URL `/?XTransformPort=3003` é mesma-origem, mas
 * o dev/e2e conecta direto em NEXT_PUBLIC_REALTIME_URL — e o cliente não
 * controla cookies httpOnly num handshake socket.io com transportes
 * mistos). Confiar em payload do cliente (userId auto-declarado) é o buraco
 * que fecha: qualquer um joinava em user:{id} de terceiros.
 */
export async function createSocketTicket(
  /** Injetável para testes; produção usa o getSession real do módulo. */
  getSessionFn: () => Promise<SessionPayload | null> = getSession,
): Promise<{ ok: true; ticket: string; expiresIn: number } | { ok: false; error: string }> {
  try {
    const session = await getSessionFn()
    if (!session) return { ok: false, error: "Não autenticado" }
    const ticket = randomBytes(32).toString("hex")
    await cacheSet(
      `${SOCKET_TICKET_PREFIX}${ticket}`,
      { userId: session.userId, role: session.role },
      SOCKET_TICKET_TTL_SECONDS,
    )
    return { ok: true, ticket, expiresIn: SOCKET_TICKET_TTL_SECONDS }
  } catch {
    // getSession já engole erros internos como null; qualquer falha aqui é
    // tratada como não-autenticado (sem vazar o motivo).
    return { ok: false, error: "Não autenticado" }
  }
}

/**
 * Check whether a user is active, using Redis cache to avoid DB lookups.
 * Returns true if active, false otherwise. Caches the result for 5 minutes.
 */
async function verifyUserActive(userId: string): Promise<boolean> {
  const cacheKey = `user:active:${userId}`
  const cached = await cacheGet<{ active: boolean; role: string }>(cacheKey)

  if (cached !== null) return cached.active

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, active: true, email: true },
  })

  // 🛡️ Defense-in-depth: contas demo são dev/staging only. Mesmo que uma
  // sessão exista (criada antes do deploy, banco clonado, etc.), em produção
  // a conta é tratada como inativa — invalida sessões demo de forma retroativa.
  const demoBlocked = !isDemoAccountsEnabled() && isDemoAccountEmail(user?.email ?? null)

  const active = !!user?.active && !demoBlocked
  await cacheSet(cacheKey, { active, role: user?.role ?? "" }, 300)
  return active
}

/**
 * Get the session version for a user, cached in Redis for 5 minutes.
 * Returns null if user not found.
 */
async function getUserSessionVersion(userId: string): Promise<number | null> {
  const cacheKey = `user:sessionVersion:${userId}`
  const cached = await cacheGet<{ version: number }>(cacheKey)

  if (cached !== null) return cached.version

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true },
  })

  if (!user) return null

  await cacheSet(cacheKey, { version: user.sessionVersion }, 300)
  return user.sessionVersion
}

// ---------------------------------------------------------------------------
// Typed Auth Errors
// ---------------------------------------------------------------------------

export type AuthErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "INACTIVE_USER"

export class AuthError extends Error {
  readonly code: AuthErrorCode
  readonly status: number

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code)
    this.name = "AuthError"
    this.code = code
    this.status = code === "FORBIDDEN" ? 403 : 401
    Object.setPrototypeOf(this, AuthError.prototype)
  }
}

/**
 * Require an authenticated user. Throws a Next.js-friendly error if absent.
 * Uses Redis cache (5min TTL) to avoid hitting PostgreSQL on every request.
 */
export async function requireUser(): Promise<SessionPayload> {
  // Establish request context for distributed tracing (x-request-id propagation)
  const { establishRequestContext } = await import("./request-context")
  await establishRequestContext()

  const session = await getSession()
  if (!session) {
    throw new AuthError("UNAUTHORIZED")
  }

  const active = await verifyUserActive(session.userId)
  if (!active) throw new AuthError("UNAUTHORIZED")

  return session
}

/**
 * Invalidate cached user status (call after user update/deactivation).
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  await cacheInvalidate(`user:active:${userId}`)
}

/**
 * Invalidate cached session version (call after password change/reset).
 * Forces next getSession() to re-read from database.
 */
export async function invalidateSessionCache(userId: string): Promise<void> {
  await cacheInvalidate(`user:sessionVersion:${userId}`)
}

/**
 * Require a user with a specific role.
 */
export async function requireRole(role: SessionPayload["role"]): Promise<SessionPayload> {
  const session = await requireUser()
  if (session.role !== role) {
    throw new AuthError("FORBIDDEN")
  }
  return session
}

/**
 * Soft variant: returns the session or null (no throw). Useful for SSR
 * pages that show different content for guests.
 * Uses the same Redis cache as requireUser to avoid redundant DB hits.
 */
export async function getOptionalSession(): Promise<SessionPayload | null> {
  const session = await getSession()
  if (!session) return null
  try {
    const active = await verifyUserActive(session.userId)
    if (!active) return null
    return session
  } catch {
    return null
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
