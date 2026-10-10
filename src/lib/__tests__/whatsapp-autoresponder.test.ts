import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  normalizeCommand,
  getMainMenuText,
  getBookingsStatusText,
  getQuotesStatusText,
  getPixHelpText,
  processInteractiveCommand,
} from "../whatsapp-autoresponder"
import { db } from "@/lib/db"
import { enqueueWhatsApp } from "@/lib/whatsapp-queue"

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    quoteRequest: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/whatsapp-queue", () => ({
  enqueueWhatsApp: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}))

describe("WhatsApp Autoresponder & Interactive Parser", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("normalizeCommand", () => {
    it("remove acentuações e converte para maiúsculo", () => {
      expect(normalizeCommand("  orçamentos  ")).toBe("ORCAMENTOS")
      expect(normalizeCommand("Agendamento")).toBe("AGENDAMENTO")
      expect(normalizeCommand("olá")).toBe("OLA")
    })
  })

  describe("getMainMenuText", () => {
    it("inclui nome do usuário e lista de opções numeradas", () => {
      const menu = getMainMenuText("Carlos")
      expect(menu).toContain("Olá, *Carlos*!")
      expect(menu).toContain("1️⃣ *1* ou *AGENDAMENTOS*")
      expect(menu).toContain("2️⃣ *2* ou *ORCAMENTOS*")
      expect(menu).toContain("3️⃣ *3* ou *PIX*")
      expect(menu).toContain("4️⃣ *4* ou *SUPORTE*")
    })
  })

  describe("getBookingsStatusText", () => {
    it("retorna mensagem informativa quando não há agendamentos", async () => {
      ;(vi.mocked(db.booking.findMany) as any).mockResolvedValue([])

      const res = await getBookingsStatusText("user-1")
      expect(res).toContain("Você ainda não possui nenhum agendamento")
    })

    it("retorna lista formatada com agendamentos recentes", async () => {
      ;(vi.mocked(db.booking.findMany) as any).mockResolvedValue([
        {
          id: "book-12345678",
          clientId: "user-1",
          providerId: "provider-1",
          status: "CONFIRMED",
          scheduledAt: new Date("2026-10-15T14:00:00Z"),
          service: { title: "Instalação Elétrica" },
          client: { name: "Carlos" },
          provider: { name: "Eletricista Pro" },
        },
      ])

      const res = await getBookingsStatusText("user-1")
      expect(res).toContain("#book-123")
      expect(res).toContain("Instalação Elétrica")
      expect(res).toContain("🔵 Confirmado")
      expect(res).toContain("Eletricista Pro")
    })
  })

  describe("getQuotesStatusText", () => {
    it("retorna resumo dos orçamentos quando existem", async () => {
      ;(vi.mocked(db.quoteRequest.findMany) as any).mockResolvedValue([
        {
          id: "quote-98765432",
          clientId: "user-1",
          providerId: "provider-2",
          status: "PENDING",
          items: [{ description: "Pintura de Parede", quantity: 1 }],
          client: { name: "Carlos" },
          provider: { name: "Pinturas Silva" },
        },
      ])

      const res = await getQuotesStatusText("user-1")
      expect(res).toContain("#quote-98")
      expect(res).toContain("Pintura de Parede")
      expect(res).toContain("🟡 Aguardando Resposta")
    })
  })

  describe("getPixHelpText", () => {
    it("retorna pendência com valor quando há pagamento pendente", async () => {
      ;(vi.mocked(db.booking.findFirst) as any).mockResolvedValue({
        id: "book-pending-1",
        amount: 150.0,
        paymentStatus: "PENDING",
        service: { title: "Troca de Chuveiro" },
      })

      const res = await getPixHelpText("user-1")
      expect(res).toContain("R$ 150.00")
      expect(res).toContain("Severinno Escrow")
      expect(res).toContain("#book-pen")
    })

    it("retorna parabéns quando tudo está pago", async () => {
      ;(vi.mocked(db.booking.findFirst) as any).mockResolvedValue(null)

      const res = await getPixHelpText("user-1")
      expect(res).toContain("Você não possui nenhum pagamento pendente")
    })
  })

  describe("processInteractiveCommand", () => {
    it("reconhece 'MENU' e enfileira resposta no RabbitMQ", async () => {
      const res = await processInteractiveCommand({
        phone: "5511999999999",
        text: "Menu",
        user: { id: "user-1", name: "Carlos" },
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Severinno Marketplace")
      expect(enqueueWhatsApp).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "5511999999999",
          userId: "user-1",
          context: "autoresponder:MENU",
        }),
      )
    })

    it("reconhece '1' e responde com agendamentos", async () => {
      ;(vi.mocked(db.booking.findMany) as any).mockResolvedValue([])

      const res = await processInteractiveCommand({
        phone: "5511999999999",
        text: "1",
        user: { id: "user-1", name: "Carlos" },
      })

      expect(res.handled).toBe(true)
      expect(enqueueWhatsApp).toHaveBeenCalledWith(
        expect.objectContaining({
          context: "autoresponder:1",
        }),
      )
    })

    it("reconhece '4' e aciona suporte humano", async () => {
      const res = await processInteractiveCommand({
        phone: "5511999999999",
        text: "suporte",
        user: { id: "user-1", name: "Carlos" },
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Suporte Humano")
    })

    it("retorna handled=false para mensagens conversacionais comuns", async () => {
      const res = await processInteractiveCommand({
        phone: "5511999999999",
        text: "Oi, que horas você chega amanhã?",
        user: { id: "user-1", name: "Carlos" },
      })

      expect(res.handled).toBe(false)
      expect(enqueueWhatsApp).not.toHaveBeenCalled()
    })
  })
})
