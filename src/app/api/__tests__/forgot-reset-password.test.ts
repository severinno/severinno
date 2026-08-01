import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks (must be before vi.mock to avoid hoisting issues) ────────

const { mockDb, sentEmails, sentNotifications } = vi.hoisted(() => {
  const emails: Array<{ to: string; subject: string; html: string }> = []
  const notifs: Array<{ userId: string; type: string; title: string; body?: string }> = []

  const db = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    resetToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  }

  return {
    mockDb: db,
    sentEmails: emails,
    sentNotifications: notifs,
  }
})

vi.mock("@/lib/with-rate-limit", () => ({
  withRateLimit: (handler: (...args: unknown[]) => unknown) => handler,
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/mail", () => ({
  sendMail: vi
    .fn()
    .mockImplementation(async (payload: { to: string; subject: string; html: string }) => {
      sentEmails.push(payload)
    }),
  passwordResetHtml: vi.fn().mockImplementation((opts: { userName: string; resetLink: string }) => {
    return `<html><body>${opts.userName} - ${opts.resetLink}</body></html>`
  }),
}))

vi.mock("@/lib/notification-queue", () => ({
  saveAndQueueNotification: vi.fn().mockImplementation(async (payload: any) => {
    sentNotifications.push(payload)
  }),
}))

vi.mock("@/lib/crypto", () => ({
  hashPassword: vi.fn().mockReturnValue("mocked-salt:mocked-hash"),
  verifyPassword: vi.fn().mockReturnValue(true),
}))

vi.mock("@/lib/auth", () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
  destroySession: vi.fn().mockResolvedValue(undefined),
  requireUser: vi.fn().mockImplementation(async () => {
    throw new Error("UNAUTHORIZED")
  }),
  getOptionalSession: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/db", () => ({
  db: mockDb,
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST as forgotPassword } from "../auth/forgot-password/route"
import { POST as resetPassword } from "../auth/reset-password/route"

// ── Mock data ──────────────────────────────────────────────────────────────

const mockUser = {
  id: "user-1",
  name: "João Silva",
  email: "joao@example.com",
  role: "CLIENT" as const,
  active: true,
  avatarUrl: null,
}

const mockResetToken = {
  id: "token-1",
  userId: "user-1",
  token: "valid-token-abc-123",
  expiresAt: new Date(Date.now() + 3600_000), // 1 hour from now
  used: false,
  createdAt: new Date(),
  user: { id: "user-1", active: true, email: "joao@example.com" },
}

