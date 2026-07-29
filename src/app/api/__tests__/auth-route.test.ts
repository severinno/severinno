// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/with-rate-limit", () => ({
  withRateLimit: (handler: (...args: unknown[]) => unknown) => handler,
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Auth functions — use mutable module-level variables so per-test setup works
let _mockSession: any = null

vi.mock("@/lib/auth", () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
  destroySession: vi.fn().mockResolvedValue(undefined),
  requireUser: vi.fn().mockImplementation(async () => {
    const s = _mockSession
    if (!s) throw new Error("UNAUTHORIZED")
    return s
  }),
  getOptionalSession: vi.fn().mockImplementation(async () => _mockSession),
}))

vi.mock("@/lib/crypto", () => ({
  hashPassword: vi.fn().mockReturnValue("mocked-salt:mocked-hash"),
  verifyPassword: vi.fn().mockReturnValue(true),
}))

vi.mock("@/lib/notification-queue", () => ({
  saveAndQueueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/mail", () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  adminNewProviderHtml: vi.fn().mockReturnValue("<html></html>"),
}))

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST as login } from "../auth/login/route"
import { POST as register } from "../auth/register/route"
import { POST as logout } from "../auth/logout/route"
import { GET as me } from "../auth/me/route"
import { createSession, destroySession } from "@/lib/auth"
import { verifyPassword, hashPassword } from "@/lib/crypto"
import { db } from "@/lib/db"

// ── Mock data ──────────────────────────────────────────────────────────────

const mockUser = {
  id: "user-1",
  email: "joao@example.com",
  name: "João Silva",
  role: "CLIENT",
  passwordHash: "mocked-salt:mocked-hash",
  active: true,
  avatarUrl: null,
  verified: false,
  cpfCnpj: null,
  whatsapp: null,
  phone: null,
  cep: null,
  street: null,
  number: null,
  complement: null,
  district: null,
  city: null,
  state: null,
  lat: null,
  lng: null,
  bio: null,
  radiusKm: null,
  lytexRecipientId: null,
  coverUrl: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
} as any

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    (vi as any).clearAllMocks()
    (vi.mocked(db.user.findUnique) as any).mockReset()
    vi.mocked(verifyPassword).mockReturnValue(true)
    _mockSession = null
  })

  it("returns user on successful login", async () => {
    (vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUser)

    const req = createMockRequest({
      method: "POST",
      body: { email: "joao@example.com", password: "123456" },
    })
    const res = await login(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toHaveProperty("user")
    expect((parsed.body as any).user.email).toBe("joao@example.com")
    expect((parsed.body as any).user).not.toHaveProperty("passwordHash")
    expect(createSession).toHaveBeenCalledWith("user-1", "CLIENT")
  })

  it("returns 401 for wrong password", async () => {
    (vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUser)
    vi.mocked(verifyPassword).mockReturnValue(false)

    const req = createMockRequest({
      method: "POST",
      body: { email: "joao@example.com", password: "wrong1" },
    })
    const res = await login(req)
    expect(res.status).toBe(401)
  })

  it("returns 401 for non-existent user", async () => {
    (vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)

    const req = createMockRequest({
      method: "POST",
      body: { email: "noone@example.com", password: "123456" },
    })
    const res = await login(req)
    expect(res.status).toBe(401)
  })

  it("returns 401 for inactive user", async () => {
    (vi.mocked(db.user.findUnique) as any).mockResolvedValue({ ...mockUser, active: false } as any)

    const req = createMockRequest({
      method: "POST",
      body: { email: "inactive@example.com", password: "123456" },
    })
    const res = await login(req)
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid email format", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { email: "not-an-email", password: "123456" },
    })
    const res = await login(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 for missing password", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { email: "joao@example.com" },
    })
    const res = await login(req)
    expect(res.status).toBe(400)
  })
})

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    (vi as any).clearAllMocks()
    _mockSession = null
  })

  const clientPayload = {
    name: "Maria Souza",
    email: "maria@example.com",
    password: "123456",
    confirmPassword: "123456",
    role: "CLIENT",
  }

  it("creates a client user and returns 201", async () => {
    (vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)
    (vi.mocked(db.user.create) as any).mockResolvedValue({
      id: "user-2",
      name: "Maria Souza",
      email: "maria@example.com",
      role: "CLIENT",
      avatarUrl: null,
    } as any)
    (vi.mocked(db.user.update) as any).mockResolvedValue({} as any)

    const req = createMockRequest({ method: "POST", body: clientPayload })
    const res = await register(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(201)
    expect((parsed.body as any).user.email).toBe("maria@example.com")
    expect((parsed.body as any).user.role).toBe("CLIENT")
    expect(hashPassword).toHaveBeenCalledWith("123456")
    expect(createSession).toHaveBeenCalled()
  })

  it("creates a provider user with extra fields", async () => {
    (vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)
    (vi.mocked(db.user.create) as any).mockResolvedValue({
      id: "user-3",
      name: "Carlos Prestador",
      email: "carlos@example.com",
      role: "PROVIDER",
      avatarUrl: null,
    } as any)
    (vi.mocked(db.user.update) as any).mockResolvedValue({} as any)
    (vi.mocked(db.user.findMany) as any).mockResolvedValue([])

    const req = createMockRequest({
      method: "POST",
      body: {
        name: "Carlos Prestador",
        email: "carlos@example.com",
        password: "123456",
        confirmPassword: "123456",
        role: "PROVIDER",
        cpfCnpj: "123.456.789-00",
        whatsapp: "11999999999",
        city: "São Paulo",
        bio: "Profissional experiente",
        radiusKm: 20,
      },
    })
    const res = await register(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(201)
    expect((parsed.body as any).user.role).toBe("PROVIDER")
  })

  it("returns 409 for duplicate email", async () => {
    (vi.mocked(db.user.findUnique) as any).mockResolvedValue({ id: "existing" } as any)

    const req = createMockRequest({ method: "POST", body: clientPayload })
    const res = await register(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(409)
    expect((parsed.body as any).error).toBe("E-mail já cadastrado")
  })

  it("returns 400 for invalid registration data", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { name: "A", email: "bad", password: "12", confirmPassword: "34", role: "INVALID" },
    })
    const res = await register(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 for mismatched passwords", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { ...clientPayload, confirmPassword: "654321" },
    })
    const res = await register(req)
    expect(res.status).toBe(400)
  })
})

describe("POST /api/auth/logout", () => {
  it("destroys session and returns ok", async () => {
    const res = await logout()
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toEqual({ ok: true })
    expect(destroySession).toHaveBeenCalled()
  })
})

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    (vi as any).clearAllMocks()
    _mockSession = null
  })

  it("returns user for authenticated session", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" } as any
    (vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      name: "João Silva",
      email: "joao@example.com",
      role: "CLIENT",
      avatarUrl: null,
    } as any)

    const res = await me()
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).user).toBeTruthy()
    expect((parsed.body as any).user.id).toBe("user-1")
  })

  it("returns null user when not authenticated", async () => {
    const res = await me()
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).user).toBeNull()
  })

  it("returns null user when session user not found in db", async () => {
    _mockSession = { userId: "nonexistent", role: "CLIENT" } as any
    (vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)

    const res = await me()
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).user).toBeNull()
  })
})
