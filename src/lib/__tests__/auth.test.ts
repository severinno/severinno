import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createHmac } from "node:crypto"

vi.mock("../logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Use vi.hoisted to avoid hoisting issues with vi.mock()
const { mockDb, cookieStore } = vi.hoisted(() => ({
  mockDb: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
  cookieStore: new Map<string, { value: string }>(),
}))

vi.mock("../db", () => ({
  default: mockDb,
  db: mockDb,
}))

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieStore.get(name) ?? null,
    set: (name: string, value: string, _opts?: Record<string, unknown>) => {
      cookieStore.set(name, { value })
    },
    delete: (name: string) => {
      cookieStore.delete(name)
    },
  }),
  headers: () => new Headers(),
}))

// destroySession now emits a realtime revocation (logout → disconnect
// sockets). Mock the bridge so unit tests never hit the network.
vi.mock("../realtime-client", () => ({
  emitRealtime: vi.fn(),
}))

import {
  createSession,
  getSession,
  destroySession,
  revokeUserSessions,
  requireUser,
  requireRole,
  getOptionalSession,
  resolveCookieMaxAgeSeconds,
} from "../auth"
import { emitRealtime } from "../realtime-client"

const VALID_USER = {
  id: "user-1",
  email: "test@test.com",
  name: "Test User",
  role: "CLIENT",
  active: true,
  verified: true,
}

/**
 * Assina um cookie de sessão com o MESMO HMAC do app (formato real
 * `${userId}.${role}.${expiresAt}.${signatureHex}`) para cenários de
 * TTL expirado / janela de rotação. expiresAtSec default = 0 (expirado).
 */
function signValidCookie(userId: string, role: string, expiresAtSec = 0): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error("SESSION_SECRET não configurado no env de teste")
  const payload = `${userId}.${role}.${expiresAtSec}`
  const signature = createHmac("sha256", secret).update(payload).digest("hex")
  return `${payload}.${signature}`
}

