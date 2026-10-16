import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  normalizeCommand,
  getMainMenuText,
  getBookingsStatusText,
  getQuotesStatusText,
  getPixHelpText,
  getServicesCatalogText,
  processInteractiveCommand,
  processLocationCheckin,
  extractGvNeighborhood,
  processDemandSearch,
  handleInstantQuoteHiring,
} from "../whatsapp-autoresponder"
import { db } from "@/lib/db"
import { enqueueWhatsApp } from "@/lib/whatsapp-queue"
import { notifyProviderArrived } from "@/lib/notifications"

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi
        .fn()
        .mockImplementation((data) =>
          Promise.resolve({ id: "book-new-1", amount: 150, ...data.data }),
        ),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    payment: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({ id: "pay-1" }),
    },
    notification: {
      create: vi.fn().mockResolvedValue({}),
    },
    dispute: {
      create: vi.fn().mockResolvedValue({ id: "disp-1" }),
    },
    quoteRequest: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    quoteItem: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn((promises) => Promise.all(promises)),
  },
}))

vi.mock("@/lib/lytex", () => ({
  createPixCharge: vi.fn().mockResolvedValue({
    id: "lytex-chg-1",
    status: "waitingPayment",
    transactionId: "tx-1",
    qrCode: "00020126580014br.gov.bcb.pix0136test-qr-code",
    qrCodeImage: "",
    pixKey: "",
    expiresAt: "2026-10-16",
    amount: 15000,
    lytexStatus: "waitingPayment",
    createdAt: new Date().toISOString(),
  }),
}))

