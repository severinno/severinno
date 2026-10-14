import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  normalizeCommand,
  getMainMenuText,
  getBookingsStatusText,
  getQuotesStatusText,
  getPixHelpText,
  processInteractiveCommand,
  handleEscrowApproval,
  handleEscrowDispute,
  processLocationCheckin,
} from "../whatsapp-autoresponder"
import { db } from "@/lib/db"
import { enqueueWhatsApp } from "@/lib/whatsapp-queue"
import { notifyProviderArrived } from "@/lib/notifications"

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    payment: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    notification: {
      create: vi.fn().mockResolvedValue({}),
    },
    quoteRequest: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn((promises) => Promise.all(promises)),
  },
}))

vi.mock("@/lib/notifications", () => ({
  notifyProviderArrived: vi.fn().mockResolvedValue(undefined),
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
      ;(db.booking.findMany as any).mockResolvedValue([])

      const res = await getBookingsStatusText("user-1")
      expect(res).toContain("Você ainda não possui nenhum agendamento")
    })

    it("retorna lista formatada com agendamentos recentes", async () => {
      ;(db.booking.findMany as any).mockResolvedValue([
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
      ;(db.quoteRequest.findMany as any).mockResolvedValue([
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
      ;(db.booking.findFirst as any).mockResolvedValue({
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
      ;(db.booking.findFirst as any).mockResolvedValue(null)

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
      ;(db.booking.findMany as any).mockResolvedValue([])

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

    it("reconhece 'APROVAR' e libera custódia de agendamento concluído", async () => {
      ;(db.booking.findFirst as any).mockResolvedValue({
        id: "book-escrow-1",
        amount: 250.0,
        clientId: "user-1",
        status: "COMPLETED",
        paymentStatus: "HELD",
        provider: { id: "provider-1", name: "Marcos Eletricista", whatsapp: "5533999998888" },
        service: { title: "Instalação de Painel" },
      })

      const res = await processInteractiveCommand({
        phone: "5533999999999",
        text: "APROVAR",
        user: { id: "user-1", name: "Carlos" },
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Pagamento Liberado com Sucesso")
      expect(db.$transaction).toHaveBeenCalled()
      expect(enqueueWhatsApp).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "5533999998888",
          context: "escrow:released:book-escrow-1",
        }),
      )
    })

    it("reconhece 'CONTESTAR' e bloqueia custódia abrindo chamado", async () => {
      ;(db.booking.findFirst as any).mockResolvedValue({
        id: "book-escrow-2",
        amount: 300.0,
        clientId: "user-1",
        status: "COMPLETED",
        paymentStatus: "HELD",
        provider: { id: "provider-2", name: "João Encanador" },
        service: { title: "Reparo Hidráulico" },
      })

      const res = await processInteractiveCommand({
        phone: "5533999999999",
        text: "CONTESTAR",
        user: { id: "user-1", name: "Carlos" },
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Contestação Registrada com Sucesso")
      expect(db.notification.create).toHaveBeenCalled()
    })
  })

  describe("processLocationCheckin", () => {
    it("valida check-in do prestador quando dentro do raio estrito de 50m", async () => {
      ;(db.booking.findFirst as any).mockResolvedValue({
        id: "book-checkin-1",
        providerId: "prov-1",
        clientId: "client-1",
        status: "CONFIRMED",
        lat: -18.8548,
        lng: -41.9482,
        address: "Rua Peçanha, 450 - Centro",
        client: { id: "client-1", name: "Carlos Cliente" },
        service: { title: "Troca de Fiação" },
      })

      const res = await processLocationCheckin({
        phone: "5533988887777",
        lat: -18.85485, // ~10m de distância
        lng: -41.94822,
        accuracy: 10,
        user: { id: "prov-1", name: "Marcos Prestador", role: "PROVIDER" },
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Check-in Presencial Confirmado")
      expect(db.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "book-checkin-1" },
          data: { status: "IN_PROGRESS" },
        }),
      )
      expect(notifyProviderArrived).toHaveBeenCalledWith(
        "client-1",
        "book-checkin-1",
        "Marcos Prestador",
        "Troca de Fiação",
      )
    })

    it("rejeita check-in quando prestador está além do raio permitido", async () => {
      ;(db.booking.findFirst as any).mockResolvedValue({
        id: "book-checkin-2",
        providerId: "prov-1",
        clientId: "client-1",
        status: "CONFIRMED",
        lat: -18.8548,
        lng: -41.9482,
        address: "Rua Peçanha, 450 - Centro",
        client: { id: "client-1", name: "Carlos Cliente" },
        service: { title: "Troca de Fiação" },
      })

      const res = await processLocationCheckin({
        phone: "5533988887777",
        lat: -18.87, // ~1.8km de distância
        lng: -41.96,
        accuracy: 15,
        user: { id: "prov-1", name: "Marcos Prestador", role: "PROVIDER" },
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Check-in Não Validado")
      expect(db.booking.update).not.toHaveBeenCalled()
      expect(notifyProviderArrived).not.toHaveBeenCalled()
    })
  })
})
