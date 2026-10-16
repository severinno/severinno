import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  matchRecurrenceRule,
  formatRebookingInvitation,
  identifyDueServiceReminders,
  type ServiceReminderCandidate,
} from "@/lib/smart-service-reminders"
import { db } from "@/lib/db"

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
    },
  },
}))

describe("smart-service-reminders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("identifica corretamente regras de recorrência por palavras-chave", () => {
    const airRule = matchRecurrenceRule("Limpeza e Higienização de Ar-Condicionado Split")
    expect(airRule).not.toBeNull()
    expect(airRule?.intervalDays).toBe(180)
    expect(airRule?.couponCode).toBe("ARPURO10")

    const pestRule = matchRecurrenceRule("Dedetização e Controle de Pragas")
    expect(pestRule).not.toBeNull()
    expect(pestRule?.intervalDays).toBe(180)

    const cleanRule = matchRecurrenceRule("Serviço de Diarista para Apartamento")
    expect(cleanRule).not.toBeNull()
    expect(cleanRule?.intervalDays).toBe(14)

    const unknownRule = matchRecurrenceRule("Conserto de Drone")
    expect(unknownRule).toBeNull()
  })

  it("formata mensagem amigável de WhatsApp com deep link e cupom", () => {
    const candidate: ServiceReminderCandidate = {
      bookingId: "b-1",
      clientId: "c-1",
      clientName: "Mariana Souza",
      clientPhone: "33988887777",
      providerId: "p-1",
      providerName: "Roberto Eletricista",
      providerSlug: "roberto-eletricista",
      serviceId: "s-1",
      serviceTitle: "Revisão Elétrica do Quadro",
      completedAt: new Date("2025-10-16T10:00:00Z"),
      daysSinceCompleted: 365,
      rule: {
        categoryMatch: ["eletrica"],
        intervalDays: 365,
        title: "Revisão Elétrica Preventiva",
        friendlyReason: "Evita sobrecargas.",
        couponDiscountPct: 15,
        couponCode: "SEGURANCA15",
      },
    }

    const { message, rebookingUrl } = formatRebookingInvitation(candidate)

    expect(message).toContain("Mariana")
    expect(message).toContain("Roberto Eletricista")
    expect(message).toContain("15% OFF")
    expect(message).toContain("SEGURANCA15")
    expect(rebookingUrl).toBe(
      "https://severinno.com.br/u/roberto-eletricista?service=s-1&cupom=SEGURANCA15",
    )
  })

  it("filtra reservas que atingiram o período exato de retorno preventivo", async () => {
    const now = new Date("2026-10-16T12:00:00Z")
    const due185DaysAgo = new Date(now.getTime() - 185 * 24 * 60 * 60 * 1000)
    const recent20DaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000)

    vi.mocked(db.booking.findMany).mockResolvedValueOnce([
      {
        id: "b-due",
        clientId: "c-1",
        scheduledAt: due185DaysAgo,
        createdAt: due185DaysAgo,
        client: { id: "c-1", name: "Lucas Lima", phone: "33999991111", whatsapp: "33999991111" },
        provider: { id: "p-1", name: "Refrigeração GV", slug: "refrigeracao-gv" },
        service: { id: "s-1", title: "Limpeza de Ar-Condicionado 12000 BTUs" },
      },
      {
        id: "b-recent",
        clientId: "c-2",
        scheduledAt: recent20DaysAgo,
        createdAt: recent20DaysAgo,
        client: { id: "c-2", name: "Ana Paula", phone: "33999992222", whatsapp: "33999992222" },
        provider: { id: "p-2", name: "Ar Clima", slug: "ar-clima" },
        service: { id: "s-2", title: "Limpeza de Ar-Condicionado 9000 BTUs" },
      },
    ] as any)

    const candidates = await identifyDueServiceReminders(now)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].bookingId).toBe("b-due")
    expect(candidates[0].daysSinceCompleted).toBe(185)
    expect(candidates[0].rule.couponCode).toBe("ARPURO10")
  })
})
