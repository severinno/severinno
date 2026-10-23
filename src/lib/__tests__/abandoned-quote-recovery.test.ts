import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  formatWhatsAppNumber,
  buildRecoveryMessage,
  runAbandonedQuoteRecovery,
} from "../abandoned-quote-recovery"
import { db } from "@/lib/db"
import { sendText } from "@/lib/evolution"

vi.mock("@/lib/db", () => ({
  db: {
    quoteRequest: {
      findMany: vi.fn(),
    },
    whatsAppMessageLog: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/evolution", () => ({
  sendText: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

describe("abandoned-quote-recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("formatWhatsAppNumber", () => {
    it("adiciona DDI 55 para números de 10 ou 11 dígitos", () => {
      expect(formatWhatsAppNumber("(33) 99988-7766")).toBe("5533999887766")
      expect(formatWhatsAppNumber("3133334444")).toBe("553133334444")
    })

    it("mantém número que já possui DDI 55", () => {
      expect(formatWhatsAppNumber("5533999887766")).toBe("5533999887766")
      expect(formatWhatsAppNumber("+55 (33) 99988-7766")).toBe("5533999887766")
    })

    it("retorna string vazia para entrada vazia ou inválida", () => {
      expect(formatWhatsAppNumber("")).toBe("")
      expect(formatWhatsAppNumber("abc")).toBe("")
    })
  })

  describe("buildRecoveryMessage", () => {
    it("formata mensagem amigável com primeiro nome e link direto da cotação", () => {
      const msg = buildRecoveryMessage({
        clientName: "João Pedro Silveira",
        serviceTitle: "Conserto de Ar-Condicionado",
        providerName: "Climatiza GV",
        quoteId: "quote-xyz-123",
        appUrl: "https://severinno.com",
      })

      expect(msg).toContain("Olá, João! 👋")
      expect(msg).toContain("*Conserto de Ar-Condicionado*")
      expect(msg).toContain("Climatiza GV")
      expect(msg).toContain("https://severinno.com/?view=client.quotes&quoteId=quote-xyz-123")
      expect(msg).toContain("custódia escrow")
    })
  })

  describe("runAbandonedQuoteRecovery", () => {
    const mockQuote = {
      id: "quote-1",
      clientId: "client-1",
      providerId: "provider-1",
      status: "PENDING",
      createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min atrás
      client: {
        id: "client-1",
        name: "Carlos Almeida",
        whatsapp: "33988887777",
        phone: null,
      },
      provider: {
        id: "provider-1",
        name: "Eletro Service",
      },
      items: [
        {
          service: {
            title: "Troca de Fiação",
          },
        },
      ],
      bookings: [],
    }

    it("recupera com sucesso cotação pendente sem agendamento e sem envio recente", async () => {
      vi.mocked(db.quoteRequest.findMany).mockResolvedValue([mockQuote as any])
      vi.mocked(db.whatsAppMessageLog.findFirst).mockResolvedValue(null) // Nenhum log recente
      vi.mocked(sendText).mockResolvedValue({ key: { id: "msg-123" } } as any)
      vi.mocked(db.whatsAppMessageLog.create).mockResolvedValue({ id: "log-1" } as any)

      const result = await runAbandonedQuoteRecovery({ minAgeMinutes: 15 })

      expect(result.totalEligible).toBe(1)
      expect(result.recoveredCount).toBe(1)
      expect(result.skippedSpamCount).toBe(0)

      expect(sendText).toHaveBeenCalledWith(
        "5533988887777",
        expect.stringContaining("Troca de Fiação"),
      )
      expect(db.whatsAppMessageLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phone: "5533988887777",
            context: "quote:recovery",
            status: "SENT",
          }),
        }),
      )
    })

    it("aplica proteção anti-spam quando cliente já recebeu recuperação nos últimos 7 dias", async () => {
      vi.mocked(db.quoteRequest.findMany).mockResolvedValue([mockQuote as any])
      vi.mocked(db.whatsAppMessageLog.findFirst).mockResolvedValue({
        id: "log-recent",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 dias atrás
      } as any)

      const result = await runAbandonedQuoteRecovery({ antiSpamDays: 7 })

      expect(result.recoveredCount).toBe(0)
      expect(result.skippedSpamCount).toBe(1)
      expect(sendText).not.toHaveBeenCalled()
      expect(db.whatsAppMessageLog.create).not.toHaveBeenCalled()
    })

    it("ignora cotação se o cliente não possui telefone ou WhatsApp", async () => {
      const quoteNoPhone = {
        ...mockQuote,
        client: { id: "client-2", name: "Sem Telefone", whatsapp: null, phone: null },
      }
      vi.mocked(db.quoteRequest.findMany).mockResolvedValue([quoteNoPhone as any])

      const result = await runAbandonedQuoteRecovery()

      expect(result.recoveredCount).toBe(0)
      expect(result.skippedNoPhoneCount).toBe(1)
      expect(sendText).not.toHaveBeenCalled()
    })

    it("ignora cotação se já existe agendamento criado", async () => {
      const quoteWithBooking = {
        ...mockQuote,
        bookings: [{ id: "booking-1", status: "CONFIRMED" }],
      }
      vi.mocked(db.quoteRequest.findMany).mockResolvedValue([quoteWithBooking as any])

      const result = await runAbandonedQuoteRecovery()

      expect(result.recoveredCount).toBe(0)
      expect(result.skippedAlreadyBookedCount).toBe(1)
      expect(sendText).not.toHaveBeenCalled()
    })

    it("no modo dryRun qualifica sem enviar mensagem real ou criar log", async () => {
      vi.mocked(db.quoteRequest.findMany).mockResolvedValue([mockQuote as any])
      vi.mocked(db.whatsAppMessageLog.findFirst).mockResolvedValue(null)

      const result = await runAbandonedQuoteRecovery({ dryRun: true })

      expect(result.recoveredCount).toBe(1)
      expect(sendText).not.toHaveBeenCalled()
      expect(db.whatsAppMessageLog.create).not.toHaveBeenCalled()
    })
  })
})
