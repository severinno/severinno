import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockDb, sentNotifications, sentEmails } = vi.hoisted(() => {
  const notifs: Array<{ userId: string; type: string; title: string; body?: string }> = []
  const emails: Array<{ to: string; subject: string; html: string }> = []

  const db = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  }

  return {
    mockDb: db,
    sentNotifications: notifs,
    sentEmails: emails,
  }
})

vi.mock("@/lib/with-rate-limit", () => ({
  withRateLimit: (handler: (...args: unknown[]) => unknown) => handler,
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/notification-queue", () => ({
  saveAndQueueNotification: vi.fn().mockImplementation(async (payload: any) => {
    sentNotifications.push(payload)
  }),
}))

vi.mock("@/lib/mail", () => ({
  sendMail: vi
    .fn()
    .mockImplementation(async (payload: { to: string; subject: string; html: string }) => {
      sentEmails.push(payload)
    }),
  passwordChangedHtml: vi.fn().mockReturnValue("<html>senha alterada</html>"),
}))

vi.mock("@/lib/crypto", () => ({
  hashPassword: vi.fn().mockReturnValue("mocked-salt:mocked-hash"),
  verifyPassword: vi.fn().mockReturnValue(true),
}))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockImplementation(async () => ({
    userId: "user-1",
    role: "CLIENT",
  })),
}))

vi.mock("@/lib/db", () => ({
  db: mockDb,
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST as changePassword } from "../auth/change-password/route"
import { verifyPassword, hashPassword } from "@/lib/crypto"

// ── Mock data ──────────────────────────────────────────────────────────────

const mockUser = {
  id: "user-1",
  name: "João Silva",
  email: "joao@example.com",
  passwordHash: "existing-salt:existing-hash",
}

const NEW_PASSWORD = "novaSenha123"
const CURRENT_PASSWORD = "senhaAtual123"

// ===========================================================================
// Change Password
// ============================================================================

describe("POST /api/auth/change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sentNotifications.length = 0
    sentEmails.length = 0
    mockDb.user.findUnique.mockReset()
    mockDb.user.update.mockReset()
    vi.mocked(verifyPassword).mockReturnValue(true)
  })

  it("altera senha com dados válidos", async () => {
    mockDb.user.findUnique.mockResolvedValue(mockUser)
    mockDb.user.update.mockResolvedValue({ id: "user-1" })

    const res = await changePassword(
      createMockRequest({
        method: "POST",
        body: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
    expect((parsed.body as any).message).toContain("alterada")

    // Verifica a senha atual
    expect(verifyPassword).toHaveBeenCalledWith(CURRENT_PASSWORD, mockUser.passwordHash)

    // Hash da nova senha
    expect(hashPassword).toHaveBeenCalledWith(NEW_PASSWORD)

    // Atualiza no banco
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "mocked-salt:mocked-hash" },
    })

    // Push notification de segurança
    expect(sentNotifications.length).toBe(1)
    expect(sentNotifications[0].userId).toBe("user-1")
    expect(sentNotifications[0].type).toBe("PASSWORD_CHANGED")
    expect(sentNotifications[0].title).toContain("Senha alterada")

    // Email transactional de segurança
    expect(sentEmails.length).toBe(1)
    expect(sentEmails[0].to).toBe("joao@example.com")
    expect(sentEmails[0].subject).toContain("senha foi alterada")
    expect(sentEmails[0].html).toContain("senha alterada")
  })

  it("rejeita senha atual incorreta", async () => {
    mockDb.user.findUnique.mockResolvedValue(mockUser)
    vi.mocked(verifyPassword).mockReturnValue(false)

    const res = await changePassword(
      createMockRequest({
        method: "POST",
        body: { currentPassword: "senhaErrada", newPassword: NEW_PASSWORD },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("incorreta")

    // Não deve atualizar o banco nem enviar notificação
    expect(mockDb.user.update).not.toHaveBeenCalled()
    expect(sentNotifications.length).toBe(0)
  })

  it("rejeita senha muito curta (< 8 caracteres)", async () => {
    const res = await changePassword(
      createMockRequest({
        method: "POST",
        body: { currentPassword: CURRENT_PASSWORD, newPassword: "123" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("8 caracteres")
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it("rejeita requisição sem senha atual", async () => {
    const res = await changePassword(
      createMockRequest({
        method: "POST",
        body: { newPassword: NEW_PASSWORD },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("obrigatórias")
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it("rejeita requisição sem nova senha", async () => {
    const res = await changePassword(
      createMockRequest({
        method: "POST",
        body: { currentPassword: CURRENT_PASSWORD },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("obrigatórias")
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it("rejeita senhas com tipos inválidos", async () => {
    const res = await changePassword(
      createMockRequest({
        method: "POST",
        body: { currentPassword: 123, newPassword: true },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("inválidas")
  })

  it("rejeita usuário não encontrado no banco", async () => {
    mockDb.user.findUnique.mockResolvedValue(null)

    const res = await changePassword(
      createMockRequest({
        method: "POST",
        body: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("não encontrado")
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it("rejeita usuário não autenticado", async () => {
    // Sobrescreve o mock para lançar erro (comportamento do requireUser quando não logado)
    const auth = await import("@/lib/auth")
    vi.mocked(auth.requireUser).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await changePassword(
      createMockRequest({
        method: "POST",
        body: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
      }),
    )
    expect(res.status).toBe(401)
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it("envia push notification e email de segurança ao alterar senha", async () => {
    mockDb.user.findUnique.mockResolvedValue(mockUser)
    mockDb.user.update.mockResolvedValue({ id: "user-1" })

    await changePassword(
      createMockRequest({
        method: "POST",
        body: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
      }),
    )

    // Push notification
    expect(sentNotifications.length).toBe(1)
    expect((sentNotifications[0] as any).pushUrl).toBe("/?view=profile")

    // Email transactional
    expect(sentEmails.length).toBe(1)
    expect(sentEmails[0].to).toBe("joao@example.com")
    expect(sentEmails[0].subject).toContain("senha foi alterada")
  })
})
