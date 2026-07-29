// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockDb, mockLogger } = vi.hoisted(() => {
  const db = {
    user: {
      findUnique: vi.fn(),
    },
  }
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return { mockDb: db, mockLogger: logger }
})

vi.mock("@/lib/logger", () => ({
  default: mockLogger,
  logger: mockLogger,
}))

vi.mock("@/lib/db", () => ({
  db: mockDb,
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { sendWhatsApp, sendWhatsAppToMany } from "../whatsapp"
import logger from "../logger"

// ── Helpers ────────────────────────────────────────────────────────────────

function mockFetch(response: Partial<Response>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(""),
    json: vi.fn().mockResolvedValue({}),
    ...response,
  })
}

// ===========================================================================
// sendWhatsApp
// ===========================================================================

describe("sendWhatsApp", () => {
  const OLD_ENV = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("WHATSAPP_API_URL", "http://localhost:8080")
    vi.stubEnv("WHATSAPP_API_KEY", "test-key")
    globalThis.fetch = mockFetch({})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("envia mensagem WhatsApp quando usuário tem telefone cadastrado", async () => {
    mockDb.user.findUnique.mockResolvedValue({ whatsapp: "11999999999" })
    globalThis.fetch = mockFetch({ ok: true, status: 200 })

    await sendWhatsApp({
      userId: "user-1",
      title: "Novo serviço agendado",
      body: "Carlos agendou para amanhã às 14h.",
      url: "/?view=provider.bookings",
    })

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [url, opts] = (globalThis.fetch as any).mock.calls[0]
    expect(url).toContain("/message/send/severinno")

    const body = JSON.parse(opts.body)
    expect(body.number).toBe("5511999999999") // DDI 55 added
    expect(body.text).toContain("Novo serviço agendado")
    expect(body.text).toContain("Carlos agendou")
    expect(body.text).toContain("/?view=provider.bookings")

    expect(opts.headers.apikey).toBe("test-key")
  })

  it("pula envio quando WHATSAPP_API_KEY não está configurada", async () => {
    vi.stubEnv("WHATSAPP_API_KEY", "")

    await sendWhatsApp({
      userId: "user-1",
      title: "Teste",
    })

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      "WHATSAPP_API_URL/KEY not configured — whatsapp notifications disabled",
    )
  })

  it("pula envio quando usuário não tem WhatsApp cadastrado", async () => {
    mockDb.user.findUnique.mockResolvedValue({ whatsapp: null })

    await sendWhatsApp({
      userId: "user-2",
      title: "Teste",
    })

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("pula envio quando usuário não é encontrado no DB", async () => {
    mockDb.user.findUnique.mockResolvedValue(null)

    await sendWhatsApp({
      userId: "nonexistent",
      title: "Teste",
    })

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("adiciona DDI 55 quando número não tem DDI", async () => {
    mockDb.user.findUnique.mockResolvedValue({ whatsapp: "11999999999" })
    globalThis.fetch = mockFetch({ ok: true })

    await sendWhatsApp({ userId: "user-1", title: "Teste" })

    const [, opts] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.number).toBe("5511999999999")
  })

  it("mantém DDI 55 quando número já tem DDI", async () => {
    mockDb.user.findUnique.mockResolvedValue({ whatsapp: "5511999999999" })
    globalThis.fetch = mockFetch({ ok: true })

    await sendWhatsApp({ userId: "user-1", title: "Teste" })

    const [, opts] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.number).toBe("5511999999999")
  })

  it("remove caracteres não-dígitos do telefone", async () => {
    mockDb.user.findUnique.mockResolvedValue({ whatsapp: "(11) 99999-9999" })
    globalThis.fetch = mockFetch({ ok: true })

    await sendWhatsApp({ userId: "user-1", title: "Teste" })

    const [, opts] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.number).toBe("5511999999999")
  })

  it("loga warning quando Evolution API retorna erro", async () => {
    mockDb.user.findUnique.mockResolvedValue({ whatsapp: "11999999999" })
    globalThis.fetch = mockFetch({ ok: false, status: 401, text: vi.fn().mockResolvedValue("Unauthorized") })

    await sendWhatsApp({ userId: "user-1", title: "Teste" })

    expect(logger.warn).toHaveBeenCalled()
  })

  it("loga warning quando fetch lança exceção de rede", async () => {
    mockDb.user.findUnique.mockResolvedValue({ whatsapp: "11999999999" })
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))

    await sendWhatsApp({ userId: "user-1", title: "Teste" })

    expect(logger.warn).toHaveBeenCalled()
  })

  it("envia mensagem sem body (apenas título)", async () => {
    mockDb.user.findUnique.mockResolvedValue({ whatsapp: "11999999999" })
    globalThis.fetch = mockFetch({ ok: true })

    await sendWhatsApp({ userId: "user-1", title: "Notificação importante" })

    const [, opts] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.text).toBe("*Notificação importante*")
  })

  it("envia mensagem com URL deep link", async () => {
    mockDb.user.findUnique.mockResolvedValue({ whatsapp: "11999999999" })
    globalThis.fetch = mockFetch({ ok: true })

    await sendWhatsApp({
      userId: "user-1",
      title: "Novo orçamento",
      body: "Você recebeu uma proposta.",
      url: "/?view=client.quotes",
    })

    const [, opts] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.text).toContain("Novo orçamento")
    expect(body.text).toContain("Você recebeu uma proposta.")
    expect(body.text).toContain("🔗")
    expect(body.text).toContain("/?view=client.quotes")
  })
})

// ===========================================================================
// sendWhatsAppToMany
// ===========================================================================

describe("sendWhatsAppToMany", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("WHATSAPP_API_URL", "http://localhost:8080")
    vi.stubEnv("WHATSAPP_API_KEY", "test-key")
    globalThis.fetch = mockFetch({})
    mockDb.user.findUnique.mockResolvedValue({ whatsapp: "11999999999" })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("envia para múltiplos usuários em paralelo", async () => {
    await sendWhatsAppToMany([
      { userId: "user-1", title: "Notif 1" },
      { userId: "user-2", title: "Notif 2" },
    ])

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it("não quebra se um dos envios falhar", async () => {
    mockDb.user.findUnique
      .mockResolvedValueOnce({ whatsapp: "11999999999" })
      .mockResolvedValueOnce(null) // second user has no WhatsApp

    await expect(
      sendWhatsAppToMany([
        { userId: "user-1", title: "Notif 1" },
        { userId: "user-2", title: "Notif 2" },
      ]),
    ).resolves.not.toThrow()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it("funciona com array vazio", async () => {
    await sendWhatsAppToMany([])
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
