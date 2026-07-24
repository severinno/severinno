import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockDb } = vi.hoisted(() => {
  const db = {
    pushSubscription: {
      findMany: vi.fn(),
      delete: vi.fn(),
    },
  }

  return { mockDb: db }
})

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/db", () => ({
  db: mockDb,
}))

// Mock web-push completely
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { sendPushNotification, sendPushToMany } from "../push"
import webpush from "web-push"

// ── Mock data ──────────────────────────────────────────────────────────────

const mockSubscription = {
  id: "sub-1",
  userId: "user-1",
  endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-1",
  p256dh: "test-p256dh-key-1",
  auth: "test-auth-key-1",
  createdAt: new Date(),
}

const mockSubscription2 = {
  id: "sub-2",
  userId: "user-1",
  endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-2",
  p256dh: "test-p256dh-key-2",
  auth: "test-auth-key-2",
  createdAt: new Date(),
}

// ===========================================================================
// sendPushNotification
// ============================================================================

describe("sendPushNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.pushSubscription.findMany.mockReset()
    mockDb.pushSubscription.delete.mockReset()
  })

  it("envia notificação push para todas as subscrições do usuário", async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([mockSubscription])
    vi.mocked(webpush.sendNotification).mockResolvedValue(undefined as any)

    await sendPushNotification("user-1", "Título", "Corpo da mensagem")

    expect(webpush.sendNotification).toHaveBeenCalledTimes(1)
    const [sub, payload] = vi.mocked(webpush.sendNotification).mock.calls[0]
    expect(sub.endpoint).toBe(mockSubscription.endpoint)
    expect(payload).toContain("Título")
    expect(payload).toContain("Corpo da mensagem")
  })

  it("envia para múltiplas subscrições do mesmo usuário", async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([mockSubscription, mockSubscription2])
    vi.mocked(webpush.sendNotification).mockResolvedValue(undefined as any)

    await sendPushNotification("user-1", "Título", "Corpo")

    expect(webpush.sendNotification).toHaveBeenCalledTimes(2)
  })

  it("não faz nada se usuário não tem subscrições", async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([])

    await sendPushNotification("user-2", "Título", "Corpo")

    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it("inclui URL deep link quando fornecida", async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([mockSubscription])
    vi.mocked(webpush.sendNotification).mockResolvedValue(undefined as any)

    await sendPushNotification("user-1", "Título", "Corpo", "/?view=test")

    const [, payload] = vi.mocked(webpush.sendNotification).mock.calls[0]
    const parsed = JSON.parse(payload)
    expect(parsed.url).toBe("/?view=test")
    expect(parsed.title).toBe("Título")
    expect(parsed.body).toBe("Corpo")
  })

  it("inclui timestamp no payload", async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([mockSubscription])
    vi.mocked(webpush.sendNotification).mockResolvedValue(undefined as any)

    await sendPushNotification("user-1", "Título", "Corpo")

    const [, payload] = vi.mocked(webpush.sendNotification).mock.calls[0]
    const parsed = JSON.parse(payload)
    expect(parsed.timestamp).toBeDefined()
    expect(() => new Date(parsed.timestamp)).not.toThrow()
  })

  it("remove subscrição expirada (HTTP 410 Gone) e continua", async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([mockSubscription, mockSubscription2])

    // First sub fails with 410, second succeeds
    const pushError = new Error("Subscription expired")
    ;(pushError as any).statusCode = 410

    vi.mocked(webpush.sendNotification)
      .mockRejectedValueOnce(pushError)
      .mockResolvedValueOnce(undefined as any)

    mockDb.pushSubscription.delete.mockResolvedValue({ id: "sub-1" } as any)

    await sendPushNotification("user-1", "Título", "Corpo")

    // Should remove the expired subscription
    expect(mockDb.pushSubscription.delete).toHaveBeenCalledWith({
      where: { id: "sub-1" },
    })

    // Second sub should still be sent
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2)
  })

  it("remove subscrição não encontrada (HTTP 404) e continua", async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([mockSubscription])

    const pushError = new Error("Not found")
    ;(pushError as any).statusCode = 404

    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(pushError)
    mockDb.pushSubscription.delete.mockResolvedValue({ id: "sub-1" } as any)

    await sendPushNotification("user-1", "Título", "Corpo")

    expect(mockDb.pushSubscription.delete).toHaveBeenCalledWith({
      where: { id: "sub-1" },
    })
  })

  it("não remove subscrição para erros que não são 410/404", async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([mockSubscription])

    const pushError = new Error("Rate limited")
    ;(pushError as any).statusCode = 429

    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(pushError)

    // Should not throw despite the error (fire-and-forget style)
    await expect(
      sendPushNotification("user-1", "Título", "Corpo"),
    ).resolves.not.toThrow()

    // Should NOT delete the subscription
    expect(mockDb.pushSubscription.delete).not.toHaveBeenCalled()
  })

  it("lida com erro na deleção de subscrição (não quebra)", async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([mockSubscription])

    const pushError = new Error("Gone")
    ;(pushError as any).statusCode = 410

    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(pushError)
    // Delete fails
    mockDb.pushSubscription.delete.mockRejectedValueOnce(new Error("DB error"))

    await expect(
      sendPushNotification("user-1", "Título", "Corpo"),
    ).resolves.not.toThrow()
  })

  it("envia notificação mesmo quando body é string vazia", async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([mockSubscription])
    vi.mocked(webpush.sendNotification).mockResolvedValue(undefined as any)

    await sendPushNotification("user-1", "Título", "")

    const [, payload] = vi.mocked(webpush.sendNotification).mock.calls[0]
    const parsed = JSON.parse(payload)
    expect(parsed.body).toBe("")
  })
})

// ===========================================================================
// sendPushToMany
// ============================================================================

describe("sendPushToMany", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.pushSubscription.findMany.mockReset()
  })

  it("envia notificação para múltiplos usuários", async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([mockSubscription])
    vi.mocked(webpush.sendNotification).mockResolvedValue(undefined as any)

    await sendPushToMany(["user-1", "user-2"], "Título", "Corpo")

    // Deve buscar subscrições para ambos os usuários
    expect(mockDb.pushSubscription.findMany).toHaveBeenCalledTimes(2)
  })

  it("não quebra se um dos usuários falhar", async () => {
    mockDb.pushSubscription.findMany
      .mockResolvedValueOnce([mockSubscription])
      .mockRejectedValueOnce(new Error("DB error"))

    vi.mocked(webpush.sendNotification).mockResolvedValue(undefined as any)

    // Não deve lançar exceção
    await expect(
      sendPushToMany(["user-1", "user-2"], "Título", "Corpo"),
    ).resolves.not.toThrow()

    // Pelo menos uma tentativa de envio deve ter ocorrido
    expect(webpush.sendNotification).toHaveBeenCalled()
  })

  it("funciona com array vazio de usuários", async () => {
    await sendPushToMany([], "Título", "Corpo")

    expect(mockDb.pushSubscription.findMany).not.toHaveBeenCalled()
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it("envia com URL deep link para todos os usuários", async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([mockSubscription])
    vi.mocked(webpush.sendNotification).mockResolvedValue(undefined as any)

    await sendPushToMany(["user-1"], "Título", "Corpo", "/?view=test")

    const [, payload] = vi.mocked(webpush.sendNotification).mock.calls[0]
    const parsed = JSON.parse(payload)
    expect(parsed.url).toBe("/?view=test")
  })
})
