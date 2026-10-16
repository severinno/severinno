/**
 * whatsapp-morning-briefing.ts — Resumo Matinal da Agenda para Prestadores
 *
 * Executado diariamente (ex: às 07:30 da manhã) para consolidar os compromissos
 * do dia de cada prestador ativo, calcular previsão líquida de recebimento (85%
 * após taxa de 15% da plataforma) e fornecer links rápidos de rota (Waze e Google Maps).
 */

import "server-only"
import { db } from "@/lib/db"
import logger from "@/lib/logger"
import { sendWhatsApp } from "@/lib/whatsapp"
import { toMoneyNumber } from "@/lib/money"
import { FEE_RATE } from "@/lib/constants"

export interface BriefingBookingItem {
  id: string
  timeFormatted: string
  serviceTitle: string
  clientName: string
  address: string
  lat?: number | null
  lng?: number | null
  price: number
  netAmount: number
  wazeUrl?: string
  googleMapsUrl?: string
}

export interface ProviderBriefingData {
  providerId: string
  providerName: string
  providerPhone: string | null
  dateFormatted: string
  bookings: BriefingBookingItem[]
  totalGross: number
  totalNet: number
  messageText: string
}

export interface MorningBriefingRunResult {
  totalProviders: number
  briefingsSent: number
  briefingsSkipped: number
  briefingsFailed: number
  totalBookings: number
  errors: Array<{ providerId: string; error: string }>
}

/**
 * Retorna os limites de início e fim do dia para a data informada (fuso de Brasília).
 */
export function getDayBounds(date = new Date()): { startOfDay: Date; endOfDay: Date } {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const startOfDay = new Date(d)

  d.setHours(23, 59, 59, 999)
  const endOfDay = new Date(d)

  return { startOfDay, endOfDay }
}

/**
 * Formata um valor numérico para o padrão de moeda brasileiro (R$ XX,XX).
 */
export function formatCurrencyBrl(val: number): string {
  return `R$ ${val.toFixed(2).replace(".", ",")}`
}

/**
 * Constrói os dados do briefing e o texto da mensagem para um prestador específico.
 */
export async function buildMorningBriefing(
  providerId: string,
  targetDate = new Date(),
): Promise<ProviderBriefingData | null> {
  const provider = await db.user.findUnique({
    where: { id: providerId },
    select: { id: true, name: true, whatsapp: true, role: true, active: true },
  })

  if (!provider || provider.role !== "PROVIDER" || !provider.active) {
    return null
  }

  const { startOfDay, endOfDay } = getDayBounds(targetDate)

  const rawBookings = await db.booking.findMany({
    where: {
      providerId,
      scheduledAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
      status: {
        in: ["CONFIRMED", "IN_PROGRESS"],
      },
    },
    include: {
      client: { select: { name: true, phone: true } },
      service: { select: { title: true, basePrice: true } },
    },
    orderBy: { scheduledAt: "asc" },
  })

  if (rawBookings.length === 0) {
    return null
  }

  const dateFormatted = targetDate.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })

  let totalGross = 0
  let totalNet = 0

  const bookings: BriefingBookingItem[] = rawBookings.map((b) => {
    const price = toMoneyNumber(b.amount ?? b.service?.basePrice ?? 0)
    const netAmount = Math.round(price * (1 - FEE_RATE) * 100) / 100
    totalGross += price
    totalNet += netAmount

    const timeFormatted = b.scheduledAt
      ? new Date(b.scheduledAt).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "A combinar"

    const address = b.address || "Endereço a confirmar"
    const hasCoords = typeof b.lat === "number" && typeof b.lng === "number"

    return {
      id: b.id,
      timeFormatted,
      serviceTitle: b.service?.title || "Serviço",
      clientName: b.client?.name || "Cliente",
      address,
      lat: b.lat,
      lng: b.lng,
      price,
      netAmount,
      wazeUrl: hasCoords ? `https://waze.com/ul?ll=${b.lat},${b.lng}&navigate=yes` : undefined,
      googleMapsUrl: hasCoords
        ? `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`
        : undefined,
    }
  })

  // Montagem do corpo da mensagem
  const itemsText = bookings
    .map((b, idx) => {
      const navLinks: string[] = []
      if (b.wazeUrl) navLinks.push(`🗺️ Waze: ${b.wazeUrl}`)
      if (b.googleMapsUrl) navLinks.push(`📍 Google Maps: ${b.googleMapsUrl}`)

      const navLine = navLinks.length > 0 ? `\n   ${navLinks.join("\n   ")}` : ""

      return (
        `*${idx + 1}. ${b.timeFormatted} — ${b.serviceTitle}*\n` +
        `   👤 Cliente: ${b.clientName}\n` +
        `   📍 Local: ${b.address}\n` +
        `   💵 Valor Líquido: ${formatCurrencyBrl(b.netAmount)}${navLine}`
      )
    })
    .join("\n\n")

  const messageText =
    `☀️ *Bom dia, ${provider.name}! Aqui está sua agenda de hoje (${dateFormatted}):*\n\n` +
    `Você tem *${bookings.length} atendimento(s)* agendado(s):\n\n` +
    `${itemsText}\n\n` +
    `💰 *Previsão total líquida de recebimento:* ${formatCurrencyBrl(totalNet)}\n\n` +
    `💡 *Dica:* Ao chegar no endereço, faça o check-in no app ou compartilhe sua localização neste WhatsApp para ativar a proteção de Escrow Seguro.\n\n` +
    `Tenha um dia muito produtivo! 🚀\n_Severinno Marketplace_`

  return {
    providerId: provider.id,
    providerName: provider.name,
    providerPhone: provider.whatsapp,
    dateFormatted,
    bookings,
    totalGross,
    totalNet,
    messageText,
  }
}

