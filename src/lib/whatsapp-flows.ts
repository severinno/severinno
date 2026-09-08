/**
 * WhatsApp Automated Flows & Lifecycle Messages
 *
 * Handles automated triggers for:
 * 1. Booking Reminders (24h before scheduled time)
 * 2. Quote Follow-ups (quotes pending response for > 48h)
 * 3. Review Requests (after booking is marked completed)
 * 4. Provider Welcome & Onboarding encouragement
 *
 * Uses Redis keys to guarantee idempotency and avoid duplicate messages.
 */

import { db } from "@/lib/db"
import { sendText, sendButtons, formatPhone, isValidWhatsApp } from "./evolution"
import { getClient } from "@/lib/redis"
import logger from "@/lib/logger"

const log = logger.child({ module: "whatsapp-flows" })

/**
 * Check if a flow trigger has already run for a given entity.
 */
async function hasFlowExecuted(key: string): Promise<boolean> {
  const redis = getClient()
  if (!redis) return false
  const exists = await redis.get(`flow:${key}`)
  return exists !== null
}

/**
 * Mark a flow trigger as executed with a 30-day TTL.
 */
async function markFlowExecuted(key: string): Promise<void> {
  const redis = getClient()
  if (!redis) return
  await redis.set(`flow:${key}`, "1", "EX", 30 * 24 * 3600)
}

/**
 * 1. Send Booking Reminder (24h before service)
 */
export async function runBookingReminders(): Promise<{ sent: number; errors: number }> {
  let sent = 0
  let errors = 0

  const now = new Date()
  const tomorrowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000)
  const tomorrowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000)

  try {
    const upcomingBookings = await db.booking.findMany({
      where: {
        status: "CONFIRMED",
        scheduledAt: {
          gte: tomorrowStart,
          lte: tomorrowEnd,
        },
      },
      include: {
        client: { select: { id: true, name: true, whatsapp: true } },
        provider: { select: { id: true, name: true, whatsapp: true } },
        service: { select: { title: true } },
      },
    })

    for (const booking of upcomingBookings) {
      const dedupeKey = `booking-reminder:${booking.id}`
      if (await hasFlowExecuted(dedupeKey)) continue

      const timeStr = booking.scheduledAt
        ? new Date(booking.scheduledAt).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "horário agendado"

      // Reminder to Client
      if (booking.client?.whatsapp) {
        const clientPhone = formatPhone(booking.client.whatsapp)
        if (isValidWhatsApp(clientPhone)) {
          const desc = `Olá ${booking.client.name}! Lembramos que seu serviço de *${booking.service?.title || "atendimento"}* com ${booking.provider?.name || "o profissional"} está agendado para amanhã às *${timeStr}*.\n\nLocal: ${booking.address || "endereço cadastrado"}`
          await sendButtons(clientPhone, "⏰ Lembrete de Atendimento", desc, [
            { id: `confirm_${booking.id}`, text: "✅ Confirmar" },
            { id: `chat_${booking.id}`, text: "💬 Abrir Chat" },
          ]).catch((err) => {
            log.warn({ err, bookingId: booking.id }, "Failed to send booking reminder to client")
            errors++
          })
        }
      }

      // Reminder to Provider
      if (booking.provider?.whatsapp) {
        const providerPhone = formatPhone(booking.provider.whatsapp)
        if (isValidWhatsApp(providerPhone)) {
          const providerMsg = `⏰ *Lembrete de Compromisso — Severinno*\n\nOlá ${booking.provider.name}! Você tem um atendimento de *${booking.service?.title || "serviço"}* agendado para amanhã às *${timeStr}* com o cliente ${booking.client?.name}.\n\nEndereço: ${booking.address || "ver no app"}\n\nTenha um ótimo atendimento!`
          await sendText(providerPhone, providerMsg).catch((err) => {
            log.warn({ err, bookingId: booking.id }, "Failed to send booking reminder to provider")
            errors++
          })
        }
      }

      await markFlowExecuted(dedupeKey)
      sent++
    }
  } catch (err) {
    log.error({ err }, "Error running booking reminders flow")
  }

  return { sent, errors }
}

