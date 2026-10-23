import { db } from "@/lib/db"
import { getClient } from "@/lib/redis"
import { notifyServiceReminder } from "@/lib/notifications"

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
    categoryMatch: ["dedetizacao", "desinsetizacao", "pragas", "cupim"],
    intervalDays: 180,
    title: "Reforço Preventivo de Dedetização",
    friendlyReason:
      "A garantia de 6 meses da dedetização está próxima do vencimento. A aplicação preventiva garante a casa livre de insetos e baratas.",
    couponDiscountPct: 10,
    couponCode: "PROTECAO10",
  },
  {
    categoryMatch: ["eletrica", "quadro", "disjuntor", "fiacao", "eletricista"],
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
    categoryMatch: ["calha", "telhado", "infiltracao", "calheiro"],
    intervalDays: 180,
    title: "Limpeza de Calhas e Telhados",
    friendlyReason:
      "Manter as calhas desobstruídas antes da temporada de chuvas em Governador Valadares evita vazamentos e goteiras.",
    couponDiscountPct: 10,
    couponCode: "TELHADO10",
  },
  {
    categoryMatch: ["pintura", "pintor", "massa corrida", "textura"],
    intervalDays: 365,
    title: "Renovação e Retoque de Pintura",
    friendlyReason:
      "Faz 1 ano da sua última pintura. Que tal retocar rodapés, portas ou renovar um ambiente com seu profissional de confiança?",
    couponDiscountPct: 10,
    couponCode: "PINTURA10",
  },
  {
    categoryMatch: ["marcenaria", "marceneiro", "armario", "gaveta"],
    intervalDays: 180,
    title: "Revisão de Marcenaria e Móveis Planejados",
    friendlyReason:
      "Revisão preventiva de dobradiças, trilhos telescópicos e ajustes de portas em armários e gavetas.",
    couponDiscountPct: 10,
    couponCode: "MOVEL10",
  },
  {
    categoryMatch: ["vidro", "vidraceiro", "box", "espelho"],
    intervalDays: 365,
    title: "Manutenção Preventiva de Box e Vidros",
    friendlyReason:
      "Checagem de roldanas, guias e vedação de silicone para garantir a segurança da sua família no banheiro.",
    couponDiscountPct: 10,
    couponCode: "VIDRO10",
  },
  {
    categoryMatch: ["serralheria", "serralheiro", "portao", "grade"],
    intervalDays: 180,
    title: "Lubrificação e Alinhamento de Portões",
    friendlyReason:
      "Manutenção preventiva de motores, trilhos e travas de segurança para evitar travamentos de portão.",
    couponDiscountPct: 10,
    couponCode: "PORTAO10",
  },
  {
    categoryMatch: ["gesso", "gesseiro", "drywall", "sanca"],
    intervalDays: 365,
    title: "Inspeção de Gesso e Drywall",
    friendlyReason:
      "Inspeção anual preventiva de forros, sancas e iluminação embutida contra fissuras e trincas térmicas.",
    couponDiscountPct: 10,
    couponCode: "GESSO10",
  },
  {
    categoryMatch: ["desentupidora", "desentupimento", "ralo", "esgoto"],
    intervalDays: 180,
    title: "Limpeza Preventiva de Encanamento e Ralos",
    friendlyReason:
      "Higienização e desobstrução preventiva de caixas de gordura e sifões para evitar mau cheiro e refluxo.",
    couponDiscountPct: 10,
    couponCode: "LIMPEZA10",
  },
  {
    categoryMatch: ["estofado", "estofador", "sofa", "colchao", "impermeabilizacao"],
    intervalDays: 90,
    title: "Higienização Trimestral de Estofados",
    friendlyReason:
      "Higienização profunda para eliminação de ácaros, fungos e bactérias do seu sofá e colchão.",
    couponDiscountPct: 10,
    couponCode: "ESTOFADO10",
  },
  {
    categoryMatch: ["encanador", "hidraulica", "vazamento", "tubulacao", "sifao"],
    intervalDays: 180,
    title: "Revisão Hidráulica Preventiva",
    friendlyReason:
      "Checagem de registros, sifões e torneiras para evitar desperdício de água e infiltrações silenciosas.",
    couponDiscountPct: 10,
    couponCode: "HIDRO10",
  },
  {
    categoryMatch: ["marido de aluguel", "pequenos reparos", "reparos"],
    intervalDays: 60,
    title: "Check-up Residencial de Pequenos Reparos",
    friendlyReason:
      "Hora de resolver aqueles pequenos ajustes e instalações pendentes em casa com praticidade.",
    couponDiscountPct: 10,
    couponCode: "REPARO10",
  },
  {
    categoryMatch: ["jardineiro", "jardinagem", "poda", "grama"],
    intervalDays: 30,
    title: "Manutenção Mensal de Jardim",
    friendlyReason:
      "Corte do gramado, poda ornamental e adubação para manter o jardim sempre verde e harmonioso.",
    couponDiscountPct: 10,
    couponCode: "JARDIM10",
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

export interface ServiceReminderDispatchOptions {
  now?: Date
  dryRun?: boolean
  limit?: number
}

export interface ServiceReminderDispatchResult {
  totalEligible: number
  sentWhatsApp: number
  sentPush: number
  skippedDedup: number
  failed: number
  details: {
    bookingId: string
    clientId: string
    clientName: string
    serviceTitle: string
    providerName: string
    whatsAppSent: boolean
    pushSent: boolean
    skippedReason?: string
  }[]
}

/**
 * Dispara notificações ativas de retenção e retorno de serviços (WhatsApp + Push + In-App).
 * Aplica deduplicação rigorosa via Redis com TTL de 30 dias para impedir qualquer disparo repetido.
 */
export async function dispatchServiceReminders(
  options: ServiceReminderDispatchOptions = {},
): Promise<ServiceReminderDispatchResult> {
  const { now = new Date(), dryRun = false, limit = 50 } = options
  const candidates = await identifyDueServiceReminders(now)
  const sliced = candidates.slice(0, limit)

  let sentWhatsApp = 0
  let sentPush = 0
  let skippedDedup = 0
  let failed = 0

  const details: ServiceReminderDispatchResult["details"] = []
  const redisClient = getClient()

  for (const candidate of sliced) {
    if (dryRun) {
      details.push({
        bookingId: candidate.bookingId,
        clientId: candidate.clientId,
        clientName: candidate.clientName,
        serviceTitle: candidate.serviceTitle,
        providerName: candidate.providerName,
        whatsAppSent: false,
        pushSent: false,
        skippedReason: "DRY_RUN",
      })
      continue
    }

    const dedupKey = `reminder:sent:${candidate.bookingId}:${candidate.rule.couponCode}`

    if (redisClient) {
      try {
        const acquired = await redisClient.set(dedupKey, "1", "EX", 86400 * 30, "NX")
        if (!acquired) {
          skippedDedup++
          details.push({
            bookingId: candidate.bookingId,
            clientId: candidate.clientId,
            clientName: candidate.clientName,
            serviceTitle: candidate.serviceTitle,
            providerName: candidate.providerName,
            whatsAppSent: false,
            pushSent: false,
            skippedReason: "DEDUPLICATED",
          })
          continue
        }
      } catch {
        // Fallback se Redis indisponível: prossegue sem bloquear
      }
    }

    try {
      const { message, rebookingUrl } = formatRebookingInvitation(candidate)
      const res = await notifyServiceReminder(
        candidate.clientId,
        candidate.serviceTitle,
        candidate.providerName,
        candidate.rule.friendlyReason,
        message,
        rebookingUrl,
      )

      if (res.whatsapp) sentWhatsApp++
      if (res.push) sentPush++

      details.push({
        bookingId: candidate.bookingId,
        clientId: candidate.clientId,
        clientName: candidate.clientName,
        serviceTitle: candidate.serviceTitle,
        providerName: candidate.providerName,
        whatsAppSent: res.whatsapp,
        pushSent: res.push,
      })
    } catch {
      failed++
      details.push({
        bookingId: candidate.bookingId,
        clientId: candidate.clientId,
        clientName: candidate.clientName,
        serviceTitle: candidate.serviceTitle,
        providerName: candidate.providerName,
        whatsAppSent: false,
        pushSent: false,
        skippedReason: "ERROR",
      })
    }
  }

  return {
    totalEligible: candidates.length,
    sentWhatsApp,
    sentPush,
    skippedDedup,
    failed,
    details,
  }
}
