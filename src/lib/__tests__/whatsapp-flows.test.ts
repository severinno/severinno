import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockDb, mockRedis, mockQueue, mockEvolution, mockLogger } = vi.hoisted(() => {
  return {
    mockDb: {
      user: {
        findMany: vi.fn(),
      },
      booking: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      quoteRequest: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
    mockRedis: {
      get: vi.fn(),
      set: vi.fn(),
    },
    mockQueue: {
      enqueueWhatsApp: vi.fn().mockResolvedValue(undefined),
    },
    mockEvolution: {
      sendText: vi.fn().mockResolvedValue({ key: { id: "msg-1" } }),
      sendButtons: vi.fn().mockResolvedValue({ key: { id: "msg-2" } }),
      formatPhone: vi.fn((p: string) => {
        const digits = p.replace(/\D/g, "")
        return digits.startsWith("55") ? digits : `55${digits}`
      }),
      isValidWhatsApp: vi.fn((p: string) => p.length >= 12 && p.length <= 13),
    },
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  }
})

vi.mock("@/lib/db", () => ({
  db: mockDb,
}))

vi.mock("@/lib/redis", () => ({
  getClient: vi.fn(() => mockRedis),
}))

vi.mock("@/lib/whatsapp-queue", () => ({
  enqueueWhatsApp: mockQueue.enqueueWhatsApp,
}))

vi.mock("./evolution", () => mockEvolution)
vi.mock("@/lib/evolution", () => mockEvolution)

vi.mock("@/lib/geo-timezone", () => ({
  getTimezoneFromCoords: vi.fn().mockReturnValue("America/Sao_Paulo"),
}))

vi.mock("@/lib/logger", () => ({
  default: mockLogger,
  logger: mockLogger,
}))

import { runInactiveClientsReactivation, runAllWhatsAppFlows } from "../whatsapp-flows"

describe("WhatsApp Lifecycle Flows - Inactive Clients Reactivation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("identifica clientes inativos, aplica deduplicação Redis e enfileira mensagem sem cupom", async () => {
    mockDb.user.findMany.mockResolvedValueOnce([
      {
        id: "client-1",
        name: "Carlos Silva",
        whatsapp: "11988887777",
      },
      {
        id: "client-2",
        name: "Mariana Souza",
        whatsapp: "11977776666",
      },
    ])

    // client-1 ainda não recebeu (null); client-2 já recebeu ("1")
    mockRedis.get.mockImplementation(async (key: string) => {
      if (key === "flow:client-reactivation:client-2") return "1"
      return null
    })

    const result = await runInactiveClientsReactivation(30, 50)

    expect(result.eligible).toBe(2)
    expect(result.sent).toBe(1)
    expect(result.errors).toBe(0)

    // Apenas client-1 deve ter sido enfileirado
    expect(mockQueue.enqueueWhatsApp).toHaveBeenCalledTimes(1)
    const enqueueCall = mockQueue.enqueueWhatsApp.mock.calls[0][0]
    expect(enqueueCall.to).toBe("5511988887777")
    expect(enqueueCall.userId).toBe("client-1")
    expect(enqueueCall.context).toBe("flow:client_reactivation")

    // Garantia estrita do usuário: SOMENTE MENSAGEM SEM CUPOM PIX DE DESCONTO
    const text = enqueueCall.text.toLowerCase()
    expect(text).toContain("carlos silva")
    expect(text).toContain("sentimos sua falta")
    expect(text).toContain("escrow")
    expect(text).not.toContain("cupom")
    expect(text).not.toContain("desconto")
    expect(text).not.toContain("pix de desconto")

    // Verifica se salvou deduplicação no Redis com TTL de 30 dias
    expect(mockRedis.set).toHaveBeenCalledWith(
      "flow:client-reactivation:client-1",
      "1",
      "EX",
      30 * 24 * 3600,
    )
  })

  it("não envia mensagem se o telefone for inválido", async () => {
    mockDb.user.findMany.mockResolvedValueOnce([
      {
        id: "client-invalid",
        name: "João",
        whatsapp: "123", // Inválido
      },
    ])
    mockRedis.get.mockResolvedValue(null)

    const result = await runInactiveClientsReactivation(30)

    expect(result.eligible).toBe(1)
    expect(result.sent).toBe(0)
    expect(mockQueue.enqueueWhatsApp).not.toHaveBeenCalled()
  })

  it("executa todos os fluxos no master runner runAllWhatsAppFlows incluindo reativação", async () => {
    mockDb.user.findMany.mockResolvedValueOnce([])

    const summary = await runAllWhatsAppFlows()

    expect(summary).toBeDefined()
    expect(summary.reminders).toBeDefined()
    expect(summary.followups).toBeDefined()
    expect(summary.reviews).toBeDefined()
    expect(summary.reactivation).toBeDefined()
    expect(summary.reactivation.eligible).toBe(0)
  })
})
