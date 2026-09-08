import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockLogger } = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }
  return { mockLogger: logger }
})

vi.mock("@/lib/logger", () => ({
  default: mockLogger,
  logger: mockLogger,
}))

// ── Imports ────────────────────────────────────────────────────────────────

import {
  formatPhone,
  isValidWhatsApp,
  sendLiveTrackingNotification,
  sendPixPaymentReceiptToClient,
  sendBookingReminder24hNotification,
  sendPixPaymentMessage,
  sendServiceCompletionRequest,
  sendReviewRequest,
  sendText,
} from "../evolution"

// ── Helpers ────────────────────────────────────────────────────────────────

function mockFetch(response: Partial<Response>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
    text: vi.fn().mockResolvedValue(""),
    json: vi.fn().mockResolvedValue({ key: { id: "msg-123" } }),
    ...response,
  })
}

describe("Evolution API - Format helpers", () => {
  it("formatPhone adiciona DDI 55 para números de 10 e 11 dígitos", () => {
    expect(formatPhone("11999998888")).toBe("5511999998888")
    expect(formatPhone("1133334444")).toBe("551133334444")
    expect(formatPhone("(11) 99999-8888")).toBe("5511999998888")
    expect(formatPhone("+55 (11) 99999-8888")).toBe("5511999998888")
  })

  it("formatPhone preserva números que já possuem DDI 55", () => {
    expect(formatPhone("5511999998888")).toBe("5511999998888")
  })

  it("isValidWhatsApp valida corretamente números de telefone", () => {
    expect(isValidWhatsApp("5511999998888")).toBe(true)
    expect(isValidWhatsApp("11999998888")).toBe(true)
    expect(isValidWhatsApp(null)).toBe(false)
    expect(isValidWhatsApp(undefined)).toBe(false)
    expect(isValidWhatsApp("")).toBe(false)
    expect(isValidWhatsApp("123")).toBe(false) // muito curto
    expect(isValidWhatsApp("12345678901234567")).toBe(false) // muito longo
  })
})

describe("Evolution API - WhatsApp Templates", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("EVOLUTION_API_URL", "https://evo.severinno.test")
    vi.stubEnv("EVOLUTION_API_KEY", "secret-test-key")
    vi.stubEnv("EVOLUTION_INSTANCE", "severinno-test")
    globalThis.fetch = mockFetch({})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("sendLiveTrackingNotification envia link de tracking e nome do prestador", async () => {
    const res = await sendLiveTrackingNotification(
      "5511999998888",
      "Carlos Eletricista",
      "Instalação Elétrica",
      "booking-abcdef12-3456",
      "https://severinno.com.br/track/test",
    )

    expect(res).toEqual({ key: { id: "msg-123" } })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)

    const [url, opts] = (globalThis.fetch as any).mock.calls[0]
    expect(url).toBe("https://evo.severinno.test/message/sendText/severinno-test")
    expect(opts.headers.apikey).toBe("secret-test-key")

    const body = JSON.parse(opts.body)
    expect(body.number).toBe("5511999998888")
    expect(body.text).toContain("Carlos Eletricista")
    expect(body.text).toContain("Instalação Elétrica")
    expect(body.text).toContain("https://severinno.com.br/track/test")
    expect(body.text).toContain("tempo real pelo mapa")
  })

  it("sendLiveTrackingNotification gera fallback de URL se trackingUrl não for fornecido", async () => {
    await sendLiveTrackingNotification(
      "5511999998888",
      "Maria Encanadora",
      "Reparo Hidráulico",
      "booking-99887766",
    )

    const [, opts] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.text).toContain(
      "https://severinno.com.br/?view=client.bookings&tracking=booking-99887766",
    )
  })

  it("sendPixPaymentReceiptToClient envia recibo com valor e garantia Severinno Escrow", async () => {
    const res = await sendPixPaymentReceiptToClient(
      "5511999998888",
      "booking-12345678",
      250.5,
      "Pintura Residencial",
      "João Pintor",
    )

    expect(res).toEqual({ key: { id: "msg-123" } })
    const [, opts] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.text).toContain("Pagamento PIX Confirmado!")
    expect(body.text).toContain("R$ 250.50")
    expect(body.text).toContain("Pintura Residencial")
    expect(body.text).toContain("João Pintor")
    expect(body.text).toContain("Severinno Escrow")
  })

  it("sendBookingReminder24hNotification envia detalhes completos do serviço e endereço", async () => {
    const res = await sendBookingReminder24hNotification(
      "5511999998888",
      "Ana Cliente",
      "Limpeza Pós-Obra",
      "Mariana Faxinas",
      "08/09/2026 às 14:00",
      "booking-77665544",
      "Rua Augusta, 1000 - SP",
    )

    expect(res).toEqual({ key: { id: "msg-123" } })
    const [, opts] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.text).toContain("Lembrete de Agendamento")
    expect(body.text).toContain("Ana Cliente")
    expect(body.text).toContain("Limpeza Pós-Obra")
    expect(body.text).toContain("Mariana Faxinas")
    expect(body.text).toContain("08/09/2026 às 14:00")
    expect(body.text).toContain("Rua Augusta, 1000 - SP")
    expect(body.text).toContain("#booking-")
  })

  it("sendPixPaymentMessage envia detalhes de pagamento e código copia e cola", async () => {
    await sendPixPaymentMessage(
      "5511999998888",
      "booking-11223344",
      180,
      "00020126580014BR.GOV.BCB.PIX...",
    )

    const [, opts] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.text).toContain("Pagamento PIX")
    expect(body.text).toContain("R$ 180.00")
    expect(body.text).toContain("00020126580014BR.GOV.BCB.PIX...")
  })

  it("sendServiceCompletionRequest e sendReviewRequest enviam mensagens interativas", async () => {
    await sendServiceCompletionRequest("5511999998888", "booking-1234", "Roberto Marcenaria")
    await sendReviewRequest("5511999998888", "booking-1234", "Roberto Marcenaria")

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    const [, opts1] = (globalThis.fetch as any).mock.calls[0]
    const [, opts2] = (globalThis.fetch as any).mock.calls[1]

    expect(JSON.parse(opts1.body).text).toContain("*Roberto Marcenaria* marcou o serviço")
    expect(JSON.parse(opts2.body).text).toContain("Como foi o atendimento com Roberto Marcenaria?")
  })

  it("sendText lança erro se EVOLUTION_API_KEY ou EVOLUTION_API_URL não estiver configurada", async () => {
    vi.stubEnv("EVOLUTION_API_KEY", "")

    await expect(sendText("5511999998888", "Mensagem")).rejects.toThrow(
      /Evolution API não configurada/,
    )
  })
})