vi.mock("@/lib/notifications", () => ({
  notifyProviderArrived: vi.fn().mockResolvedValue(undefined),
  notifyNewBooking: vi.fn().mockResolvedValue(undefined),
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
      expect(menu).toContain("5️⃣ *5* ou *SERVICOS*")
    })
  })

  describe("getServicesCatalogText", () => {
    it("retorna catálogo de serviços com destaque para Governador Valadares", () => {
      const catalog = getServicesCatalogText()
      expect(catalog).toContain("Governador Valadares (MG)")
      expect(catalog).toContain("Climatização")
      expect(catalog).toContain("Limpeza & Diarista")
      expect(catalog).toContain("Eletricista")
      expect(catalog).toContain("Hidráulica")
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
      ;(db.booking.findMany as any).mockResolvedValue([
        {
          id: "book-escrow-1",
          amount: 250.0,
          clientId: "user-1",
          status: "COMPLETED",
          paymentStatus: "HELD",
          provider: { id: "provider-1", name: "Marcos Eletricista", whatsapp: "5533999998888" },
          service: { title: "Instalação de Painel" },
        },
      ])

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

    it("solicita desambiguação com #CODIGO quando há mais de um agendamento aguardando aprovação", async () => {
      ;(db.booking.findMany as any).mockResolvedValue([
        {
          id: "book-1",
          amount: 100,
          provider: { id: "p1", name: "P1", whatsapp: "111" },
          service: { title: "Serviço 1" },
        },
        {
          id: "book-2",
          amount: 200,
          provider: { id: "p2", name: "P2", whatsapp: "222" },
          service: { title: "Serviço 2" },
        },
      ])

      const res = await processInteractiveCommand({
        phone: "5533999999999",
        text: "APROVAR",
        user: { id: "user-1", name: "Carlos" },
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Você possui mais de um serviço concluído")
      expect(res.replyText).toContain("APROVAR #CODIGO")
      expect(db.$transaction).not.toHaveBeenCalled()
    })

    it("permite aprovar usando o número da opção (APROVAR 1) quando há múltiplos agendamentos", async () => {
      ;(db.booking.findMany as any).mockResolvedValue([
        {
          id: "book-1",
          amount: 100,
          provider: { id: "p1", name: "P1", whatsapp: "111" },
          service: { title: "Serviço 1" },
        },
        {
          id: "book-2",
          amount: 200,
          provider: { id: "p2", name: "P2", whatsapp: "222" },
          service: { title: "Serviço 2" },
        },
      ])

      const res = await processInteractiveCommand({
        phone: "5533999999999",
        text: "APROVAR 1",
        user: { id: "user-1", name: "Carlos" },
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Pagamento Liberado com Sucesso")
      expect(res.replyText).toContain("#book-1")
      expect(db.$transaction).toHaveBeenCalled()
    })

    it("direciona comando PAGAR para instruções de pagamento e PIX sem liberar custódia indevida", async () => {
      ;(db.booking.findMany as any).mockResolvedValue([])

      const res = await processInteractiveCommand({
        phone: "5533999999999",
        text: "PAGAR",
        user: { id: "user-1", name: "Carlos" },
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Pagamentos e PIX")
      expect(db.$transaction).not.toHaveBeenCalled()
    })

    it("previne dupla liberação sob concorrência se count == 0", async () => {
      ;(db.booking.findMany as any).mockResolvedValue([
        {
          id: "book-escrow-1",
          amount: 250.0,
          clientId: "user-1",
          status: "COMPLETED",
          paymentStatus: "HELD",
          provider: { id: "provider-1", name: "Marcos Eletricista", whatsapp: "5533999998888" },
          service: { title: "Instalação de Painel" },
        },
      ])
      // Simula que outra transação concorrente já atualizou o status para PAID
      ;(db.$transaction as any).mockResolvedValueOnce([{ count: 0 }, { count: 0 }])

      const res = await processInteractiveCommand({
        phone: "5533999999999",
        text: "APROVAR",
        user: { id: "user-1", name: "Carlos" },
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("já foi liberado ou não está mais sob custódia")
      expect(enqueueWhatsApp).not.toHaveBeenCalledWith(
        expect.objectContaining({
          context: "escrow:released:book-escrow-1",
        }),
      )
    })

    it("reconhece 'CONTESTAR' e bloqueia custódia abrindo chamado", async () => {
      ;(db.booking.findMany as any).mockResolvedValue([
        {
          id: "book-escrow-2",
          amount: 300.0,
          clientId: "user-1",
          status: "COMPLETED",
          paymentStatus: "HELD",
          provider: { id: "provider-2", name: "João Encanador" },
          service: { title: "Reparo Hidráulico" },
        },
      ])

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

    it("rejeita check-in quando o prestador envia PIN estático arbitrário (isLiveLocation=false)", async () => {
      ;(db.booking.findFirst as any).mockResolvedValue({
        id: "book-checkin-3",
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
        lat: -18.8548,
        lng: -41.9482,
        accuracy: 5,
        isLiveLocation: false, // Pino estático forjado
        user: { id: "prov-1", name: "Marcos Prestador", role: "PROVIDER" },
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Localização Estática")
      expect(res.replyText).toContain("Tempo Real (Live)")
      expect(db.booking.update).not.toHaveBeenCalled()
    })

    it("não libera custódia para palavras genéricas ambíguas como 'SIM'", async () => {
      const res = await processInteractiveCommand({
        phone: "5533999999999",
        text: "SIM",
        user: { id: "user-1", name: "Carlos" },
      })

      expect(res.handled).toBe(false)
      expect(db.$transaction).not.toHaveBeenCalled()
    })

    it("responde catálogo de serviços quando usuário digita '5' ou 'SERVICOS'", async () => {
      const res = await processInteractiveCommand({
        phone: "5533999999999",
        text: "5",
        user: { id: "user-1", name: "Carlos" },
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Governador Valadares (MG)")
      expect(res.replyText).toContain("Climatização")
      expect(enqueueWhatsApp).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "5533999999999",
          context: "autoresponder:5",
        }),
      )
    })
  })

  describe("extractGvNeighborhood", () => {
    it("identifica corretamente bairros de Governador Valadares", () => {
      expect(extractGvNeighborhood("preciso de eletricista na Ilha dos Araújos")).toBe(
        "Ilha dos Araújos",
      )
      expect(extractGvNeighborhood("tem encanador no centro?")).toBe("Centro")
      expect(extractGvNeighborhood("moro na vila bretas")).toBe("Vila Bretas")
      expect(extractGvNeighborhood("serviço em belo horizonte")).toBeNull()
    })
  })

  describe("processDemandSearch", () => {
    it("identifica demanda de chuveiro queimado e responde com link preditivo e garantia escrow", async () => {
      const res = await processDemandSearch({
        phone: "5533988881234",
        text: "meu chuveiro queimou preciso trocar a resistência no Centro de GV",
        userId: "user-123",
        userName: "Renata",
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Severinno Match Inteligente")
      expect(res.replyText).toContain("Renata")
      expect(res.replyText).toContain("Elétrica & Instalações")
      expect(res.replyText).toContain("Centro")
      expect(res.replyText).toContain("Garantia em Custódia (Escrow)")
      expect(res.replyText).toContain("https://severinno.com.br/busca?q=")
      expect(enqueueWhatsApp).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "5533988881234",
          context: "demand:eletrica",
        }),
      )
    })

    it("identifica emergência 24h e inclui link direto para SOS", async () => {
      const res = await processDemandSearch({
        phone: "5533988881234",
        text: "chaveiro urgente porta trancada com criança dentro na ilha dos araujos",
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Chaveiro 24 Horas")
      expect(res.replyText).toContain("Atendimento SOS Emergência 24h Disponível")
      expect(res.replyText).toContain("https://severinno.com.br/?sos=1")
    })

    it("retorna handled=false para mensagens genéricas sem intenção de serviço", async () => {
      const res = await processDemandSearch({
        phone: "5533988881234",
        text: "qual o horário de funcionamento do banco do brasil?",
      })

      expect(res.handled).toBe(false)
    })
  })

  describe("handleInstantQuoteHiring & Comandos de Contratação", () => {
    it("retorna mensagem informativa quando não há orçamentos aguardando contratação", async () => {
      vi.mocked(db.quoteRequest.findFirst).mockResolvedValueOnce(null)

      const reply = await handleInstantQuoteHiring("user-1", "5533999991111")
      expect(reply).toContain("Não encontramos nenhum orçamento aguardando contratação")
    })

    it("retorna aviso quando o orçamento ainda não tem preço definido pelo prestador", async () => {
      vi.mocked(db.quoteRequest.findFirst).mockResolvedValueOnce({
        id: "quote-pending-val",
        clientId: "user-1",
        providerId: "prov-1",
        items: [{ price: null, service: { title: "Pintura" } }],
        bookings: [],
      } as any)

      const reply = await handleInstantQuoteHiring("user-1", "5533999991111", "quote-pe")
      expect(reply).toContain("ainda não possui valores definidos pelo profissional")
    })

    it("retorna aviso quando o agendamento já foi pago anteriormente", async () => {
      vi.mocked(db.quoteRequest.findFirst).mockResolvedValueOnce({
        id: "quote-paid-1",
        clientId: "user-1",
        providerId: "prov-1",
        items: [{ price: 180, service: { title: "Pintura" } }],
        bookings: [{ id: "book-paid-1", paymentStatus: "PAID" }],
      } as any)

      const reply = await handleInstantQuoteHiring("user-1", "5533999991111", "quote-paid")
      expect(reply).toContain("já foi pago e está confirmado")
    })

    it("cria agendamento, gera PIX via Lytex e retorna código com garantia Escrow", async () => {
      vi.mocked(db.quoteRequest.findFirst).mockResolvedValueOnce({
        id: "quote-hire-ok",
        clientId: "user-client",
        providerId: "user-prov",
        address: "Centro, Gov. Valadares",
        cep: "35010-000",
        lat: -18.85,
        lng: -41.95,
        client: {
          id: "user-client",
          name: "Mariana",
          email: "mari@severinno.com",
          cpfCnpj: "12345678900",
          whatsapp: "5533999991111",
        },
        provider: { id: "user-prov", name: "Carlos Eletricista", whatsapp: "5533988887777" },
        items: [{ price: 150, service: { id: "srv-1", title: "Troca de Quadro" } }],
        bookings: [],
      } as any)

      const reply = await handleInstantQuoteHiring("user-client", "5533999991111", "quote-hire")

      expect(reply).toContain("Contratação Confirmada com Sucesso!")
      expect(reply).toContain("Carlos Eletricista")
      expect(reply).toContain("Troca de Quadro")
      expect(reply).toContain("R$ 150.00")
      expect(reply).toContain("00020126580014br.gov.bcb.pix0136test-qr-code")
      expect(reply).toContain("Garantia Severinno Escrow")
      expect(db.$transaction).toHaveBeenCalled()
      expect(db.payment.upsert).toHaveBeenCalled()
    })

    it("processInteractiveCommand reconhece CONTRATAR e despacha contratação rápida", async () => {
      vi.mocked(db.quoteRequest.findFirst).mockResolvedValueOnce({
        id: "quote-hire-2",
        clientId: "user-client",
        providerId: "user-prov",
        address: "Ilha dos Araújos",
        cep: "35010-000",
        lat: -18.85,
        lng: -41.95,
        client: {
          id: "user-client",
          name: "Mariana",
          email: "mari@severinno.com",
          cpfCnpj: "12345678900",
          whatsapp: "5533999991111",
        },
        provider: { id: "user-prov", name: "Carlos Eletricista", whatsapp: "5533988887777" },
        items: [{ price: 200, service: { id: "srv-1", title: "Instalação Split" } }],
        bookings: [],
      } as any)

      const res = await processInteractiveCommand({
        phone: "5533999991111",
        text: "CONTRATAR #quote-hire-2",
        user: { id: "user-client", name: "Mariana" },
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Contratação Confirmada com Sucesso!")
      expect(enqueueWhatsApp).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "5533999991111",
          context: "autoresponder:CONTRATAR #QUOTE-HIRE-2",
        }),
      )
    })

    it("processInteractiveCommand reconhece ORCAR e inicia wizard de solicitação", async () => {
      const res = await processInteractiveCommand({
        phone: "5533999991111",
        text: "ORCAR",
        user: { id: "user-client", name: "Mariana" },
      })

      expect(res.handled).toBe(true)
      expect(res.replyText).toContain("Solicitação de Orçamento - Severinno")
      expect(res.replyText).toContain("Mariana")
      expect(res.replyText).toContain("O que você precisa que seja feito?")
    })
  })
})
