import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheInvalidate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: {
    login: { prefix: "login", max: 5, windowMs: 60000 },
    register: { prefix: "register", max: 5, windowMs: 60000 },
    forgotPassword: { prefix: "forgot-pw", max: 3, windowMs: 600000 },
    authMe: { prefix: "auth-me", max: 30, windowMs: 60000 },
  },
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Auth functions — use mutable module-level variables so per-test setup works
let _mockSession: any = null

import { makeAuthError } from "@/lib/__tests__/helpers/auth-mock"

vi.mock("@/lib/auth", () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
  destroySession: vi.fn().mockResolvedValue(undefined),
  requireUser: vi.fn().mockImplementation(async () => {
    const s = _mockSession
    if (!s) throw makeAuthError("UNAUTHORIZED")
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

// Demo-accounts gate — controlável por teste (prod vs dev)
let _demoEnabled = true

vi.mock("@/lib/demo-accounts", () => ({
  isDemoAccountsEnabled: vi.fn(() => _demoEnabled),
  isDemoAccountEmail: (email: string | null | undefined) =>
    ["admin@severinno.com", "cliente@severinno.com", "joao@severinno.com"].includes(
      (email ?? "").toLowerCase(),
    ),
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
  sessionVersion: 0,
  twoFactorEnabled: false,
} as any

// Payload mínimo de cadastro (reusado nos describes de register)
const clientPayload = {
  name: "Maria Souza",
  email: "maria@example.com",
  password: "Senha1234",
  confirmPassword: "Senha1234",
  role: "CLIENT",
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    ;(vi as any).clearAllMocks()
    ;(vi.mocked(db.user.findUnique) as any).mockReset()
    vi.mocked(verifyPassword).mockReturnValue(true)
    _mockSession = null
    _demoEnabled = true
  })

  it("returns user on successful login", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUser)

    const req = createMockRequest({
      method: "POST",
      body: { email: "joao@example.com", password: "12345678" },
    })
    const res = await login(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toHaveProperty("user")
    expect((parsed.body as any).user.email).toBe("joao@example.com")
    expect((parsed.body as any).user).not.toHaveProperty("passwordHash")
    expect(createSession).toHaveBeenCalledWith("user-1", "CLIENT", 0)
  })

  it("returns 401 for wrong password", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUser)
    vi.mocked(verifyPassword).mockReturnValue(false)

    const req = createMockRequest({
      method: "POST",
      body: { email: "joao@example.com", password: "wrongpwd" },
    })
    const res = await login(req)
    expect(res.status).toBe(401)
  })

  it("returns 401 for non-existent user", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)

    const req = createMockRequest({
      method: "POST",
      body: { email: "noone@example.com", password: "12345678" },
    })
    const res = await login(req)
    expect(res.status).toBe(401)
  })

  it("returns 401 for inactive user", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({ ...mockUser, active: false } as any)

    const req = createMockRequest({
      method: "POST",
      body: { email: "inactive@example.com", password: "12345678" },
    })
    const res = await login(req)
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid email format", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { email: "not-an-email", password: "12345678" },
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

describe("POST /api/auth/login — contas demo (prod vs dev)", () => {
  beforeEach(() => {
    ;(vi as any).clearAllMocks()
    ;(vi.mocked(db.user.findUnique) as any).mockReset()
    vi.mocked(verifyPassword).mockReturnValue(true)
    _mockSession = null
    _demoEnabled = true
  })

  const demoAdmin = {
    ...mockUser,
    email: "admin@severinno.com",
    role: "ADMIN",
  } as any

  it("permite login de conta demo em dev/test", async () => {
    _demoEnabled = true
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(demoAdmin)

    const res = await login(
      createMockRequest({
        method: "POST",
        body: { email: "admin@severinno.com", password: "admin123" },
      }),
    )
    expect(res.status).toBe(200)
    expect(createSession).toHaveBeenCalledWith("user-1", "ADMIN", 0)
  })

  it("bloqueia login de conta demo em produção (401)", async () => {
    _demoEnabled = false
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(demoAdmin)

    const res = await login(
      createMockRequest({
        method: "POST",
        body: { email: "admin@severinno.com", password: "admin123" },
      }),
    )
    expect(res.status).toBe(401)
    expect(createSession).not.toHaveBeenCalled()
  })

  it("permite login de usuário comum em produção", async () => {
    _demoEnabled = false
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUser)

    const res = await login(
      createMockRequest({
        method: "POST",
        body: { email: "joao@example.com", password: "12345678" },
      }),
    )
    expect(res.status).toBe(200)
    expect(createSession).toHaveBeenCalled()
  })
})

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    ;(vi as any).clearAllMocks()
    _mockSession = null
    _demoEnabled = true
  })

  it("creates a client user and returns 201", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)
    ;(vi.mocked(db.user.create) as any).mockResolvedValue({
      id: "user-2",
      name: "Maria Souza",
      email: "maria@example.com",
      role: "CLIENT",
      avatarUrl: null,
    } as any)
    ;(vi.mocked(db.user.update) as any).mockResolvedValue({} as any)

    const req = createMockRequest({ method: "POST", body: clientPayload })
    const res = await register(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(201)
    expect((parsed.body as any).user.email).toBe("maria@example.com")
    expect((parsed.body as any).user.role).toBe("CLIENT")
    expect(hashPassword).toHaveBeenCalledWith("Senha1234")
    expect(createSession).toHaveBeenCalled()
  })

  it("creates a provider user with extra fields", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)
    ;(vi.mocked(db.user.create) as any).mockResolvedValue({
      id: "user-3",
      name: "Carlos Prestador",
      email: "carlos@example.com",
      role: "PROVIDER",
      avatarUrl: null,
    } as any)
    ;(vi.mocked(db.user.update) as any).mockResolvedValue({} as any)
    ;(vi.mocked(db.user.findMany) as any).mockResolvedValue([])

    const req = createMockRequest({
      method: "POST",
      body: {
        name: "Carlos Prestador",
        email: "carlos@example.com",
        password: "Senha1234",
        confirmPassword: "Senha1234",
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
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({ id: "existing" } as any)

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

describe("POST /api/auth/register — emails demo (prod vs dev)", () => {
  beforeEach(() => {
    ;(vi as any).clearAllMocks()
    _mockSession = null
    _demoEnabled = true
  })

  it("bloqueia cadastro com email demo em produção (409)", async () => {
    _demoEnabled = false
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)

    const res = await register(
      createMockRequest({
        method: "POST",
        body: { ...clientPayload, email: "admin@severinno.com" },
      }),
    )
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(409)
    expect(parsed.body).toEqual({ error: "E-mail já cadastrado" })
    expect(db.user.create).not.toHaveBeenCalled()
  })

  it("permite cadastro com email demo em dev/test", async () => {
    _demoEnabled = true
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)
    ;(vi.mocked(db.user.create) as any).mockResolvedValue({
      id: "user-2",
      name: "Maria Souza",
      email: "cliente@severinno.com",
      role: "CLIENT",
      avatarUrl: null,
    } as any)

    const res = await register(
      createMockRequest({
        method: "POST",
        body: { ...clientPayload, email: "cliente@severinno.com" },
      }),
    )
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(201)
    expect(db.user.create).toHaveBeenCalled()
  })
})

describe("POST /api/auth/logout", () => {
  it("destroys session and returns ok", async () => {
    const res = await logout(createMockRequest())
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toEqual({ ok: true })
    expect(destroySession).toHaveBeenCalled()
  })
})

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    ;(vi as any).clearAllMocks()
    _mockSession = null
  })

  it("returns user for authenticated session", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" } as any
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      name: "João Silva",
      email: "joao@example.com",
      role: "CLIENT",
      avatarUrl: null,
    } as any)

    const res = await me(createMockRequest())
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).user).toBeTruthy()
    expect((parsed.body as any).user.id).toBe("user-1")
  })

  it("returns null user when not authenticated", async () => {
    const res = await me(createMockRequest())
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).user).toBeNull()
  })

  it("returns null user when session user not found in db", async () => {
    _mockSession = { userId: "nonexistent", role: "CLIENT" } as any
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)

    const res = await me(createMockRequest())
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).user).toBeNull()
  })
})
