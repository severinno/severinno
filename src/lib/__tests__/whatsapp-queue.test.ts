import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockPublish, mockSendText, mockLogger } = vi.hoisted(() => {
  return {
    mockPublish: vi.fn(),
    mockSendText: vi.fn(),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  }
})

vi.mock("@/lib/queue", () => ({
  publish: mockPublish,
}))

vi.mock("@/lib/evolution", () => ({
  sendText: mockSendText,
  formatPhone: vi.fn((p: string) => {
    const digits = p.replace(/\D/g, "")
    return digits.startsWith("55") ? digits : `55${digits}`
  }),
  isValidWhatsApp: vi.fn((p: string) => p.length >= 12 && p.length <= 13),
}))

vi.mock("@/lib/logger", () => ({
  default: mockLogger,
  logger: mockLogger,
}))

import { enqueueWhatsApp, handleWhatsAppMessage } from "../whatsapp-queue"

describe("WhatsApp Queue (RabbitMQ)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("enqueueWhatsApp", () => {
    it("publica mensagem na fila com routingKey whatsapp.message", async () => {
      await enqueueWhatsApp({
        to: "11999998888",
        text: "Seu agendamento foi confirmado!",
        userId: "user-123",
        context: "booking:456:confirmed",
      })

      expect(mockPublish).toHaveBeenCalledTimes(1)
      const call = mockPublish.mock.calls[0][0]
      expect(call.routingKey).toBe("whatsapp.message")
      expect(call.payload.to).toBe("5511999998888")
      expect(call.payload.text).toBe("Seu agendamento foi confirmado!")
      expect(call.payload.userId).toBe("user-123")
      expect(call.payload.context).toBe("booking:456:confirmed")
      expect(call.payload.timestamp).toBeDefined()
    })

    it("ignora números de WhatsApp inválidos sem publicar na fila", async () => {
      await enqueueWhatsApp({
        to: "123", // Inválido
        text: "Mensagem para número inválido",
      })

      expect(mockPublish).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalled()
    })
  })

  describe("handleWhatsAppMessage", () => {
    it("processa mensagem da fila e envia via Evolution API", async () => {
      mockSendText.mockResolvedValueOnce({ key: { id: "msg-wa-789" } })

      await handleWhatsAppMessage({
        to: "5511999998888",
        text: "Recibo de pagamento PIX gerado.",
        userId: "user-123",
        context: "payment:pix:123",
      })

      expect(mockSendText).toHaveBeenCalledWith("5511999998888", "Recibo de pagamento PIX gerado.")
      expect(mockLogger.info).toHaveBeenCalled()
    })

    it("ignora mensagens com payload incompleto sem lançar erro", async () => {
      await handleWhatsAppMessage({
        to: "",
        text: "",
      })

      expect(mockSendText).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it("re-lança erro quando sendText falha para permitir retry e DLQ no RabbitMQ", async () => {
      const networkError = new Error("Evolution API timeout")
      mockSendText.mockRejectedValueOnce(networkError)

      await expect(
        handleWhatsAppMessage({
          to: "5511999998888",
          text: "Mensagem que falhará no envio",
          context: "test:error",
        }),
      ).rejects.toThrow("Evolution API timeout")

      expect(mockLogger.error).toHaveBeenCalled()
    })
  })
})
