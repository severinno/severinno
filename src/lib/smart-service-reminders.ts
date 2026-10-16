import { db } from "@/lib/db"

export interface ServiceRecurrenceRule {
  categoryMatch: string[]
  intervalDays: number
  title: string
  friendlyReason: string
  couponDiscountPct: number
  couponCode: string
}

export const SERVICE_RECURRENCE_RULES: ServiceRecurrenceRule[] = [
  {
    categoryMatch: ["ar-condicionado", "climatizacao", "ar condicionado"],
    intervalDays: 180,
    title: "Higienização de Ar-Condicionado",
    friendlyReason:
      "Já faz 6 meses desde a última limpeza. Manter os filtros higienizados evita fungos, melhora o consumo e garante ar puro.",
    couponDiscountPct: 10,
    couponCode: "ARPURO10",
  },
  {
    categoryMatch: ["dedetizacao", "desinsetizacao", "pragas"],
    intervalDays: 180,
    title: "Reforço Preventivo de Dedetização",
    friendlyReason:
      "A garantia de 6 meses da dedetização está próxima do vencimento. A aplicação preventiva garante a casa livre de insetos e baratas.",
    couponDiscountPct: 10,
    couponCode: "PROTECAO10",
  },
  {
    categoryMatch: ["eletrica", "quadro", "disjuntor", "fiacao"],
    intervalDays: 365,
    title: "Revisão Elétrica Preventiva",
    friendlyReason:
      "Faz 1 ano da sua última manutenção elétrica. Uma checagem anual evita sobrecargas, queima de aparelhos e curto-circuitos.",
    couponDiscountPct: 15,
    couponCode: "SEGURANCA15",
  },
  {
    categoryMatch: ["diarista", "faxina", "limpeza"],
    intervalDays: 14,
    title: "Faxina Residencial Quinzenal",
    friendlyReason:
      "Sua casa já está pronta para o próximo ciclo de limpeza com o mesmo profissional de sua confiança.",
    couponDiscountPct: 5,
    couponCode: "CASA10",
  },
  {
    categoryMatch: ["calha", "telhado", "infiltracao"],
    intervalDays: 180,
    title: "Limpeza de Calhas e Telhados",
    friendlyReason:
      "Manter as calhas desobstruídas antes da temporada de chuvas em Governador Valadares evita vazamentos e goteiras.",
    couponDiscountPct: 10,
    couponCode: "TELHADO10",
  },
]

export interface ServiceReminderCandidate {
  bookingId: string
  clientId: string
  clientName: string
  clientPhone: string
  providerId: string
  providerName: string
  providerSlug: string
  serviceId: string
  serviceTitle: string
  completedAt: Date
  daysSinceCompleted: number
  rule: ServiceRecurrenceRule
}

/**
 * Encontra a regra de recorrência compatível com o título ou categoria do serviço.
 */
export function matchRecurrenceRule(title: string): ServiceRecurrenceRule | null {
  const normalized = title.toLowerCase()
  return (
    SERVICE_RECURRENCE_RULES.find((rule) =>
      rule.categoryMatch.some((keyword) => normalized.includes(keyword)),
    ) || null
  )
}

/**
 * Monta o texto de convite para WhatsApp e URL de 1 clique para reagendamento.
 */
export function formatRebookingInvitation(candidate: ServiceReminderCandidate): {
  message: string
  rebookingUrl: string
} {
  const firstName = candidate.clientName.split(" ")[0] || "Cliente"
  const rebookingUrl = `https://severinno.com.br/u/${candidate.providerSlug}?service=${candidate.serviceId}&cupom=${candidate.rule.couponCode}`

  const message = [
    `Olá, *${firstName}*! Tudo bem? Aqui é do time *Severinno*. ⚡`,
    ``,
    `Notamos que faz cerca de *${candidate.daysSinceCompleted} dias* que o profissional *${candidate.providerName}* realizou o serviço de *${candidate.serviceTitle}* para você.`,
    ``,
    `💡 *Dica Preventiva:* ${candidate.rule.friendlyReason}`,
    ``,
    `Preparamos um cupom exclusivo de *${candidate.rule.couponDiscountPct}% OFF* (*${candidate.rule.couponCode}*) para você reagendar diretamente com o *${candidate.providerName}*:`,
    `👉 ${rebookingUrl}`,
    ``,
    `_Pagamento 100% seguro com custódia garantida no app._`,
  ].join("\n")

  return { message, rebookingUrl }
}

/**
 * Varre agendamentos concluídos que atingiram o ciclo de manutenção preventiva.
 */
export async function identifyDueServiceReminders(
  now: Date = new Date(),
): Promise<ServiceReminderCandidate[]> {
  const candidates: ServiceReminderCandidate[] = []

  try {
    // Busca últimos 200 bookings concluídos
    const bookings = await db.booking.findMany({
      where: {
        status: "COMPLETED",
      },
      select: {
        id: true,
        clientId: true,
        scheduledAt: true,
        createdAt: true,
        client: {
          select: {
            id: true,
            name: true,
            phone: true,
            whatsapp: true,
          },
        },
        provider: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        service: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: { scheduledAt: "desc" },
      take: 200,
    })

    for (const b of bookings) {
      if (!b.service || !b.client || !b.provider) continue

      const rule = matchRecurrenceRule(b.service.title)
      if (!rule) continue

      const completedAt = b.scheduledAt || b.createdAt
      const diffMs = now.getTime() - new Date(completedAt).getTime()
      const daysSince = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      // Dispara se o prazo atingiu ou ultrapassou a janela (com folga de 15 dias)
      if (daysSince >= rule.intervalDays && daysSince <= rule.intervalDays + 30) {
        const phone = b.client.whatsapp || b.client.phone
        if (!phone) continue

        candidates.push({
          bookingId: b.id,
          clientId: b.client.id,
          clientName: b.client.name,
          clientPhone: phone,
          providerId: b.provider.id,
          providerName: b.provider.name,
          providerSlug: b.provider.slug || b.provider.id,
          serviceId: b.service.id,
          serviceTitle: b.service.title,
          completedAt: new Date(completedAt),
          daysSinceCompleted: daysSince,
          rule,
        })
      }
    }
  } catch {
    // Fallback se DB offline ou mockado
  }

  return candidates
}
