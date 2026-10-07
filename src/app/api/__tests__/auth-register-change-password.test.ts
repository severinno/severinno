import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheInvalidate: vi.fn().mockResolvedValue(undefined),
  withCache: vi.fn().mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: {
    general: { prefix: "general", max: 30, windowMs: 60000 },
    register: { prefix: "register", max: 5, windowMs: 60000 },
    forgotPassword: { prefix: "forgot-pw", max: 3, windowMs: 600000 },
  },
}))

// Guard progressivo por fingerprint — no-op nos testes de rota.
vi.mock("@/lib/auth-rate-limit", () => ({
  authFingerprintGuard: vi.fn(async () => ({
    fingerprint: "test:fp",
    blocked: false,
    response: null,
    recordFailure: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

let _mockSession: any = null

import { makeAuthError } from "@/lib/__tests__/helpers/auth-mock"

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockImplementation(async () => {
    const s = _mockSession
    if (!s) throw makeAuthError("UNAUTHORIZED")
    return s
  }),
  createSession: vi.fn().mockResolvedValue(undefined),
  invalidateSessionCache: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/crypto", () => ({
  hashPassword: vi.fn().mockReturnValue("new-mocked-hash"),
  verifyPassword: vi.fn().mockReturnValue(true),
}))

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/notification-queue", () => ({
  saveAndQueueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/mail", () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  passwordChangedHtml: vi.fn().mockReturnValue("<html></html>"),
}))

vi.mock("@/lib/sentry", () => ({
  captureError: vi.fn(),
}))

vi.mock("@/lib/demo-accounts", () => ({
  isDemoAccountsEnabled: vi.fn(() => true),
  isDemoAccountEmail: vi.fn(() => false),
}))

vi.mock("@/lib/event-hub", () => ({
  fireEvent: vi.fn().mockResolvedValue(undefined),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST as register } from "../auth/register/route"
import { POST as changePassword } from "../auth/change-password/route"
import { db } from "@/lib/db"
import { verifyPassword, hashPassword } from "@/lib/crypto"
import { createSession, invalidateSessionCache } from "@/lib/auth"

// ── Tests: Register ────────────────────────────────────────────────────────

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = null
  })

  it("creates a client user and returns 201", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)
    ;(vi.mocked(db.user.create) as any).mockResolvedValue({
      id: "user-2",
      name: "Maria Souza",
      email: "maria@example.com",
      role: "CLIENT",
      avatarUrl: null,
    })

    const res = await register(
      createMockRequest({
        method: "POST",
        body: {
          name: "Maria Souza",
          email: "maria@example.com",
          password: "Senha1234",
          confirmPassword: "Senha1234",
          role: "CLIENT",
        },
      }),
      { params: Promise.resolve({}) },
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(201)
    expect((parsed.body as any).user.email).toBe("maria@example.com")
    expect((parsed.body as any).user.role).toBe("CLIENT")
    expect(hashPassword).toHaveBeenCalledWith("Senha1234")
    expect(createSession).toHaveBeenCalled()
  })

  it("returns 409 for duplicate email", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({ id: "existing" })

    const res = await register(
      createMockRequest({
        method: "POST",
        body: {
          name: "Maria Souza",
          email: "existing@example.com",
          password: "Senha1234",
          confirmPassword: "Senha1234",
          role: "CLIENT",
        },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(409)
  })

  it("returns 400 for invalid data (weak password)", async () => {
    const res = await register(
      createMockRequest({
        method: "POST",
        body: {
          name: "Maria",
          email: "maria@example.com",
          password: "12",
          confirmPassword: "12",
          role: "CLIENT",
        },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for mismatched passwords", async () => {
    const res = await register(
      createMockRequest({
        method: "POST",
        body: {
          name: "Maria Souza",
          email: "maria@example.com",
          password: "Senha1234",
          confirmPassword: "4321anesuS",
          role: "CLIENT",
        },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for missing required fields", async () => {
    const res = await register(
      createMockRequest({
        method: "POST",
        body: { name: "Maria" },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(400)
  })

  it("creates a provider with extra fields", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)
    ;(vi.mocked(db.user.create) as any).mockResolvedValue({
      id: "user-3",
      name: "Carlos Prestador",
      email: "carlos@example.com",
      role: "PROVIDER",
      avatarUrl: null,
    })

    const res = await register(
      createMockRequest({
        method: "POST",
        body: {
          name: "Carlos Prestador",
          email: "carlos@example.com",
          password: "Senha1234",
          confirmPassword: "Senha1234",
          role: "PROVIDER",
          cpfCnpj: "12.345.678/0001-90",
          whatsapp: "11999999999",
          city: "São Paulo",
          bio: "Experiência em reformas",
          radiusKm: 20,
        },
      }),
      { params: Promise.resolve({}) },
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(201)
    expect((parsed.body as any).user.role).toBe("PROVIDER")
  })
})

// ── Tests: Change Password ─────────────────────────────────────────────────

describe("POST /api/auth/change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = { userId: "user-1", role: "CLIENT" }
  })

  it("changes password successfully", async () => {
    vi.mocked(verifyPassword).mockReturnValue(true)
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      passwordHash: "old-hash",
      name: "João",
      email: "joao@example.com",
    })

    const res = await changePassword(
      createMockRequest({
        method: "POST",
        body: { currentPassword: "OldSenha123", newPassword: "NewSenha456" },
      }),
      { params: Promise.resolve({}) },
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
    expect(hashPassword).toHaveBeenCalledWith("NewSenha456")
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        passwordHash: "new-mocked-hash",
        sessionVersion: { increment: 1 },
      },
    })
    expect(invalidateSessionCache).toHaveBeenCalledWith("user-1")
  })

  it("returns 400 when current password is wrong", async () => {
    vi.mocked(verifyPassword).mockReturnValue(false)
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      passwordHash: "old-hash",
      name: "João",
      email: "joao@example.com",
    })

    const res = await changePassword(
      createMockRequest({
        method: "POST",
        body: { currentPassword: "WrongPass123", newPassword: "NewSenha456" },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when new password is too weak", async () => {
    vi.mocked(verifyPassword).mockReturnValue(true)
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      passwordHash: "old-hash",
      name: "João",
      email: "joao@example.com",
    })

    const res = await changePassword(
      createMockRequest({
        method: "POST",
        body: { currentPassword: "OldSenha123", newPassword: "123" },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when missing fields", async () => {
    const res = await changePassword(
      createMockRequest({
        method: "POST",
        body: { currentPassword: "OldSenha123" },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when user not found", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)

    const res = await changePassword(
      createMockRequest({
        method: "POST",
        body: { currentPassword: "OldSenha123", newPassword: "NewSenha456" },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(400)
  })

  it("rejects common passwords", async () => {
    vi.mocked(verifyPassword).mockReturnValue(true)
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      passwordHash: "old-hash",
      name: "João",
      email: "joao@example.com",
    })

    const res = await changePassword(
      createMockRequest({
        method: "POST",
        body: { currentPassword: "OldSenha123", newPassword: "Password1" },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(400)
  })
})
