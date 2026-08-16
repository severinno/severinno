/**
 * Severinno Marketplace SaaS — Realtime Mini-Service: Security helpers
 *
 * Pure functions (no socket.io / server imports) so they can be unit-tested
 * in isolation. Mirrors the session-cookie format signed by the Next.js app
 * (see src/lib/auth.ts):
 *
 *   severinno_session = `${userId}.${role}.${expiresAt}.${signatureHex}`
 *   signature = HMAC-SHA256(SESSION_SECRET, `${userId}.${role}.${expiresAt}`)
 *
 * Env reading supports the repository's docker-secret convention:
 *   - `${NAME}_FILE` env var → read secret from that file (e.g. /run/secrets/…)
 *   - `${NAME}` env var → plain value
 */

import { createHmac, timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"

export const SESSION_COOKIE_NAME = "severinno_session"

export interface VerifiedSession {
  userId: string
  role: string
}

// ---------------------------------------------------------------------------
// Session revocation helpers
//
// `handleSessionRevoke` (index.ts) disconnects every socket carrying the
// revoked session. Joined sockets live in the `user:{id}` room, but a socket
// that connected with a valid cookie and never joined has NO room membership
// — the room broadcast can't reach it. These pure helpers match sockets by
// the session fixed at handshake (`socket.data.session`), so revocation also
// covers connected-but-not-joined sockets.
// ---------------------------------------------------------------------------

/** Structural view of a socket for session-revocation matching (socket.io
 *  `RemoteSocket` exposes `.data`; unit tests inject fakes). */
export interface SessionSocketLike {
  data: { session?: VerifiedSession | null }
}

/**
 * Filter sockets whose verified session (fixed at handshake) matches the
 * given userId. Pure + generic (preserves the concrete socket type so
 * callers can `.emit()`/`.disconnect()` on the result).
 */
export function filterSocketsBySessionUserId<T extends SessionSocketLike>(
  sockets: readonly T[],
  userId: string,
): T[] {
  return sockets.filter((s) => s.data.session?.userId === userId)
}

// ---------------------------------------------------------------------------
// Client event authorization (extracted from index.ts `requireSession`)
//
// Pure, async, testable: gates a client-emitted event on (1) a verified
// session, (2) an identity match (fromIds), and (3) — when a bookingId is
// present — real participation in that booking, via an INJECTED resolver
// (the realtime service wires a pg-backed checker; tests inject a mock).
// Fail-closed: no session / no matching identity / unverifiable booking all
// deny the event.
// ---------------------------------------------------------------------------

export type BookingParticipantChecker = (
  bookingId: string,
  userId: string,
) => boolean | Promise<boolean>

export interface ClientEventAuthInput {
  session: VerifiedSession | null
  fromIds: string[]
  bookingId?: string
  /** Recipient of a booking-scoped event (message:send): must also be a
   *  participant of the booking when bookingId is present. */
  toId?: string
  isBookingParticipant?: BookingParticipantChecker
}

export type ClientEventAuthResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | "NO_SESSION"
        | "IDENTITY_MISMATCH"
        | "NOT_BOOKING_PARTICIPANT"
        | "RECIPIENT_NOT_BOOKING_PARTICIPANT"
        | "BOOKING_UNVERIFIABLE"
    }

/**
 * Authorize a client-emitted realtime event against the verified session.
 *
 * - no verified session → deny (`NO_SESSION`)
 * - `fromIds` non-empty and the session user is not among them → deny
 *   (`IDENTITY_MISMATCH`)
 * - when `bookingId` is provided: the session user MUST be a real participant
 *   (client or provider) of that booking, and — when a `toId` recipient is
 *   given — the recipient MUST also be a participant of the booking (full
 *   message flow: a booking-scoped message may only travel between its two
 *   participants). If no resolver is injected, the booking cannot be verified
 *   → deny (`BOOKING_UNVERIFIABLE`, fail-closed).
 */
export async function authorizeClientEvent(
  input: ClientEventAuthInput,
): Promise<ClientEventAuthResult> {
  const { session, fromIds, bookingId, toId, isBookingParticipant } = input

  if (!session) return { ok: false, reason: "NO_SESSION" }

  if (fromIds.length > 0 && !fromIds.includes(session.userId)) {
    return { ok: false, reason: "IDENTITY_MISMATCH" }
  }

  if (bookingId) {
    if (!isBookingParticipant) {
      return { ok: false, reason: "BOOKING_UNVERIFIABLE" }
    }
    const isSenderParticipant = await isBookingParticipant(bookingId, session.userId)
    if (!isSenderParticipant) {
      return { ok: false, reason: "NOT_BOOKING_PARTICIPANT" }
    }
    if (toId) {
      const isRecipientParticipant = await isBookingParticipant(bookingId, toId)
      if (!isRecipientParticipant) {
        return { ok: false, reason: "RECIPIENT_NOT_BOOKING_PARTICIPANT" }
      }
    }
  }

  return { ok: true }
}

/**
 * Read a secret: `${name}_FILE` (docker secret path) takes precedence over
 * the plain `${name}` env var. Returns undefined when neither is present.
 */
export function readSecret(name: string): string | undefined {
  const fileEnv = `${name}_FILE`
  const filePath = process.env[fileEnv]
  if (filePath) {
    try {
      return readFileSync(filePath, "utf8").trim()
    } catch (err) {
      console.error(`[security] could not read secret file ${fileEnv}=${filePath}:`, err)
      return undefined
    }
  }
  return process.env[name]
}

/** Parse a raw `Cookie:` header into a map of name → value. */
export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!cookieHeader) return out
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=")
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) out[key] = value
  }
  return out
}

/**
 * Verify the HMAC-signed session cookie from a raw Cookie header.
 * Returns the session payload, or null when the cookie is missing,
 * malformed, expired, or fails the signature check (fail closed).
 */
export function verifySessionCookie(
  cookieHeader: string | undefined,
  secret: string | undefined,
): VerifiedSession | null {
  if (!secret) return null
  const cookie = parseCookieHeader(cookieHeader)[SESSION_COOKIE_NAME]
  if (!cookie) return null

  const parts = cookie.split(".")
  if (parts.length !== 4) return null
  const [userId, role, expiresAtStr, signature] = parts
  if (!userId || !role || !expiresAtStr || !signature) return null

  const payload = `${userId}.${role}.${expiresAtStr}`
  const expected = createHmac("sha256", secret).update(payload).digest("hex")

  const a = Buffer.from(signature, "hex")
  const b = Buffer.from(expected, "hex")
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const expiresAt = Number(expiresAtStr)
  if (!Number.isFinite(expiresAt)) return null
  if (expiresAt * 1000 < Date.now()) return null

  return { userId, role }
}

/**
 * Constant-time check of an `Authorization: Bearer <token>` header against
 * the expected token. Fails closed: missing header, wrong scheme, or an
 * unconfigured expected token all return false.
 */
export function verifyEmitToken(
  authHeader: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected || !authHeader) return false
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader)
  if (!match) return false
  const token = match[1]!
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