/**
 * Envia o briefing matinal para um prestador específico.
 */
export async function sendMorningBriefingToProvider(
  providerId: string,
  targetDate = new Date(),
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const briefing = await buildMorningBriefing(providerId, targetDate)
    if (!briefing) {
      return { sent: false, reason: "Sem atendimentos agendados ou prestador inativo" }
    }

    if (!briefing.providerPhone) {
      return { sent: false, reason: "Prestador não possui número de WhatsApp cadastrado" }
    }

    await sendWhatsApp({
      userId: providerId,
      title: `☀️ Briefing da sua agenda de hoje (${briefing.bookings.length} serviços)`,
      body: briefing.messageText,
      url: "/?view=provider.bookings",
    })

    logger.info(
      { providerId, bookingsCount: briefing.bookings.length },
      "whatsapp-morning-briefing: enviado com sucesso",
    )

    return { sent: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err: message, providerId }, "whatsapp-morning-briefing: falha no envio")
    return { sent: false, reason: message }
  }
}

/**
 * Dispara o briefing para todos os prestadores ativos que tenham compromissos no dia.
 */
export async function dispatchAllMorningBriefings(
  targetDate = new Date(),
): Promise<MorningBriefingRunResult> {
  const { startOfDay, endOfDay } = getDayBounds(targetDate)

  // Encontra IDs distintos de prestadores com reservas agendadas hoje
  const bookingsToday = await db.booking.findMany({
    where: {
      scheduledAt: { gte: startOfDay, lte: endOfDay },
      status: { in: ["CONFIRMED", "IN_PROGRESS"] },
    },
    select: { providerId: true },
    distinct: ["providerId"],
  })

  const providerIds = bookingsToday.map((b) => b.providerId).filter(Boolean)

  const result: MorningBriefingRunResult = {
    totalProviders: providerIds.length,
    briefingsSent: 0,
    briefingsSkipped: 0,
    briefingsFailed: 0,
    totalBookings: 0,
    errors: [],
  }

  for (const providerId of providerIds) {
    try {
      const briefing = await buildMorningBriefing(providerId, targetDate)
      if (!briefing) {
        result.briefingsSkipped++
        continue
      }

      result.totalBookings += briefing.bookings.length

      const sendResult = await sendMorningBriefingToProvider(providerId, targetDate)
      if (sendResult.sent) {
        result.briefingsSent++
      } else {
        result.briefingsSkipped++
      }
    } catch (err) {
      result.briefingsFailed++
      result.errors.push({
        providerId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  logger.info(result, "whatsapp-morning-briefing: lote matinal concluído")
  return result
}