beforeEach(() => {
  vi.clearAllMocks()
  cookieStore.clear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("resolveCookieMaxAgeSeconds (env SESSION_COOKIE_MAX_AGE_SECONDS)", () => {
  const THIRTY_DAYS = 60 * 60 * 24 * 30

  it("returns the configured TTL when valid (>= 60s)", () => {
    expect(resolveCookieMaxAgeSeconds("120")).toBe(120)
    expect(resolveCookieMaxAgeSeconds("604800")).toBe(604800) // 7 dias
    expect(resolveCookieMaxAgeSeconds("3600")).toBe(3600)
  })

  it("uses the 30d default for missing/empty/non-numeric", () => {
    expect(resolveCookieMaxAgeSeconds(undefined)).toBe(THIRTY_DAYS)
    expect(resolveCookieMaxAgeSeconds("")).toBe(THIRTY_DAYS)
    expect(resolveCookieMaxAgeSeconds("abc")).toBe(THIRTY_DAYS)
    expect(resolveCookieMaxAgeSeconds("2d")).toBe(THIRTY_DAYS)
  })

  it("uses the default for '0' (falsy) — um cookie sem TTL quebraria a sessão", () => {
    expect(resolveCookieMaxAgeSeconds("0")).toBe(THIRTY_DAYS)
  })

  it("uses the default for non-finite values (Infinity quebraria o maxAge do cookie)", () => {
    expect(resolveCookieMaxAgeSeconds("1e309")).toBe(THIRTY_DAYS)
  })

  it("clamps sub-minute values to 60s (TTL < 1min é patológico)", () => {
    expect(resolveCookieMaxAgeSeconds("15")).toBe(60)
    expect(resolveCookieMaxAgeSeconds("-10")).toBe(60)
    expect(resolveCookieMaxAgeSeconds("1")).toBe(60)
  })
})

describe("createSession", () => {
  it("creates a session with valid format", async () => {
    const session = await createSession("user-1", "CLIENT")
    expect(session).toHaveProperty("userId", "user-1")
    expect(session).toHaveProperty("role", "CLIENT")
    expect(session).toHaveProperty("expiresAt")
    // expiresAt is in SECONDS (Unix timestamp), Date.now() is in milliseconds
    expect(session.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) - 10)
  })

  it("creates session for PROVIDER and ADMIN roles", async () => {
    const p = await createSession("prov-1", "PROVIDER")
    expect(p.role).toBe("PROVIDER")

    const a = await createSession("admin-1", "ADMIN")
    expect(a.role).toBe("ADMIN")
  })

  it("sets cookie readable by getSession", async () => {
    await createSession("user-1", "CLIENT")
    const session = await getSession()
    expect(session).not.toBeNull()
    expect(session!.userId).toBe("user-1")
  })
})

describe("getSession", () => {
  it("returns null when no cookie exists", async () => {
    expect(await getSession()).toBeNull()
  })

  it("returns session data for valid cookie", async () => {
    await createSession("user-1", "CLIENT")
    const session = await getSession()
    expect(session).not.toBeNull()
    expect(session!.userId).toBe("user-1")
    expect(session!.role).toBe("CLIENT")
  })

  it("exposes the cookie expiresAt (for the dashboard countdown)", async () => {
    const before = Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60 // 20d restantes
    cookieStore.set("severinno_session", { value: signValidCookie("exp-user-1", "CLIENT", before) })
    const session = await getSession()
    expect(session).not.toBeNull()
    expect(session!.expiresAt).toBe(before)
  })

  it("exposes the NEW expiresAt after rotation (reissue <15d)", async () => {
    const old = Math.floor(Date.now() / 1000) + 10 * 24 * 60 * 60 // 10d restantes < 15d
    cookieStore.set("severinno_session", { value: signValidCookie("exp-user-2", "CLIENT", old) })
    const session = await getSession()
    expect(session).not.toBeNull()
    // O expiry efetivo é o NOVO (30d do momento da reemissão), não o antigo.
    expect(session!.expiresAt).toBeGreaterThan(old + 15 * 24 * 60 * 60)
  })

  it("returns null for tampered cookie", async () => {
    await createSession("user-1", "CLIENT")
    const existing = cookieStore.get("severinno_session")
    if (existing) {
      cookieStore.set("severinno_session", {
        value: existing.value.split(".").slice(0, 3).join(".") + ".BAD",
      })
    }
    expect(await getSession()).toBeNull()
  })

  it("returns null for expired cookie", async () => {
    await createSession("user-1", "CLIENT")
    const existing = cookieStore.get("severinno_session")
    if (existing) {
      const parts = existing.value.split(".")
      if (parts.length >= 3) {
        parts[2] = "0"
        cookieStore.set("severinno_session", { value: parts.join(".") })
      }
    }
    expect(await getSession()).toBeNull()
  })
})

describe("getSession — TTL-expiry realtime revocation", () => {
  // ATENÇÃO (footgun): os Maps de dedupe do auth.ts (expiredRevokeEmittedAt /
  // sessionRenewedAt) são module-level e NÃO resetam no beforeEach — cada
  // teste precisa de userIds DISTINTOS (ttl-user-* / rot-user-*), senão a
  // janela de 1h suprime o emit silenciosamente.
  it("emits session:revoke when a validly-signed cookie expired by TTL", async () => {
    cookieStore.set("severinno_session", { value: signValidCookie("ttl-user-1", "CLIENT") })
    expect(await getSession()).toBeNull()
    // Fire-and-forget (void) — aguarda a cadeia assíncrona completar.
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledTimes(1)
      expect(emitRealtime).toHaveBeenCalledWith("session:revoke", { userId: "ttl-user-1" })
    })
  })

  it("dedupes repeated getSession with the same expired cookie (1 emit/hour)", async () => {
    cookieStore.set("severinno_session", { value: signValidCookie("ttl-user-2", "CLIENT") })
    await getSession()
    await getSession()
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledTimes(1)
      expect(emitRealtime).toHaveBeenCalledWith("session:revoke", { userId: "ttl-user-2" })
    })
  })

  it("does not emit session:revoke for a valid (non-expired) cookie", async () => {
    await createSession("ttl-user-3", "CLIENT")
    expect(await getSession()).not.toBeNull()
    expect(emitRealtime).not.toHaveBeenCalled()
  })

  it("does not emit session:revoke for a tampered cookie (signature mismatch)", async () => {
    cookieStore.set("severinno_session", { value: "ttl-user-4.CLIENT.0.deadbeef" })
    expect(await getSession()).toBeNull()
    expect(emitRealtime).not.toHaveBeenCalled()
  })

  it("emits independently per userId (no cross-user suppression)", async () => {
    cookieStore.set("severinno_session", { value: signValidCookie("ttl-user-5", "CLIENT") })
    await getSession()
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledWith("session:revoke", { userId: "ttl-user-5" })
    })
  })
})