// ===========================================================================
// Forgot Password
// ===========================================================================

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sentEmails.length = 0
    sentNotifications.length = 0
    mockDb.resetToken.create.mockReset()
    mockDb.resetToken.updateMany.mockReset()
    mockDb.user.findUnique.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("envia email quando usuário existe", async () => {
    mockDb.user.findUnique.mockResolvedValue(mockUser)
    mockDb.resetToken.create.mockResolvedValue({ id: "new-token" })
    mockDb.resetToken.updateMany.mockResolvedValue({ count: 1 })

    const req = createMockRequest({
      method: "POST",
      body: { email: "joao@example.com" },
    })
    const res = await forgotPassword(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.ok).toBe(true)

    // Email was sent
    expect(sentEmails.length).toBe(1)
    expect(sentEmails[0].to).toBe("joao@example.com")
    expect(sentEmails[0].subject).toContain("Redefinição de senha")
    expect(sentEmails[0].html).toContain("João Silva")
    expect(sentEmails[0].html).toContain("/auth/reset-password/")

    // Push notification was sent
    expect(sentNotifications.length).toBe(1)
    expect(sentNotifications[0].userId).toBe("user-1")
    expect(sentNotifications[0].type).toBe("PASSWORD_RESET_REQUESTED")
    expect(sentNotifications[0].title).toContain("Redefinição de senha")
  })

  it("sempre retorna 200 para prevenir enumeração de emails", async () => {
    // Usuário não encontrado (email não cadastrado)
    mockDb.user.findUnique.mockResolvedValue(null)

    const req = createMockRequest({
      method: "POST",
      body: { email: "naoexiste@teste.com" },
    })
    const res = await forgotPassword(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.ok).toBe(true)
    expect(parsed.body!.message).toContain("e-mail existir")

    // Nenhum email enviado (usuário não existe)
    expect(sentEmails.length).toBe(0)
    expect(sentNotifications.length).toBe(0)
  })

  it("invalida tokens anteriores do mesmo usuário", async () => {
    mockDb.user.findUnique.mockResolvedValue(mockUser)
    mockDb.resetToken.create.mockResolvedValue({ id: "new-token" })

    const req = createMockRequest({
      method: "POST",
      body: { email: "joao@example.com" },
    })
    await forgotPassword(req)

    expect(mockDb.resetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", used: false },
      data: { used: true },
    })
  })

  it("gera token aleatório de 32 bytes (64 hex chars)", async () => {
    mockDb.user.findUnique.mockResolvedValue(mockUser)
    mockDb.resetToken.updateMany.mockResolvedValue({ count: 0 })

    let savedToken = ""
    mockDb.resetToken.create.mockImplementation(async (args: any) => {
      savedToken = args.data.token
      return { id: "new-token" }
    })

    await forgotPassword(
      createMockRequest({
        method: "POST",
        body: { email: "joao@example.com" },
      }),
    )

    expect(savedToken.length).toBe(64)
    expect(savedToken).toMatch(/^[a-f0-9]{64}$/)
  })

  it("token expira em 1 hora", async () => {
    mockDb.user.findUnique.mockResolvedValue(mockUser)
    mockDb.resetToken.updateMany.mockResolvedValue({ count: 0 })

    let savedExpiresAt: Date | null = null
    mockDb.resetToken.create.mockImplementation(async (args: any) => {
      savedExpiresAt = args.data.expiresAt
      return { id: "new-token" }
    })

    await forgotPassword(
      createMockRequest({
        method: "POST",
        body: { email: "joao@example.com" },
      }),
    )

    expect(savedExpiresAt).not.toBeNull()
    const diffMs = savedExpiresAt!.getTime() - Date.now()
    const diffHours = diffMs / (1000 * 60 * 60)
    expect(diffHours).toBeCloseTo(1, 0)
  })

  it("normaliza email para minúsculas", async () => {
    mockDb.user.findUnique.mockResolvedValue(mockUser)
    mockDb.resetToken.create.mockResolvedValue({ id: "new-token" })
    mockDb.resetToken.updateMany.mockResolvedValue({ count: 1 })

    await forgotPassword(
      createMockRequest({
        method: "POST",
        body: { email: "JOAO@EXEMPLO.COM" },
      }),
    )

    expect(mockDb.user.findUnique).toHaveBeenCalledWith({
      where: { email: "joao@exemplo.com" },
    })
  })

  it("retorna 200 com email vazio (não quebra)", async () => {
    const res = await forgotPassword(
      createMockRequest({
        method: "POST",
        body: { email: "" },
      }),
    )
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(200)
    expect(parsed.body!.ok).toBe(true)
    expect(parsed.body!.message).toContain("e-mail existir")
  })

  it("retorna 200 sem body (graceful handling)", async () => {
    const res = await forgotPassword(
      createMockRequest({
        method: "POST",
        body: {},
      }),
    )
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(200)
    expect(parsed.body!.ok).toBe(true)
    expect(parsed.body!.message).toContain("e-mail existir")
  })

  it("link de reset contém URL correta", async () => {
    mockDb.user.findUnique.mockResolvedValue(mockUser)
    mockDb.resetToken.updateMany.mockResolvedValue({ count: 0 })

    let savedToken = ""
    mockDb.resetToken.create.mockImplementation(async (args: any) => {
      savedToken = args.data.token
      return { id: "new-token" }
    })

    await forgotPassword(
      createMockRequest({
        method: "POST",
        body: { email: "joao@example.com" },
      }),
    )

    expect(sentEmails[0].html).toContain(`/auth/reset-password/${savedToken}`)
    expect(sentEmails[0].html).not.toContain("?token=")
  })

  it("não envia email de reset para conta demo em produção (resposta genérica)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    mockDb.user.findUnique.mockResolvedValue({
      ...mockUser,
      email: "admin@severinno.com",
    })

    const res = await forgotPassword(
      createMockRequest({
        method: "POST",
        body: { email: "admin@severinno.com" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.ok).toBe(true)
    expect(parsed.body!.message).toContain("e-mail existir")
    expect(sentEmails.length).toBe(0)
    expect(sentNotifications.length).toBe(0)
    expect(mockDb.resetToken.create).not.toHaveBeenCalled()
  })

  it("envia email de reset para conta demo em dev/test", async () => {
    vi.stubEnv("NODE_ENV", "test")
    mockDb.user.findUnique.mockResolvedValue({
      ...mockUser,
      email: "admin@severinno.com",
    })
    mockDb.resetToken.create.mockResolvedValue({ id: "new-token" })
    mockDb.resetToken.updateMany.mockResolvedValue({ count: 0 })

    await forgotPassword(
      createMockRequest({
        method: "POST",
        body: { email: "admin@severinno.com" },
      }),
    )

    expect(sentEmails.length).toBe(1)
    expect(sentEmails[0].to).toBe("admin@severinno.com")
  })
})

