import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  startQuoteWizard,
  getWizardSession,
  saveWizardSession,
  clearWizardSession,
  processQuoteWizardMessage,
  findOrCreateClientUser,
  finalizeQuoteCreation,
} from "../whatsapp-quote-wizard"
import { db } from "@/lib/db"
import { enqueueWhatsApp } from "@/lib/whatsapp-queue"
import { notifyNewQuote } from "@/lib/notifications"

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    category: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    service: {
      findFirst: vi.fn(),
    },
    quoteRequest: {
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/whatsapp-queue", () => ({
  enqueueWhatsApp: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/notifications", () => ({
  notifyNewQuote: vi.fn().mockResolvedValue(undefined),
}))

const sessionStore = new Map<string, string>()

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn(async (key: string) => {
    const val = sessionStore.get(key)
    return val ? JSON.parse(val) : null
  }),
  cacheSet: vi.fn(async (key: string, val: unknown) => {
    sessionStore.set(key, JSON.stringify(val))
  }),
  cacheInvalidate: vi.fn(async (key: string) => {
    sessionStore.delete(key)
  }),
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

describe("WhatsApp Quote Wizard (Solicitação 100% no Chat)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStore.clear()
  })

  it("inicia o wizard de orçamento e salva o estado inicial no cache", async () => {
    const text = await startQuoteWizard(
      "5533999112233",
      "user-1",
      "Carlos",
      "eletrica",
      "Eletricista",
    )

    expect(text).toContain("Carlos")
    expect(text).toContain("Eletricista")
    expect(text).toContain("O que você precisa que seja feito?")

    const session = await getWizardSession("5533999112233")
    expect(session).not.toBeNull()
    expect(session?.step).toBe("AWAITING_DESCRIPTION")
    expect(session?.categorySlug).toBe("eletrica")
  })

  it("permite cancelar o wizard digitando CANCELAR", async () => {
    await startQuoteWizard("5533999112233")
    const res = await processQuoteWizardMessage({
      phone: "5533999112233",
      text: "cancelar",
    })

    expect(res.handled).toBe(true)
    expect(res.replyText).toContain("cancelada")
    expect(await getWizardSession("5533999112233")).toBeNull()
  })

  it("no passo AWAITING_DESCRIPTION, se o usuário não informa o bairro, pergunta o bairro de GV", async () => {
    await startQuoteWizard("5533999112233")

    const res = await processQuoteWizardMessage({
      phone: "5533999112233",
      text: "Preciso trocar a resistência do chuveiro queimada",
    })

    expect(res.handled).toBe(true)
    expect(res.replyText).toContain("Em qual bairro de Governador Valadares")

    const session = await getWizardSession("5533999112233")
    expect(session?.step).toBe("AWAITING_NEIGHBORHOOD")
    expect(session?.description).toBe("Preciso trocar a resistência do chuveiro queimada")
  })

  it("no passo AWAITING_DESCRIPTION, se o usuário já informa o bairro no texto, cria o QuoteRequest direto", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValueOnce({
      id: "client-1",
      name: "João",
      role: "CLIENT",
      email: "joao@example.com",
      whatsapp: "5533999112233",
      cpfCnpj: "12345678901",
    } as any)

    vi.mocked(db.category.findUnique).mockResolvedValueOnce({
      id: "cat-eletrica",
      name: "Eletricista",
      slug: "eletrica",
    } as any)

    vi.mocked(db.service.findFirst).mockResolvedValueOnce({
      id: "srv-1",
      title: "Instalação Elétrica e Chuveiro",
      provider: {
        id: "prov-1",
        name: "Marcio Eletricista",
        whatsapp: "5533988887777",
      },
    } as any)

    vi.mocked(db.quoteRequest.create).mockResolvedValueOnce({
      id: "quote-12345678",
      clientId: "client-1",
      providerId: "prov-1",
      status: "PENDING",
      address: "Ilha dos Araújos, Gov. Valadares - MG",
      items: [{ id: "item-1" }],
      provider: { id: "prov-1", name: "Marcio Eletricista", whatsapp: "5533988887777" },
    } as any)

    await startQuoteWizard("5533999112233")

    const res = await processQuoteWizardMessage({
      phone: "5533999112233",
      text: "Trocar chuveiro queimado na Ilha dos Araújos",
    })

    expect(res.handled).toBe(true)
    expect(res.replyText).toContain("Pedido de Orçamento Criado com Sucesso!")
    expect(res.replyText).toContain("#quote-12")
    expect(res.replyText).toContain("Ilha dos Araújos")
    expect(res.replyText).toContain("Marcio Eletricista")
    expect(notifyNewQuote).toHaveBeenCalled()
    expect(await getWizardSession("5533999112233")).toBeNull()
  })

  it("completa a solicitação com sucesso no passo AWAITING_NEIGHBORHOOD", async () => {
    await saveWizardSession({
      phone: "5533999112233",
      step: "AWAITING_NEIGHBORHOOD",
      description: "Vazamento na caixa d'água",
      categorySlug: "hidraulica",
      startedAt: Date.now(),
    })

    vi.mocked(db.user.findFirst).mockResolvedValueOnce(null)
    vi.mocked(db.user.create).mockResolvedValueOnce({
      id: "client-new",
      name: "Cliente WhatsApp",
      role: "CLIENT",
      email: "wa_5533999112233@severinno.local",
      whatsapp: "5533999112233",
      cpfCnpj: null,
    } as any)

    vi.mocked(db.category.findUnique).mockResolvedValueOnce({
      id: "cat-hidro",
      name: "Hidráulica",
      slug: "hidraulica",
    } as any)

    vi.mocked(db.service.findFirst).mockResolvedValueOnce({
      id: "srv-hidro",
      title: "Reparo Hidráulico e Encanamento",
      provider: {
        id: "prov-2",
        name: "Pedro Encanador",
        whatsapp: "5533999990000",
      },
    } as any)

    vi.mocked(db.quoteRequest.create).mockResolvedValueOnce({
      id: "quote-87654321",
      clientId: "client-new",
      providerId: "prov-2",
      status: "PENDING",
      address: "Vila Bretas, Gov. Valadares - MG",
      items: [{ id: "item-2" }],
      provider: { id: "prov-2", name: "Pedro Encanador", whatsapp: "5533999990000" },
    } as any)

    const res = await processQuoteWizardMessage({
      phone: "5533999112233",
      text: "Vila Bretas",
    })

    expect(res.handled).toBe(true)
    expect(res.replyText).toContain("Pedido de Orçamento Criado com Sucesso!")
    expect(res.replyText).toContain("#quote-87")
    expect(res.replyText).toContain("Pedro Encanador")
    expect(enqueueWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "5533999112233",
        context: "wizard:created:quote-87654321",
      }),
    )
  })
})