describe("getSession — rotação de cookie (<15d) → session:renew", () => {
  // Constrói um cookie com assinatura VÁLIDA (mesmo HMAC do app) mas com
  // expiresAt DENTRO da janela de rotação (menos de 15d restantes) — o
  // cenário "cookie reemitido" que precisa propagar o novo expiry ao realtime
  // para o sweep de TTL não fechar uma sessão reemitida válida.
  // userIds DISTINTOS (rot-user-*) por teste: Map module-level não reseta.
  const TEN_DAYS = 10 * 24 * 60 * 60 // 10d restantes < threshold de 15d

  it("emits session:renew com o NOVO expiresAt quando o cookie é reemitido (<15d restantes)", async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const oldExpiresAt = nowSec + TEN_DAYS
    cookieStore.set("severinno_session", {
      value: signValidCookie("rot-user-1", "CLIENT", oldExpiresAt),
    })
    expect(await getSession()).not.toBeNull()
    // Fire-and-forget (void) — aguarda a cadeia assíncrona completar.
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledTimes(1)
      expect(emitRealtime).toHaveBeenCalledWith("session:renew", {
        userId: "rot-user-1",
        expiresAt: expect.any(Number),
      })
    })
    // O novo expiresAt é um refresh de 30d — muito além do expiry original
    // (10d restantes): a sessão reemitida NÃO pode ser fechada pelo sweep.
    const payload = vi.mocked(emitRealtime).mock.calls[0]![1] as { expiresAt: number }
    expect(payload.expiresAt).toBeGreaterThan(oldExpiresAt + 15 * 24 * 60 * 60)
  })

  it("dedupe: getSession repetido com cookie reemitível → 1 emit session:renew (janela 1h)", async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    cookieStore.set("severinno_session", {
      value: signValidCookie("rot-user-2", "CLIENT", nowSec + TEN_DAYS),
    })
    await getSession()
    await getSession()
    await vi.waitFor(() => {
      const renewCalls = vi
        .mocked(emitRealtime)
        .mock.calls.filter(([event]) => event === "session:renew")
      expect(renewCalls).toHaveLength(1)
    })
  })

  it("não emite session:renew para cookie com >15d restantes (fora da janela de rotação)", async () => {
    await createSession("rot-user-3", "CLIENT") // 30d restantes
    expect(await getSession()).not.toBeNull()
    expect(emitRealtime).not.toHaveBeenCalled()
  })

  it("não emite session:renew para cookie expirado (esse caminho emite session:revoke)", async () => {
    cookieStore.set("severinno_session", {
      value: signValidCookie("rot-user-4", "CLIENT", 0),
    })
    expect(await getSession()).toBeNull()
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledWith("session:revoke", { userId: "rot-user-4" })
    })
    // NUNCA session:renew no caminho de expiração (só revoke).
    const renewCalls = vi
      .mocked(emitRealtime)
      .mock.calls.filter(([event]) => event === "session:renew")
    expect(renewCalls).toHaveLength(0)
  })

  it("não emite session:renew para cookie com assinatura inválida (tampered)", async () => {
    cookieStore.set("severinno_session", { value: "rot-user-5.CLIENT.999999.deadbeef" })
    expect(await getSession()).toBeNull()
    expect(emitRealtime).not.toHaveBeenCalled()
  })

  it("emite independentemente por userId (sem supressão cross-user)", async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    cookieStore.set("severinno_session", {
      value: signValidCookie("rot-user-6", "CLIENT", nowSec + TEN_DAYS),
    })
    expect(await getSession()).not.toBeNull()
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledWith("session:renew", {
        userId: "rot-user-6",
        expiresAt: expect.any(Number),
      })
    })
  })
})

describe("destroySession", () => {
  it("clears the session cookie", async () => {
    await createSession("user-1", "CLIENT")
    expect(await getSession()).not.toBeNull()
    await destroySession()
    expect(await getSession()).toBeNull()
  })

  it("emits session:revoke with the logged-in userId (logout → realtime disconnect)", async () => {
    await createSession("user-1", "CLIENT")
    await destroySession()
    expect(emitRealtime).toHaveBeenCalledTimes(1)
    expect(emitRealtime).toHaveBeenCalledWith("session:revoke", { userId: "user-1" })
  })

  it("does not emit session:revoke when there is no active session", async () => {
    await destroySession()
    expect(emitRealtime).not.toHaveBeenCalled()
  })

  it("does not emit session:revoke when the cookie was tampered", async () => {
    cookieStore.set("severinno_session", { value: "tampered.value.here.bad" })
    await destroySession()
    expect(emitRealtime).not.toHaveBeenCalled()
  })
})

