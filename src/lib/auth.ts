import { cookies } from "next/headers"
import { createHmac, timingSafeEqual } from "crypto"
import { db } from "@/lib/db"
import { cacheGet, cacheSet, cacheInvalidate } from "@/lib/redis"
import { isDemoAccountsEnabled, isDemoAccountEmail } from "@/lib/demo-accounts"

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
}

/**
 * Create a signed session cookie and set it on the response.
 */
export async function createSession(userId: string, role: SessionPayload["role"]) {
  const expiresAt = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS
  const payload = `${userId}.${role}.${expiresAt}`
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
}

/**
 * Reissue the session cookie with a new expiry (sliding extension).
 * Used when the session is past the rotation threshold.
 */
async function reissueSession(userId: string, role: SessionPayload["role"]) {
  await createSession(userId, role)
}

/**
 * Read & verify the session cookie. Returns the session payload or null.
 * Automatically rotates (reissues) the cookie if past the rotation threshold.
 */
export async function getSession(): Promise<SessionPayload | null> {
  try {
    const store = await cookies()
    const cookie = store.get(COOKIE_NAME)
    if (!cookie?.value) return null

    const parts = cookie.value.split(".")
    if (parts.length !== 4) return null
    const [userId, role, expiresAtStr, signature] = parts
    if (!userId || !role || !expiresAtStr || !signature) return null

    const payload = `${userId}.${role}.${expiresAtStr}`
    const expected = sign(payload)

    const a = Buffer.from(signature, "hex")
    const b = Buffer.from(expected, "hex")
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    const expiresAt = Number(expiresAtStr)
    if (!Number.isFinite(expiresAt)) return null
    if (expiresAt * 1000 < Date.now()) return null

    const remaining = expiresAt - Math.floor(Date.now() / 1000)
    if (remaining < ROTATION_THRESHOLD_SECONDS) {
      await reissueSession(userId, role as SessionPayload["role"])
    }

    return {
      userId,
      role: role as SessionPayload["role"],
    }
  } catch {
    return null
  }
}

/**
 * Clear the session cookie (logout).
 */
export async function destroySession() {
  const store = await cookies()
  store.delete(COOKIE_NAME)
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
