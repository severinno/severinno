import { cookies } from "next/headers"
import { db } from "@/lib/db"
import { cacheGet, cacheSet, cacheInvalidate } from "@/lib/redis"
import {
  signPayload,
  parseCookieValue,
  constantTimeEqual,
  SESSION_COOKIE_NAME as COOKIE_NAME,
  SESSION_MAX_AGE as COOKIE_MAX_AGE_SECONDS,
  ROTATION_THRESHOLD as ROTATION_THRESHOLD_SECONDS,
  type SessionPayload,
} from "@/lib/crypto-session"

export type { SessionPayload }
export { SESSION_COOKIE_NAME } from "@/lib/crypto-session"

/**
 * Create a signed session cookie and set it on the response.
 */
export async function createSession(userId: string, role: SessionPayload["role"]) {
  const expiresAt = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS
  const payload = `${userId}.${role}.${expiresAt}`
  const signature = await signPayload(payload)
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

    const parsed = parseCookieValue(cookie.value)
    if (!parsed) return null

    const { userId, role, expiresAt, signature } = parsed

    const payload = `${userId}.${role}.${expiresAt}`
    const expected = await signPayload(payload)

    if (!constantTimeEqual(signature, expected)) return null

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
    select: { id: true, role: true, active: true },
  })

  const active = !!user?.active
  await cacheSet(cacheKey, { active, role: user?.role ?? "" }, 300)
  return active
}

/**
 * Require an authenticated user. Throws a Next.js-friendly error if absent.
 * Uses Redis cache (5min TTL) to avoid hitting PostgreSQL on every request.
 */
export async function requireUser(): Promise<SessionPayload> {
  const session = await getSession()
  if (!session) {
    throw new Error("UNAUTHORIZED")
  }

  const active = await verifyUserActive(session.userId)
  if (!active) throw new Error("UNAUTHORIZED")

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
    throw new Error("FORBIDDEN")
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
