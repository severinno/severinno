import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  getDayBounds,
  formatCurrencyBrl,
  buildMorningBriefing,
  sendMorningBriefingToProvider,
  dispatchAllMorningBriefings,
} from "../whatsapp-morning-briefing"

vi.mock("@/lib/logger", () => {
  const instance: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => instance),
  }
  return { default: instance, logger: instance }
})

const { mockDb, mockSendWhatsApp } = vi.hoisted(() => ({
  mockDb: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
    },
  },
  mockSendWhatsApp: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/db", () => ({
  default: mockDb,
  db: mockDb,
}))

vi.mock("@/lib/whatsapp", () => ({
  sendWhatsApp: mockSendWhatsApp,
}))

describe("whatsapp-morning-briefing — Resumo Matinal da Agenda", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calcula corretamente os limites de início e fim do dia", () => {
    const d = new Date("2026-10-16T12:00:00Z")
    const { startOfDay, endOfDay } = getDayBounds(d)

    expect(startOfDay.getHours()).toBe(0)
    expect(startOfDay.getMinutes()).toBe(0)
    expect(endOfDay.getHours()).toBe(23)
    expect(endOfDay.getMinutes()).toBe(59)
  })

  it("formata valores para moeda BRL corretamente", () => {
    expect(formatCurrencyBrl(150.5)).toBe("R$ 150,50")
    expect(formatCurrencyBrl(0)).toBe("R$ 0,00")
    expect(formatCurrencyBrl(1250.75)).toBe("R$ 1250,75")
  })

  it("constrói dados do briefing com dedução da taxa de 15% e links de rota", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "prov-1",
      name: "João Eletricista",
      whatsapp: "33999990001",
      role: "PROVIDER",
      active: true,
    })

    const targetDate = new Date("2026-10-16T10:00:00")
    mockDb.booking.findMany.mockResolvedValue([
      {
        id: "b-1",
        scheduledAt: new Date("2026-10-16T09:00:00"),
        amount: 200,
        address: "Rua Israel Pinheiro, 100 - Centro",
        lat: -18.851,
        lng: -41.945,
        client: { name: "Maria Silva", phone: "33988880001" },
        service: { title: "Troca de Fiação", basePrice: 200 },
      },
      {
        id: "b-2",
        scheduledAt: new Date("2026-10-16T14:30:00"),
        amount: 100,
        address: "Av. Minas Gerais, 500 - Grã-Duquesa",
        lat: -18.835,
        lng: -41.955,
        client: { name: "Carlos Oliveira", phone: "33988880002" },
        service: { title: "Instalação de Tomada", basePrice: 100 },
      },
    ])

    const briefing = await buildMorningBriefing("prov-1", targetDate)

    expect(briefing).not.toBeNull()
    expect(briefing?.providerName).toBe("João Eletricista")
    expect(briefing?.bookings).toHaveLength(2)

    // Preços brutos e líquidos (taxa 15%)
    // b-1: 200 * 0.85 = 170
    // b-2: 100 * 0.85 = 85
    // Total bruto: 300, Total líquido: 255
    expect(briefing?.totalGross).toBe(300)
    expect(briefing?.totalNet).toBe(255)

    // Verifica links de navegação
    expect(briefing?.bookings[0].wazeUrl).toContain("waze.com/ul?ll=-18.851,-41.945")
    expect(briefing?.bookings[0].googleMapsUrl).toContain(
      "maps/dir/?api=1&destination=-18.851,-41.945",
    )

    // Mensagem consolidada contém o nome e valor líquido
    expect(briefing?.messageText).toContain("João Eletricista")
    expect(briefing?.messageText).toContain("R$ 255,00")
    expect(briefing?.messageText).toContain("Maria Silva")
    expect(briefing?.messageText).toContain("Escrow Seguro")
  })

  it("retorna null se o prestador não tiver reservas agendadas", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "prov-2",
      name: "Ana Pintora",
      role: "PROVIDER",
      active: true,
    })
    mockDb.booking.findMany.mockResolvedValue([])

    const briefing = await buildMorningBriefing("prov-2")
    expect(briefing).toBeNull()
  })

  it("envia briefing via WhatsApp para prestador com sucesso", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "prov-1",
      name: "João",
      whatsapp: "33999990001",
      role: "PROVIDER",
      active: true,
    })
    mockDb.booking.findMany.mockResolvedValue([
      {
        id: "b-1",
        scheduledAt: new Date(),
        amount: 150,
        address: "Rua A",
        lat: -18.85,
        lng: -41.95,
        client: { name: "Cliente 1" },
        service: { title: "Reparo" },
      },
    ])

    const res = await sendMorningBriefingToProvider("prov-1")
    expect(res.sent).toBe(true)
    expect(mockSendWhatsApp).toHaveBeenCalledTimes(1)
  })

  it("executa despacho em lote para todos os prestadores ativos", async () => {
    mockDb.booking.findMany.mockResolvedValueOnce([{ providerId: "p-1" }, { providerId: "p-2" }])

    // Mock individual briefings
    mockDb.user.findUnique
      .mockResolvedValueOnce({
        id: "p-1",
        name: "P1",
        whatsapp: "111",
        role: "PROVIDER",
        active: true,
      })
      .mockResolvedValueOnce({
        id: "p-1",
        name: "P1",
        whatsapp: "111",
        role: "PROVIDER",
        active: true,
      })
      .mockResolvedValueOnce({
        id: "p-2",
        name: "P2",
        whatsapp: "222",
        role: "PROVIDER",
        active: true,
      })
      .mockResolvedValueOnce({
        id: "p-2",
        name: "P2",
        whatsapp: "222",
        role: "PROVIDER",
        active: true,
      })

    mockDb.booking.findMany.mockResolvedValue([
      {
        id: "b-1",
        scheduledAt: new Date(),
        amount: 100,
        address: "Rua X",
        client: { name: "C1" },
        service: { title: "S1" },
      },
    ])

    const result = await dispatchAllMorningBriefings()
    expect(result.totalProviders).toBe(2)
    expect(result.briefingsSent).toBe(2)
    expect(result.briefingsFailed).toBe(0)
  })
})
