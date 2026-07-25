import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

/**
 * Lightweight HMAC-signed session cookie (no JWT lib).
 * Cookie format: `${userId}.${role}.${expiresAt}.${signatureHex}`
 */

const COOKIE_NAME = "severinno_session";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    // dev fallback — must NOT be used in production
    "dev-only-secret-please-set-SESSION_SECRET-in-env"
  );
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export type SessionPayload = {
  userId: string;
  role: "CLIENT" | "PROVIDER" | "ADMIN";
};

/**
 * Create a signed session cookie and set it on the response.
 */
export async function createSession(userId: string, role: SessionPayload["role"]) {
  const expiresAt = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS;
  const payload = `${userId}.${role}.${expiresAt}`;
  const signature = sign(payload);
  const value = `${payload}.${signature}`;

  const store = await cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  return { userId, role, expiresAt };
}

/**
 * Read & verify the session cookie. Returns the session payload or null.
 */
export async function getSession(): Promise<SessionPayload | null> {
  try {
    const store = await cookies();
    const cookie = store.get(COOKIE_NAME);
    if (!cookie?.value) return null;

    const parts = cookie.value.split(".");
    if (parts.length !== 4) return null;
    const [userId, role, expiresAtStr, signature] = parts;
    if (!userId || !role || !expiresAtStr || !signature) return null;

    const payload = `${userId}.${role}.${expiresAtStr}`;
    const expected = sign(payload);

    // timing-safe compare
    const a = Buffer.from(signature, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const expiresAt = Number(expiresAtStr);
    if (!Number.isFinite(expiresAt)) return null;
    if (expiresAt * 1000 < Date.now()) return null;

    return {
      userId,
      role: role as SessionPayload["role"],
    };
  } catch {
    return null;
  }
}

/**
 * Clear the session cookie (logout).
 */
export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * Require an authenticated user. Throws a Next.js-friendly error if absent.
 */
export async function requireUser(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  // Verify the user still exists & is active
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, role: true, active: true },
  });
  if (!user || !user.active) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

/**
 * Require a user with a specific role.
 */
export async function requireRole(role: SessionPayload["role"]): Promise<SessionPayload> {
  const session = await requireUser();
  if (session.role !== role) {
    throw new Error("FORBIDDEN");
  }
  return session;
}

/**
 * Soft variant: returns the session or null (no throw). Useful for SSR
 * pages that show different content for guests.
 */
export async function getOptionalSession(): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session) return null;
  try {
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, role: true, active: true },
    });
    if (!user || !user.active) return null;
    return session;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
