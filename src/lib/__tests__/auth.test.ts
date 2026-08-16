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

beforeEach(() => {
  vi.clearAllMocks()
  cookieStore.clear()
})

afterEach(() => {
  vi.unstubAllEnvs()
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
  // Constrói um cookie com assinatura VÁLIDA (mesmo HMAC do app) mas com
  // expiresAt no passado — o cenário "sessão expirou por TTL sem logout".
  function signExpiredCookie(userId: string, role: string, expiresAtSec = 0): string {
    const secret = process.env.SESSION_SECRET
    if (!secret) throw new Error("SESSION_SECRET não configurado no env de teste")
    const payload = `${userId}.${role}.${expiresAtSec}`
    const signature = createHmac("sha256", secret).update(payload).digest("hex")
    return `${payload}.${signature}`
  }

  it("emits session:revoke when a validly-signed cookie expired by TTL", async () => {
    cookieStore.set("severinno_session", { value: signExpiredCookie("ttl-user-1", "CLIENT") })
    expect(await getSession()).toBeNull()
    // Fire-and-forget (void) — aguarda a cadeia assíncrona completar.
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledTimes(1)
      expect(emitRealtime).toHaveBeenCalledWith("session:revoke", { userId: "ttl-user-1" })
    })
  })

  it("dedupes repeated getSession with the same expired cookie (1 emit/hour)", async () => {
    cookieStore.set("severinno_session", { value: signExpiredCookie("ttl-user-2", "CLIENT") })
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
    cookieStore.set("severinno_session", { value: signExpiredCookie("ttl-user-5", "CLIENT") })
    await getSession()
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledWith("session:revoke", { userId: "ttl-user-5" })
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
