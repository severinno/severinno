/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest"

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

import {
  createSession,
  getSession,
  destroySession,
  requireUser,
  requireRole,
  getOptionalSession,
} from "../auth"

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

describe("destroySession", () => {
  it("clears the session cookie", async () => {
    await createSession("user-1", "CLIENT")
    expect(await getSession()).not.toBeNull()
    await destroySession()
    expect(await getSession()).toBeNull()
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
