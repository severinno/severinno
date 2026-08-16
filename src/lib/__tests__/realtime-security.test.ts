/**
 * Tests for mini-services/realtime/security.ts
 *
 * Pure security helpers shared by the realtime mini-service:
 *  - readSecret: docker-secret-aware env reading (_FILE support)
 *  - verifySessionCookie: HMAC session cookie validation (same format as
 *    src/lib/auth.ts — `${userId}.${role}.${expiresAt}.${signatureHex}`)
 *  - verifyEmitToken: constant-time Bearer token check for POST /emit
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { createHmac } from "node:crypto"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  SESSION_COOKIE_NAME,
  readSecret,
  parseCookieHeader,
  verifySessionCookie,
  verifyEmitToken,
  authorizeClientEvent,
  filterSocketsBySessionUserId,
  selectSocketsToKickForSessionLimit,
  selectExpiredSessionSockets,
  extractEmitEventInfo,
  summarizeActiveSessions,
  type BookingParticipantChecker,
  type VerifiedSession,
} from "../../../mini-services/realtime/security"

const SECRET = "test-session-secret-min-32-chars-long!!"

/** Sign a session cookie exactly like src/lib/auth.ts. */
function signSession(userId: string, role: string, expiresAt: number): string {
  const payload = `${userId}.${role}.${expiresAt}`
  const signature = createHmac("sha256", SECRET).update(payload).digest("hex")
  return `${payload}.${signature}`
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("parseCookieHeader", () => {
  it("parses a raw Cookie header into name → value", () => {
    const parsed = parseCookieHeader("a=1; b=two; severinno_session=abc.def")
    expect(parsed).toEqual({ a: "1", b: "two", severinno_session: "abc.def" })
  })

  it("returns {} for undefined / empty", () => {
    expect(parseCookieHeader(undefined)).toEqual({})
    expect(parseCookieHeader("")).toEqual({})
  })
})

describe("verifySessionCookie", () => {
  const future = Math.floor(Date.now() / 1000) + 3600
  const past = Math.floor(Date.now() / 1000) - 10

  it("returns the session payload (incl. expiresAt) for a valid signed cookie", () => {
    const cookie = signSession("user-1", "PROVIDER", future)
    const session = verifySessionCookie(`${SESSION_COOKIE_NAME}=${cookie}`, SECRET)
    expect(session).toEqual({ userId: "user-1", role: "PROVIDER", expiresAt: future })
  })

  it("returns null when the signature is tampered", () => {
    const cookie = signSession("user-1", "PROVIDER", future)
    const tampered = cookie.slice(0, -4) + "beef"
    expect(verifySessionCookie(`${SESSION_COOKIE_NAME}=${tampered}`, SECRET)).toBeNull()
  })

  it("returns null when the payload was modified (userId swapped)", () => {
    const cookie = signSession("user-1", "PROVIDER", future)
    const swapped = `user-2.${cookie.split(".").slice(1).join(".")}`
    expect(verifySessionCookie(`${SESSION_COOKIE_NAME}=${swapped}`, SECRET)).toBeNull()
  })

  it("returns null when the cookie is expired", () => {
    const cookie = signSession("user-1", "PROVIDER", past)
    expect(verifySessionCookie(`${SESSION_COOKIE_NAME}=${cookie}`, SECRET)).toBeNull()
  })

  it("returns null for malformed cookies", () => {
    expect(verifySessionCookie(`${SESSION_COOKIE_NAME}=only-two-parts`, SECRET)).toBeNull()
    expect(verifySessionCookie("", SECRET)).toBeNull()
    expect(verifySessionCookie(undefined, SECRET)).toBeNull()
  })

  it("returns null when the secret is not configured (fail closed)", () => {
    const cookie = signSession("user-1", "PROVIDER", future)
    expect(verifySessionCookie(`${SESSION_COOKIE_NAME}=${cookie}`, undefined)).toBeNull()
  })
})

describe("selectExpiredSessionSockets (TTL sweep)", () => {
  const now = Date.now()
  const future = Math.floor(now / 1000) + 3600
  const past = Math.floor(now / 1000) - 60
  const sock = (session: VerifiedSession | null, id = "sock-1") => ({ id, data: { session } })

  it("selects sockets whose session expiresAt is in the past", () => {
    const sockets = [
      sock({ userId: "u1", role: "CLIENT", expiresAt: past }, "old"),
      sock({ userId: "u2", role: "CLIENT", expiresAt: future }, "fresh"),
    ]
    expect(selectExpiredSessionSockets(sockets, now).map((s) => s.id)).toEqual(["old"])
  })

  it("ignores sockets without a session or without expiresAt", () => {
    const sockets = [sock(null, "no-session"), sock({ userId: "u3", role: "CLIENT" }, "no-expiry")]
    expect(selectExpiredSessionSockets(sockets, now)).toEqual([])
  })

  it("returns [] when nothing has expired", () => {
    const sockets = [sock({ userId: "u4", role: "CLIENT", expiresAt: future }, "fresh")]
    expect(selectExpiredSessionSockets(sockets, now)).toEqual([])
  })

  it("ignores a non-numeric expiresAt (malformed metadata)", () => {
    const sockets = [
      {
        id: "bad",
        data: {
          session: { userId: "u5", role: "CLIENT", expiresAt: "not-a-number" as unknown as number },
        },
      },
    ]
    expect(selectExpiredSessionSockets(sockets, now)).toEqual([])
  })
})

describe("extractEmitEventInfo (auditoria do POST /emit)", () => {
  it("booking:update → rooms do client e provider + userId do client", () => {
    const info = extractEmitEventInfo("booking:update", {
      bookingId: "b1",
      clientId: "client-1",
      providerId: "prov-1",
      status: "PENDING",
    })
    expect(info.event).toBe("booking:update")
    expect(info.rooms).toEqual(["user:client-1", "user:prov-1"])
    expect(info.userId).toBe("client-1")
    expect(info.relatedIds).toEqual(["prov-1"])
  })

  it("quote:update → mesmo padrão do booking:update", () => {
    const info = extractEmitEventInfo("quote:update", {
      quoteId: "q1",
      clientId: "client-1",
      providerId: "prov-1",
      status: "ACCEPTED",
    })
    expect(info.rooms).toEqual(["user:client-1", "user:prov-1"])
    expect(info.userId).toBe("client-1")
    expect(info.relatedIds).toEqual(["prov-1"])
  })

  it("message:send → room user:{toId}, userId = destinatário, relatedIds = remetente", () => {
    const info = extractEmitEventInfo("message:send", {
      fromId: "client-1",
      toId: "prov-1",
      content: "oi",
      bookingId: "b1",
    })
    expect(info.rooms).toEqual(["user:prov-1"])
    expect(info.userId).toBe("prov-1")
    expect(info.relatedIds).toEqual(["client-1"])
  })

  it("notification:new → room user:{toId}", () => {
    const info = extractEmitEventInfo("notification:new", { toId: "prov-1" })
    expect(info.rooms).toEqual(["user:prov-1"])
    expect(info.userId).toBe("prov-1")
  })

  it("tracking:position → room user:{clientId}", () => {
    const info = extractEmitEventInfo("tracking:position", {
      bookingId: "b1",
      clientId: "client-1",
      lat: -23.5,
      lng: -46.6,
    })
    expect(info.rooms).toEqual(["user:client-1"])
    expect(info.userId).toBe("client-1")
  })

  it("session:revoke → userId mas NENHUMA room (fetchSockets sweep, não broadcast)", () => {
    const info = extractEmitEventInfo("session:revoke", { userId: "user-9" })
    expect(info.userId).toBe("user-9")
    expect(info.rooms).toEqual([])
  })

  it("evento desconhecido → rooms vazios, sem throw", () => {
    expect(extractEmitEventInfo("custom:event", { a: 1 }).rooms).toEqual([])
    expect(extractEmitEventInfo("custom:event", undefined).rooms).toEqual([])
  })

  it("payload sem os campos esperados → degrada sem throw", () => {
    const info = extractEmitEventInfo("booking:update", {})
    expect(info.rooms).toEqual([])
    expect(info.userId).toBeUndefined()
    expect(info.relatedIds).toEqual([])
  })
})

describe("summarizeActiveSessions (métricas do /health)", () => {
  const sess = (userId: string, role: string, socketId: string) => ({ userId, role, socketId })

  it("agrega total + byRole", () => {
    const m = summarizeActiveSessions([
      sess("u1", "PROVIDER", "s1"),
      sess("u2", "CLIENT", "s2"),
      sess("u1", "PROVIDER", "s3"),
    ])
    expect(m.total).toBe(3)
    expect(m.byRole).toEqual({ PROVIDER: 2, CLIENT: 1 })
  })

  it("detecta usuário com múltiplos sockets (sinal de socket órfão do HMR)", () => {
    const m = summarizeActiveSessions([
      sess("u1", "PROVIDER", "s1"),
      sess("u1", "PROVIDER", "s2"),
      sess("u1", "PROVIDER", "s3"),
      sess("u2", "CLIENT", "s4"),
    ])
    expect(m.usersWithMultipleSockets).toBe(1)
    expect(m.maxSocketsPerUser).toBe(3)
  })

  it("lista vazia → zeros", () => {
    const m = summarizeActiveSessions([])
    expect(m).toEqual({ total: 0, byRole: {}, usersWithMultipleSockets: 0, maxSocketsPerUser: 0 })
  })

  it("todos com 1 socket → zero multi-sockets", () => {
    const m = summarizeActiveSessions([sess("u1", "CLIENT", "s1"), sess("u2", "PROVIDER", "s2")])
    expect(m.usersWithMultipleSockets).toBe(0)
    expect(m.maxSocketsPerUser).toBe(1)
  })
})

describe("verifyEmitToken", () => {
  const TOKEN = "emit-token-0123456789abcdef"

  it("accepts the correct Bearer token", () => {
    expect(verifyEmitToken(`Bearer ${TOKEN}`, TOKEN)).toBe(true)
  })

  it("rejects a wrong token", () => {
    expect(verifyEmitToken("Bearer wrong-token", TOKEN)).toBe(false)
  })

  it("rejects a missing Authorization header", () => {
    expect(verifyEmitToken(undefined, TOKEN)).toBe(false)
  })

  it("rejects a non-Bearer scheme", () => {
    expect(verifyEmitToken(`Basic ${TOKEN}`, TOKEN)).toBe(false)
    expect(verifyEmitToken(TOKEN, TOKEN)).toBe(false)
  })

  it("fails closed when the server token is not configured", () => {
    expect(verifyEmitToken(`Bearer ${TOKEN}`, undefined)).toBe(false)
  })
})

describe("authorizeClientEvent (requireSession extraído)", () => {
  const session = { userId: "user-1", role: "CLIENT" }
  const noBooking = { session, fromIds: ["user-1"] }

  it("allows a verified session matching fromId (sem bookingId)", async () => {
    await expect(authorizeClientEvent(noBooking)).resolves.toEqual({ ok: true })
  })

  it("denies when there is no verified session (NO_SESSION)", async () => {
    await expect(authorizeClientEvent({ session: null, fromIds: ["user-1"] })).resolves.toEqual({
      ok: false,
      reason: "NO_SESSION",
    })
  })

  it("denies when fromId does not match the session user (IDENTITY_MISMATCH)", async () => {
    await expect(authorizeClientEvent({ session, fromIds: ["user-999"] })).resolves.toEqual({
      ok: false,
      reason: "IDENTITY_MISMATCH",
    })
  })

  it("skips the identity check when fromIds is empty", async () => {
    await expect(authorizeClientEvent({ session, fromIds: [] })).resolves.toEqual({ ok: true })
  })

  it("allows message:send when the session user IS a booking participant", async () => {
    const isBookingParticipant: BookingParticipantChecker = vi.fn().mockResolvedValue(true)
    await expect(
      authorizeClientEvent({
        ...noBooking,
        bookingId: "bk-1",
        isBookingParticipant,
      }),
    ).resolves.toEqual({ ok: true })
  })

  it("denies message:send when the session user is NOT a booking participant", async () => {
    const isBookingParticipant: BookingParticipantChecker = vi.fn().mockResolvedValue(false)
    await expect(
      authorizeClientEvent({
        ...noBooking,
        bookingId: "bk-1",
        isBookingParticipant,
      }),
    ).resolves.toEqual({ ok: false, reason: "NOT_BOOKING_PARTICIPANT" })
  })

  it("fails closed (BOOKING_UNVERIFIABLE) when bookingId present but no resolver", async () => {
    await expect(authorizeClientEvent({ ...noBooking, bookingId: "bk-1" })).resolves.toEqual({
      ok: false,
      reason: "BOOKING_UNVERIFIABLE",
    })
  })

  it("handles an async participant resolver", async () => {
    const isBookingParticipant: BookingParticipantChecker = async () => true
    await expect(
      authorizeClientEvent({
        ...noBooking,
        bookingId: "bk-1",
        isBookingParticipant,
      }),
    ).resolves.toEqual({ ok: true })
  })

  it("propagates a throwing resolver as a rejected promise (caller handles)", async () => {
    const isBookingParticipant: BookingParticipantChecker = vi
      .fn()
      .mockRejectedValue(new Error("db down"))
    await expect(
      authorizeClientEvent({
        ...noBooking,
        bookingId: "bk-1",
        isBookingParticipant,
      }),
    ).rejects.toThrow("db down")
  })

  it("allows message:send when BOTH sender and recipient are participants", async () => {
    const isBookingParticipant: BookingParticipantChecker = vi.fn().mockResolvedValue(true)
    await expect(
      authorizeClientEvent({
        ...noBooking,
        bookingId: "bk-1",
        toId: "user-2",
        isBookingParticipant,
      }),
    ).resolves.toEqual({ ok: true })
    expect(isBookingParticipant).toHaveBeenCalledTimes(2) // sender + recipient
  })

  it("denies when the recipient is NOT a booking participant", async () => {
    const isBookingParticipant: BookingParticipantChecker = vi.fn(
      (_bk: string, userId: string) => userId === "user-1",
    )
    await expect(
      authorizeClientEvent({
        ...noBooking,
        bookingId: "bk-1",
        toId: "user-999",
        isBookingParticipant,
      }),
    ).resolves.toEqual({ ok: false, reason: "RECIPIENT_NOT_BOOKING_PARTICIPANT" })
  })

  it("skips the recipient check when toId is absent", async () => {
    const isBookingParticipant: BookingParticipantChecker = vi.fn().mockResolvedValue(true)
    await expect(
      authorizeClientEvent({
        ...noBooking,
        bookingId: "bk-1",
        isBookingParticipant,
      }),
    ).resolves.toEqual({ ok: true })
    expect(isBookingParticipant).toHaveBeenCalledTimes(1) // só o sender
  })
})

describe("filterSocketsBySessionUserId", () => {
  const sock = (userId: string | null) => ({
    data: { session: userId ? { userId, role: "CLIENT" } : null },
  })

  it("returns sockets whose verified session matches the revoked userId", () => {
    const sockets = [sock("user-1"), sock("user-2"), sock("user-1"), sock(null)]
    const matched = filterSocketsBySessionUserId(sockets, "user-1")
    expect(matched).toHaveLength(2)
  })

  it("matches sockets WITHOUT room membership (connected but never joined)", () => {
    // A connected-but-not-joined socket still carries the session fixed at
    // handshake (socket.data.session) — the filter matches on that, not on
    // room membership, so revocation reaches it too.
    const joined = { data: { session: { userId: "user-1", role: "CLIENT" } } }
    const neverJoined = { data: { session: { userId: "user-1", role: "CLIENT" } } }
    const other = { data: { session: { userId: "user-2", role: "PROVIDER" } } }
    expect(filterSocketsBySessionUserId([joined, neverJoined, other], "user-1")).toEqual([
      joined,
      neverJoined,
    ])
  })

  it("ignores sockets without a verified session (null/undefined)", () => {
    const noSession = { data: {} }
    const nullSession = sock(null)
    const withSession = sock("user-1")
    expect(filterSocketsBySessionUserId([noSession, nullSession, withSession], "user-1")).toEqual([
      withSession,
    ])
  })

  it("returns an empty array when no socket matches", () => {
    expect(filterSocketsBySessionUserId([sock("user-2")], "user-1")).toEqual([])
  })

  it("preserves the concrete socket type (callers can emit/disconnect)", () => {
    const socketLike = {
      data: { session: { userId: "user-1", role: "CLIENT" } },
      disconnect: vi.fn(),
    }
    const [matched] = filterSocketsBySessionUserId([socketLike], "user-1")
    matched.disconnect(true)
    expect(socketLike.disconnect).toHaveBeenCalledWith(true)
  })
})

describe("selectSocketsToKickForSessionLimit", () => {
  const sock = (id: string, userId: string, joinedAt: string | null) => ({
    id,
    data: {
      session: { userId, role: "CLIENT" },
      joinedAt,
    },
  })

  it("keeps the newest sockets and kicks the older ones (limit 1)", () => {
    const sockets = [
      sock("oldest", "user-1", "2026-08-16T10:00:00.000Z"),
      sock("newest", "user-1", "2026-08-16T10:05:00.000Z"),
    ]
    const toKick = selectSocketsToKickForSessionLimit(sockets, "user-1", 1)
    expect(toKick.map((s) => s.id)).toEqual(["oldest"])
  })

  it("keeps the two newest when limit is 2 (three sockets)", () => {
    const sockets = [
      sock("a", "user-1", "2026-08-16T10:00:00.000Z"),
      sock("b", "user-1", "2026-08-16T10:01:00.000Z"),
      sock("c", "user-1", "2026-08-16T10:02:00.000Z"),
    ]
    const toKick = selectSocketsToKickForSessionLimit(sockets, "user-1", 2)
    expect(toKick.map((s) => s.id)).toEqual(["a"])
  })

  it("returns [] when the user is within the limit", () => {
    const sockets = [sock("a", "user-1", "2026-08-16T10:00:00.000Z")]
    expect(selectSocketsToKickForSessionLimit(sockets, "user-1", 1)).toEqual([])
    expect(selectSocketsToKickForSessionLimit([], "user-1", 1)).toEqual([])
  })

  it("ignores sockets of OTHER users", () => {
    const sockets = [
      sock("mine-old", "user-1", "2026-08-16T10:00:00.000Z"),
      sock("mine-new", "user-1", "2026-08-16T10:05:00.000Z"),
      sock("other", "user-2", "2026-08-16T09:00:00.000Z"),
    ]
    const toKick = selectSocketsToKickForSessionLimit(sockets, "user-1", 1)
    expect(toKick.map((s) => s.id)).toEqual(["mine-old"])
  })

  it("sorts a connected-but-never-joined socket as the oldest (straggler first)", () => {
    // 3 sockets do mesmo user com limite 1 → 2 devem ser derrubados; o
    // straggler (sem joinedAt → epoch 0) é o MAIS antigo e vem primeiro.
    const sockets = [
      sock("straggler", "user-1", null), // connected, never joined
      sock("joined", "user-1", "2026-08-16T10:00:00.000Z"),
      sock("joined-new", "user-1", "2026-08-16T10:05:00.000Z"),
    ]
    const toKick = selectSocketsToKickForSessionLimit(sockets, "user-1", 1)
    expect(toKick.map((s) => s.id)).toEqual(["straggler", "joined"])
  })

  it("never kicks the just-joined socket (excludeSocketId), even on equal timestamps", () => {
    const t = "2026-08-16T10:00:00.000Z"
    const sockets = [sock("older", "user-1", t), sock("justJoined", "user-1", t)]
    const toKick = selectSocketsToKickForSessionLimit(sockets, "user-1", 1, "justJoined")
    expect(toKick.map((s) => s.id)).toEqual(["older"])
  })

  it("returns [] when maxSessions < 1 (misconfiguration guard)", () => {
    const sockets = [
      sock("a", "user-1", "2026-08-16T10:00:00.000Z"),
      sock("b", "user-1", "2026-08-16T10:05:00.000Z"),
    ]
    expect(selectSocketsToKickForSessionLimit(sockets, "user-1", 0)).toEqual([])
    expect(selectSocketsToKickForSessionLimit(sockets, "user-1", -1)).toEqual([])
  })

  it("preserves the concrete socket type (callers can emit/disconnect)", () => {
    const older = {
      id: "older",
      data: { session: { userId: "user-1", role: "CLIENT" }, joinedAt: "2026-08-16T10:00:00.000Z" },
      disconnect: vi.fn(),
    }
    const newer = {
      id: "newer",
      data: { session: { userId: "user-1", role: "CLIENT" }, joinedAt: "2026-08-16T10:05:00.000Z" },
      disconnect: vi.fn(),
    }
    const [kicked] = selectSocketsToKickForSessionLimit([older, newer], "user-1", 1)
    kicked.disconnect(true)
    expect(older.disconnect).toHaveBeenCalledWith(true)
  })
})

describe("readSecret", () => {
  it("reads from the plain env var", () => {
    vi.stubEnv("REALTIME_EMIT_TOKEN", "from-env")
    expect(readSecret("REALTIME_EMIT_TOKEN")).toBe("from-env")
  })

  it("prefers the _FILE path over the env var", () => {
    const dir = mkdtempSync(join(tmpdir(), "realtime-sec-"))
    const file = join(dir, "emit_token")
    writeFileSync(file, "from-file\n", "utf8")
    try {
      vi.stubEnv("REALTIME_EMIT_TOKEN_FILE", file)
      vi.stubEnv("REALTIME_EMIT_TOKEN", "from-env")
      expect(readSecret("REALTIME_EMIT_TOKEN")).toBe("from-file")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("returns undefined when unset", () => {
    expect(readSecret("SOME_UNSET_SECRET_XYZ")).toBeUndefined()
  })
})