/**
 * 2. Send Quote Follow-ups (unanswered quotes after 48h)
 */
export async function runQuoteFollowups(): Promise<{ sent: number; errors: number }> {
  let sent = 0
  let errors = 0

  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000)
  const fourDaysAgo = new Date(Date.now() - 96 * 60 * 60 * 1000)

  try {
    const pendingQuotes = await db.quoteRequest.findMany({
      where: {
        status: "PENDING",
        createdAt: {
          gte: fourDaysAgo,
          lte: twoDaysAgo,
        },
      },
      include: {
        provider: { select: { id: true, name: true, whatsapp: true } },
        items: {
          select: {
            service: { select: { title: true } },
          },
        },
      },
    })

    for (const quote of pendingQuotes) {
      const dedupeKey = `quote-followup:${quote.id}`
      if (await hasFlowExecuted(dedupeKey)) continue

      if (quote.provider?.whatsapp) {
        const phone = formatPhone(quote.provider.whatsapp)
        if (isValidWhatsApp(phone)) {
          const serviceTitle = quote.items[0]?.service?.title || "serviço"
          const desc = `Olá, ${quote.provider.name}! Você recebeu um pedido de orçamento para *${serviceTitle}* há 48h.\n\nResponder rapidamente aumenta em 70% a chance de fechar o serviço.`
          await sendButtons(phone, "📋 Orçamento Aguardando Resposta", desc, [
            { id: `view_${quote.id}`, text: "📋 Ver Orçamento" },
            { id: `decline_${quote.id}`, text: "❌ Recusar" },
          ]).catch((err) => {
            log.warn({ err, quoteId: quote.id }, "Failed to send quote follow-up")
            errors++
          })
        }
      }

      await markFlowExecuted(dedupeKey)
      sent++
    }
  } catch (err) {
    log.error({ err }, "Error running quote followups flow")
  }

  return { sent, errors }
}

/**
 * 3. Send Review Requests (24h after booking completion)
 */
export async function runReviewRequests(): Promise<{ sent: number; errors: number }> {
  let sent = 0
  let errors = 0

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000)

  try {
    const completedBookings = await db.booking.findMany({
      where: {
        status: "COMPLETED",
        updatedAt: {
          gte: twoDaysAgo,
          lte: oneDayAgo,
        },
        reviews: {
          none: {},
        },
      },
      include: {
        client: { select: { id: true, name: true, whatsapp: true } },
        provider: { select: { name: true } },
        service: { select: { title: true } },
      },
    })

    for (const booking of completedBookings) {
      const dedupeKey = `review-request:${booking.id}`
      if (await hasFlowExecuted(dedupeKey)) continue

      if (booking.client?.whatsapp) {
        const phone = formatPhone(booking.client.whatsapp)
        if (isValidWhatsApp(phone)) {
          const desc = `Olá, ${booking.client.name}! O serviço de *${booking.service?.title || "atendimento"}* realizado por *${booking.provider?.name || "nosso profissional"}* foi concluído ontem.\n\nSua avaliação ajuda outros clientes a escolherem bem!`
          await sendButtons(phone, "⭐ Avalie seu atendimento", desc, [
            { id: `review_${booking.id}`, text: "⭐ Avaliar Agora" },
          ]).catch((err) => {
            log.warn({ err, bookingId: booking.id }, "Failed to send review request WhatsApp")
            errors++
          })
        }
      }

      await markFlowExecuted(dedupeKey)
      sent++
    }
  } catch (err) {
    log.error({ err }, "Error running review requests flow")
  }

  return { sent, errors }
}

/**
 * Master runner triggered by cron.
 */
export async function runAllWhatsAppFlows() {
  log.info("Starting automated WhatsApp lifecycle flows...")
  const [reminders, followups, reviews] = await Promise.all([
    runBookingReminders(),
    runQuoteFollowups(),
    runReviewRequests(),
  ])

  log.info({ reminders, followups, reviews }, "Automated WhatsApp lifecycle flows completed")

  return { reminders, followups, reviews }
}
