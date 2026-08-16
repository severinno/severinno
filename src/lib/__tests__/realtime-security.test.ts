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
  type BookingParticipantChecker,
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

  it("returns the session payload for a valid signed cookie", () => {
    const cookie = signSession("user-1", "PROVIDER", future)
    const session = verifySessionCookie(`${SESSION_COOKIE_NAME}=${cookie}`, SECRET)
    expect(session).toEqual({ userId: "user-1", role: "PROVIDER" })
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