describe("revokeUserSessions", () => {
  it("emits session:revoke for the given userId (admin deactivation/delete)", async () => {
    await revokeUserSessions("user-42")
    expect(emitRealtime).toHaveBeenCalledTimes(1)
    expect(emitRealtime).toHaveBeenCalledWith("session:revoke", { userId: "user-42" })
  })

  it("emits for any user without needing a session cookie (admin flow)", async () => {
    await revokeUserSessions("some-other-user")
    expect(emitRealtime).toHaveBeenCalledTimes(1)
    expect(emitRealtime).toHaveBeenCalledWith("session:revoke", {
      userId: "some-other-user",
    })
  })
})

describe("requireUser", () => {
  it("returns session for valid authenticated user", async () => {
    await createSession("user-1", "CLIENT")
    mockDb.user.findUnique.mockResolvedValue(VALID_USER)
    const session = await requireUser()
    expect(session.userId).toBe("user-1")
    expect(session.role).toBe("CLIENT")
  })

  it("throws UNAUTHORIZED when no session exists", async () => {
    await expect(requireUser()).rejects.toThrow("UNAUTHORIZED")
  })

  it("throws UNAUTHORIZED when user is not active", async () => {
    await createSession("user-1", "CLIENT")
    mockDb.user.findUnique.mockResolvedValue({ ...VALID_USER, active: false })
    await expect(requireUser()).rejects.toThrow("UNAUTHORIZED")
  })

  it("throws UNAUTHORIZED when user not found in DB", async () => {
    await createSession("user-1", "CLIENT")
    mockDb.user.findUnique.mockResolvedValue(null)
    await expect(requireUser()).rejects.toThrow("UNAUTHORIZED")
  })
})

describe("requireRole", () => {
  it("passes when role matches", async () => {
    await createSession("user-1", "CLIENT")
    mockDb.user.findUnique.mockResolvedValue(VALID_USER)
    const session = await requireRole("CLIENT")
    expect(session.role).toBe("CLIENT")
  })

  it("throws FORBIDDEN when role does not match", async () => {
    await createSession("user-1", "CLIENT")
    mockDb.user.findUnique.mockResolvedValue(VALID_USER)
    await expect(requireRole("ADMIN")).rejects.toThrow("FORBIDDEN")
    await expect(requireRole("PROVIDER")).rejects.toThrow("FORBIDDEN")
  })

  it("throws UNAUTHORIZED when not logged in", async () => {
    await expect(requireRole("CLIENT")).rejects.toThrow("UNAUTHORIZED")
  })
})

describe("demo accounts — server-side block (defense-in-depth)", () => {
  it("trata conta demo como inativa em produção (invalida sessão existente)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    await createSession("demo-admin-prod", "ADMIN")
    mockDb.user.findUnique.mockResolvedValue({
      ...VALID_USER,
      id: "demo-admin-prod",
      email: "admin@severinno.com",
      role: "ADMIN",
    })
    await expect(requireUser()).rejects.toThrow("UNAUTHORIZED")
  })

  it("permite conta demo fora de produção", async () => {
    vi.stubEnv("NODE_ENV", "test")
    await createSession("demo-admin-dev", "ADMIN")
    mockDb.user.findUnique.mockResolvedValue({
      ...VALID_USER,
      id: "demo-admin-dev",
      email: "admin@severinno.com",
      role: "ADMIN",
    })
    const session = await requireUser()
    expect(session.userId).toBe("demo-admin-dev")
  })
})

describe("getOptionalSession", () => {
  it("returns session for valid user", async () => {
    await createSession("user-1", "CLIENT")
    mockDb.user.findUnique.mockResolvedValue(VALID_USER)
    const session = await getOptionalSession()
    expect(session).not.toBeNull()
    expect(session!.userId).toBe("user-1")
  })

  it("returns null without throwing when not logged in", async () => {
    expect(await getOptionalSession()).toBeNull()
  })

  it("returns null without throwing when user is inactive", async () => {
    await createSession("user-1", "CLIENT")
    mockDb.user.findUnique.mockResolvedValue({ ...VALID_USER, active: false })
    expect(await getOptionalSession()).toBeNull()
  })

  it("returns null without throwing when cookie is invalid", async () => {
    cookieStore.set("severinno_session", { value: "bad.format.data" })
    expect(await getOptionalSession()).toBeNull()
  })
})
