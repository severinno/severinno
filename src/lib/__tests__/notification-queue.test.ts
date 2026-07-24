import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockDb, sentPushCalls, sentQueueCalls } = vi.hoisted(() => {
  const pushCalls: Array<{ userId: string; title: string; body: string; url?: string }> = []
  const queueCalls: Array<{ routingKey: string; payload: Record<string, unknown> }> = []

  const db = {
    notification: {
      create: vi.fn(),
    },
    pushSubscription: {
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  }

  return {
    mockDb: db,
    sentPushCalls: pushCalls,
    sentQueueCalls: queueCalls,
  }
})

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/queue", () => ({
  publish: vi.fn().mockImplementation(async (payload: { routingKey: string; payload: Record<string, unknown> }) => {
    sentQueueCalls.push(payload)
  }),
}))

vi.mock("@/lib/push", () => ({
  sendPushNotification: vi.fn().mockImplementation(
    async (userId: string, title: string, body: string, url?: string) => {
      sentPushCalls.push({ userId, title, body, url })
    },
  ),
  sendPushToMany: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  db: mockDb,
}))

vi.mock("@/lib/realtime-client", () => ({
  emitRealtime: vi.fn().mockResolvedValue(undefined),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import {
  saveAndQueueNotification,
  queueNotification,
  handleNotification,
} from "../notification-queue"
import { publish } from "../queue"
import { sendPushNotification } from "../push"

// ===========================================================================
// queueNotification
// ============================================================================

describe("queueNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sentQueueCalls.length = 0
  })

  it("publica mensagem no RabbitMQ com routingKey notification", async () => {
    await queueNotification({
      notificationId: "test-notif-1",
      userId: "user-1",
      type: "BOOKING_REQUEST",
      title: "Novo agendamento",
      body: "Você recebeu um novo pedido.",
    })

    expect(publish).toHaveBeenCalledTimes(1)
    const call = vi.mocked(publish).mock.calls[0][0]
    expect(call.routingKey).toBe("notification")
    expect(call.payload.userId).toBe("user-1")
    expect(call.payload.type).toBe("BOOKING_REQUEST")
    expect(call.payload.title).toBe("Novo agendamento")
  })

  it("adiciona timestamp à mensagem", async () => {
    await queueNotification({
      notificationId: "test-notif-2",
      userId: "user-1",
      type: "WELCOME",
      title: "Bem-vindo!",
    })

    const call = vi.mocked(publish).mock.calls[0][0]
    expect(call.payload.timestamp).toBeDefined()
    expect(() => new Date(call.payload.timestamp as string)).not.toThrow()
  })

  it("funciona sem body opcional", async () => {
    await queueNotification({
      notificationId: "test-notif-3",
      userId: "user-1",
      type: "TEST",
      title: "Teste",
    })

    expect(publish).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// saveAndQueueNotification
// ============================================================================

describe("saveAndQueueNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sentPushCalls.length = 0
    sentQueueCalls.length = 0
    mockDb.notification.create.mockReset()
  })

  it("salva notificação no banco de dados", async () => {
    mockDb.notification.create.mockResolvedValue({ id: "notif-1", createdAt: new Date() })

    await saveAndQueueNotification({
      userId: "user-1",
      type: "BOOKING_CONFIRMED",
      title: "Agendamento confirmado",
      body: "Seu serviço foi confirmado.",
    })

    expect(mockDb.notification.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "BOOKING_CONFIRMED",
        title: "Agendamento confirmado",
        body: "Seu serviço foi confirmado.",
      },
    })
  })

  it("encaminha pushUrl para a fila RabbitMQ quando pushUrl é fornecido", async () => {
    mockDb.notification.create.mockResolvedValue({ id: "notif-2", createdAt: new Date() })

    await saveAndQueueNotification({
      userId: "user-2",
      type: "MESSAGE",
      title: "Nova mensagem",
      body: "Olá, tudo bem?",
      pushUrl: "/?view=client.messages",
    })

    // Push é despachado pelo consumer assíncrono (handleNotification),
    // não pelo saveAndQueueNotification. Verificamos se o pushUrl
    // foi encaminhado para a fila corretamente.
    expect(publish).toHaveBeenCalledTimes(1)
    const call = vi.mocked(publish).mock.calls[0][0]
    expect(call.payload.pushUrl).toBe("/?view=client.messages")
  })

  it("não inclui pushUrl no payload quando não fornecido", async () => {
    mockDb.notification.create.mockResolvedValue({ id: "notif-3", createdAt: new Date() })

    await saveAndQueueNotification({
      userId: "user-3",
      type: "WELCOME",
      title: "Bem-vindo!",
    })

    expect(publish).toHaveBeenCalledTimes(1)
    const call = vi.mocked(publish).mock.calls[0][0]
    expect(call.payload.pushUrl).toBeUndefined()
  })

  it("encaminha notificação para a fila RabbitMQ", async () => {
    mockDb.notification.create.mockResolvedValue({ id: "notif-4", createdAt: new Date() })

    await saveAndQueueNotification({
      userId: "user-4",
      type: "REVIEW_RECEIVED",
      title: "Nova avaliação",
    })

    expect(publish).toHaveBeenCalledTimes(1)
    const call = vi.mocked(publish).mock.calls[0][0]
    expect(call.routingKey).toBe("notification")
    expect(call.payload.userId).toBe("user-4")
  })

  it("não quebra se push notification falhar (fire-and-forget)", async () => {
    mockDb.notification.create.mockResolvedValue({ id: "notif-5", createdAt: new Date() })
    vi.mocked(sendPushNotification).mockRejectedValueOnce(new Error("Push failed"))

    // Deve resolver sem lançar exceção
    await expect(
      saveAndQueueNotification({
        userId: "user-5",
        type: "TEST",
        title: "Teste",
      }),
    ).resolves.not.toThrow()

    // DB e queue ainda devem ter sido chamados
    expect(mockDb.notification.create).toHaveBeenCalled()
    expect(publish).toHaveBeenCalled()
  })

  it("não quebra se DB falhar (propaga erro para o caller)", async () => {
    mockDb.notification.create.mockRejectedValueOnce(new Error("DB connection error"))

    await expect(
      saveAndQueueNotification({
        userId: "user-6",
        type: "TEST",
        title: "Teste",
      }),
    ).rejects.toThrow("DB connection error")

    // Queue e push NÃO devem ser chamados se DB falhar
    expect(publish).not.toHaveBeenCalled()
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it("salva notificação sem body (body opcional)", async () => {
    mockDb.notification.create.mockResolvedValue({ id: "notif-6", createdAt: new Date() })

    await saveAndQueueNotification({
      userId: "user-7",
      type: "BOOKING_COMPLETED",
      title: "Serviço concluído",
    })

    expect(mockDb.notification.create).toHaveBeenCalledWith({
      data: {
        userId: "user-7",
        type: "BOOKING_COMPLETED",
        title: "Serviço concluído",
        body: undefined,
      },
    })
  })
})

// ===========================================================================
// handleNotification
// ============================================================================

describe("handleNotification", () => {
  it("processa mensagem sem erros", async () => {
    const result = await handleNotification({
      userId: "user-1",
      type: "BOOKING_REQUEST",
      title: "Novo pedido",
      body: "Você tem um novo pedido de orçamento.",
      timestamp: new Date().toISOString(),
    })

    expect(result).toBeUndefined()
  })
})
