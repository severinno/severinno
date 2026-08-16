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
  /** Unix seconds — cookie TTL; used by the periodic TTL sweep to close
   *  sockets whose session expired without an explicit logout. */
  expiresAt?: number
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
// Session concurrency limit
//
// Keeps at most `maxSessions` sockets per user: the newest ones (by join
// time) stay, older ones are kicked with reason `session_limit`. Pure +
// generic — the realtime service wires it into the join handler via
// `io.fetchSockets()`, unit tests inject fakes. A socket that connected but
// never joined (no `joinedAt`) sorts as oldest, so stragglers are cleaned up
// first when over the limit.
// ---------------------------------------------------------------------------

/** Structural view of a socket for session-limit selection (adds `id` +
 *  `joinedAt`, which the join handler sets on `socket.data`). */
export interface DatedSessionSocketLike<TData extends object = object> {
  id: string
  data: {
    session?: VerifiedSession | null
    joinedAt?: string | null
  } & TData
}

/**
 * Select the sockets to kick so that at most `maxSessions` sockets per user
 * remain. Sockets are ordered by `joinedAt` ascending (oldest first; a
 * missing `joinedAt` sorts as the oldest — a connected-but-never-joined
 * straggler is kicked before an active session). The `excludeSocketId` is
 * the socket that JUST joined (the newest) — never kicked, even on equal
 * millisecond timestamps.
 *
 * Returns [] when the user is within the limit (or maxSessions < 1).
 */
export function selectSocketsToKickForSessionLimit<T extends DatedSessionSocketLike>(
  sockets: readonly T[],
  userId: string,
  maxSessions: number,
  excludeSocketId?: string,
): T[] {
  if (maxSessions < 1) return []
  const userSockets = filterSocketsBySessionUserId(sockets, userId)
  const kickCount = Math.max(0, userSockets.length - maxSessions)
  if (kickCount === 0) return []
  // Candidatos excluem o socket que acabou de dar join (nunca é derrubado), mas
  // o kickCount é calculado sobre o TOTAL (incluindo ele) — assim, mesmo num
  // empate de milissegundos (ordem arbitrária do fetchSockets), exatamente
  // kickCount sockets ANTIGOS são derrubados e o usuário fica com ≤ maxSessions.
  const candidates =
    excludeSocketId !== undefined
      ? userSockets.filter((s) => s.id !== excludeSocketId)
      : userSockets
  if (candidates.length === 0) return []
  const sorted = [...candidates].sort((a, b) => {
    const ta = new Date(a.data.joinedAt ?? 0).getTime()
    const tb = new Date(b.data.joinedAt ?? 0).getTime()
    return ta - tb
  })
  return sorted.slice(0, kickCount)
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

  return { userId, role, expiresAt }
}

/**
 * Select sockets whose verified session has expired by TTL (cookie
 * `expiresAt` in the past). Pure + generic (preserves the concrete socket
 * type so callers can `.emit()`/`.disconnect()`). Sockets without a session
 * or without `expiresAt` are never selected (a session fixed at handshake
 * without expiry can't be judged stale — fail-open on missing metadata, the
 * app-side revoke in src/lib/auth.ts is the primary path for those).
 */
export function selectExpiredSessionSockets<T extends SessionSocketLike>(
  sockets: readonly T[],
  nowMs: number,
): T[] {
  return sockets.filter((s) => {
    const expiresAt = s.data.session?.expiresAt
    return typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt * 1000 < nowMs
  })
}

// ---------------------------------------------------------------------------
// Emit telemetry (audit logging + /health session metrics)
//
// Pure helpers so the realtime service can (a) audit POST /emit events —
// which rooms / which userId they target — and (b) expose AGGREGATED session
// metrics on /health (the HMR-orphan-socket signal is a single user holding
// multiple simultaneous sockets: `usersWithMultipleSockets`). `source` is
// filled by the caller ("emit" for the server→server bridge). No socket.io /
// server imports — unit-tested with plain objects.
// ---------------------------------------------------------------------------

export interface EmitEventInfo {
  event: string
  /** Primary userId targeted by the event (room recipient for room events). */
  userId?: string
  /** Target room names (e.g. `user:{id}`) — empty for non-room events. */
  rooms: string[]
  /** Secondary ids in the payload (clientId/providerId for booking/quote). */
  relatedIds: string[]
}

/**
 * Extract audit metadata from an emit payload. Pure. Unknown events return
 * `rooms: []` (the HTTP handler 400s unknown events before calling this for
 * known ones). Missing/malformed fields degrade gracefully (no throw).
 */
export function extractEmitEventInfo(
  event: string,
  data: Record<string, unknown> | undefined,
): EmitEventInfo {
  const d = data ?? {}
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)
  const rooms: string[] = []
  const relatedIds: string[] = []
  let userId: string | undefined

  switch (event) {
    case "booking:update":
    case "quote:update": {
      const clientId = str(d.clientId)
      const providerId = str(d.providerId)
      if (clientId) rooms.push(`user:${clientId}`)
      if (providerId) rooms.push(`user:${providerId}`)
      userId = clientId
      if (providerId) relatedIds.push(providerId)
      break
    }
    case "message:send": {
      const toId = str(d.toId)
      const fromId = str(d.fromId)
      if (toId) rooms.push(`user:${toId}`)
      userId = toId
      // relatedIds = remetente (quem iniciou) — o alvo da room é o userId.
      if (fromId) relatedIds.push(fromId)
      break
    }
    case "notification:new": {
      const toId = str(d.toId)
      if (toId) rooms.push(`user:${toId}`)
      userId = toId
      break
    }
    case "tracking:position": {
      const clientId = str(d.clientId)
      if (clientId) rooms.push(`user:${clientId}`)
      userId = clientId
      break
    }
    case "session:revoke": {
      // Revoke is NOT a room broadcast (fetchSockets sweep) — userId only.
      userId = str(d.userId)
      break
    }
    default:
      break
  }
  return { event, userId, rooms, relatedIds }
}

// ---------------------------------------------------------------------------
// Session metrics (aggregated — for /health)
// ---------------------------------------------------------------------------

/** Structural view of an active-session entry (getActiveSessions output). */
export interface SessionMetaLike {
  userId: string
  role: string
  socketId: string
}

export interface SessionMetrics {
  total: number
  byRole: Record<string, number>
  /** Users holding >1 simultaneous socket — the HMR-orphan-socket signal. */
  usersWithMultipleSockets: number
  /** Highest socket count for a single user (0 when nobody is online). */
  maxSocketsPerUser: number
}

/**
 * Aggregate a session snapshot into /health-friendly metrics. Pure.
 * Works on the same entries as `getActiveSessions` (sockets with a verified
 * session AND a join) or a broader slice — the caller decides.
 */
export function summarizeActiveSessions(sessions: readonly SessionMetaLike[]): SessionMetrics {
  const byRole: Record<string, number> = {}
  const byUser = new Map<string, number>()
  for (const s of sessions) {
    byRole[s.role] = (byRole[s.role] ?? 0) + 1
    byUser.set(s.userId, (byUser.get(s.userId) ?? 0) + 1)
  }
  let usersWithMultipleSockets = 0
  let maxSocketsPerUser = 0
  for (const count of byUser.values()) {
    if (count > 1) usersWithMultipleSockets += 1
    if (count > maxSocketsPerUser) maxSocketsPerUser = count
  }
  return { total: sessions.length, byRole, usersWithMultipleSockets, maxSocketsPerUser }
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