// ===========================================================================
// Reset Password
// ===========================================================================

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sentEmails.length = 0
    sentNotifications.length = 0
    mockDb.resetToken.findUnique.mockReset()
    mockDb.user.update.mockReset()
    mockDb.resetToken.update.mockReset()
    mockDb.$transaction.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("redefine senha com token válido", async () => {
    mockDb.resetToken.findUnique.mockResolvedValue(mockResetToken)
    mockDb.$transaction.mockResolvedValue([{ id: "user-1" }, { id: "token-1", used: true }])

    const res = await resetPassword(
      createMockRequest({
        method: "POST",
        body: { token: "valid-token-abc-123", password: "novaSenha123" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.ok).toBe(true)
    expect(parsed.body!.message).toContain("redefinida")
    expect(mockDb.$transaction).toHaveBeenCalled()
  })

  it("usa transação atômica para evitar race conditions", async () => {
    mockDb.resetToken.findUnique.mockResolvedValue(mockResetToken)
    mockDb.$transaction.mockResolvedValue([{ id: "user-1" }, { id: "token-1", used: true }])

    await resetPassword(
      createMockRequest({
        method: "POST",
        body: { token: "valid-token-abc-123", password: "novaSenha123" },
      }),
    )

    const txArgs = mockDb.$transaction.mock.calls[0][0]
    expect(Array.isArray(txArgs)).toBe(true)
    expect(txArgs.length).toBe(2)
  })

  it("rejeita token expirado", async () => {
    const expiredToken = {
      ...mockResetToken,
      expiresAt: new Date(Date.now() - 1000),
    }
    mockDb.resetToken.findUnique.mockResolvedValue(expiredToken)

    const res = await resetPassword(
      createMockRequest({
        method: "POST",
        body: { token: "expired-token", password: "novaSenha123" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(parsed.body!.error).toContain("expirou")
  })

  it("rejeita token já utilizado", async () => {
    mockDb.resetToken.findUnique.mockResolvedValue({ ...mockResetToken, used: true })

    const res = await resetPassword(
      createMockRequest({
        method: "POST",
        body: { token: "used-token", password: "novaSenha123" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(parsed.body!.error).toContain("já foi utilizado")
  })

  it("rejeita token inválido (não encontrado)", async () => {
    mockDb.resetToken.findUnique.mockResolvedValue(null)

    const res = await resetPassword(
      createMockRequest({
        method: "POST",
        body: { token: "invalid-token", password: "novaSenha123" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(parsed.body!.error).toContain("inválido")
  })

  it("rejeita senha muito curta (< 6 caracteres)", async () => {
    const res = await resetPassword(
      createMockRequest({
        method: "POST",
        body: { token: "valid-token", password: "123" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(parsed.body!.error).toContain("6 caracteres")
  })

  it("rejeita requisição sem token", async () => {
    const res = await resetPassword(
      createMockRequest({
        method: "POST",
        body: { password: "novaSenha123" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(parsed.body!.error).toContain("obrigatórios")
  })

  it("rejeita requisição sem senha", async () => {
    const res = await resetPassword(
      createMockRequest({
        method: "POST",
        body: { token: "valid-token" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(parsed.body!.error).toContain("obrigatórios")
  })

  it("rejeita conta desativada", async () => {
    mockDb.resetToken.findUnique.mockResolvedValue({
      ...mockResetToken,
      user: { id: "user-1", active: false, email: "joao@example.com" },
    })

    const res = await resetPassword(
      createMockRequest({
        method: "POST",
        body: { token: "valid-token", password: "novaSenha123" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(parsed.body!.error).toContain("desativada")
  })

  it("rejeita reset de conta demo em produção (token inválido genérico)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    mockDb.resetToken.findUnique.mockResolvedValue({
      ...mockResetToken,
      user: { id: "user-1", active: true, email: "admin@severinno.com" },
    })

    const res = await resetPassword(
      createMockRequest({
        method: "POST",
        body: { token: "valid-token", password: "novaSenha123" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(parsed.body!.error).toContain("Token inválido")
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it("permite reset de conta demo fora de produção", async () => {
    vi.stubEnv("NODE_ENV", "test")
    mockDb.resetToken.findUnique.mockResolvedValue({
      ...mockResetToken,
      user: { id: "user-1", active: true, email: "admin@severinno.com" },
    })
    mockDb.$transaction.mockResolvedValue([{ id: "user-1" }, { id: "token-1", used: true }])

    const res = await resetPassword(
      createMockRequest({
        method: "POST",
        body: { token: "valid-token", password: "novaSenha123" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(mockDb.$transaction).toHaveBeenCalled()
  })

  it("rejeita token vazio (string vazia)", async () => {
    const res = await resetPassword(
      createMockRequest({
        method: "POST",
        body: { token: "", password: "novaSenha123" },
      }),
    )
    expect(res.status).toBe(400)
  })
})
