/**
 * Sistema unificado de notificações — Severinno Marketplace
 *
 * Gerencia envio de notificações através de múltiplos canais:
 * - In-app (Notification model no banco de dados)
 * - WhatsApp (Evolution API)
 *
 * Cada função tenta enviar em todos os canais disponíveis.
 * Falhas em um canal não afetam os outros (best-effort).
 */

import { db } from "@/lib/db"
import logger from "./logger"
import {
  sendText,
  sendNewBookingNotification,
  sendBookingStatusNotification,
  sendNewQuoteNotification,
  sendQuoteResponseNotification,
  sendNewMessageNotification,
  formatPhone,
  isValidWhatsApp,
  evolutionLogger,
} from "./evolution"

const notificationLogger = logger.child({ module: "notifications" })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Buscar o WhatsApp do usuário, já formatado para Evolution API.
 * Retorna null se não tiver WhatsApp válido.
 */
async function getUserWhatsApp(userId: string): Promise<string | null> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { whatsapp: true },
    })
    if (!user?.whatsapp) return null
    const formatted = formatPhone(user.whatsapp)
    if (!isValidWhatsApp(formatted)) return null
    return formatted
  } catch {
    return null
  }
}

/**
 * Criar notificação in-app para um usuário.
 */
async function createInAppNotification(
  userId: string,
  type: string,
  title: string,
  body?: string,
): Promise<void> {
  try {
    await db.notification.create({
      data: { userId, type, title, body: body ?? null, read: false },
    })
  } catch (e) {
    notificationLogger.error(
      { err: e, userId, type },
      "Erro ao criar notificação in-app",
    )
  }
}

/**
 * Enviar WhatsApp message para um usuário (best-effort).
 */
async function sendWhatsApp(
  userId: string,
  sendFn: (to: string) => Promise<{ key: { id: string } } | null>,
  context: string,
): Promise<void> {
  try {
    const whatsapp = await getUserWhatsApp(userId)
    if (!whatsapp) {
      notificationLogger.debug(
        { userId, context },
        "WhatsApp não configurado para usuário",
      )
      return
    }

    await sendFn(whatsapp)
    notificationLogger.info(
      { userId, whatsapp: whatsapp.slice(0, 6) + "****", context },
      "WhatsApp enviado com sucesso",
    )
  } catch (e) {
    // Não-propagar erro — notificação WhatsApp é best-effort
    notificationLogger.warn(
      { err: e, userId, context },
      "Falha ao enviar WhatsApp",
    )
  }
}

// ---------------------------------------------------------------------------
// Booking notifications
// ---------------------------------------------------------------------------

/**
 * Notificar provider sobre novo agendamento.
 * Canais: in-app + WhatsApp
 */
export async function notifyNewBooking(
  clientId: string,
  providerId: string,
  bookingId: string,
  serviceName: string,
  scheduledAt: Date,
  clientName: string,
): Promise<void> {
  // In-app para o provider
  await createInAppNotification(
    providerId,
    "BOOKING_CREATED",
    "Novo agendamento",
    `${clientName} agendou "${serviceName}" para ${scheduledAt.toLocaleDateString("pt-BR")}.`,
  )

  // WhatsApp para o provider
  await sendWhatsApp(
    providerId,
    (to) =>
      sendNewBookingNotification(to, clientName, serviceName, scheduledAt, bookingId),
    `booking:${bookingId}:new`,
  )
}

/**
 * Notificar cliente e provider sobre mudança de status do agendamento.
 */
export async function notifyBookingStatus(
  userId: string,
  bookingId: string,
  status: string,
  serviceName: string,
  details?: string,
): Promise<void> {
  const statusLabels: Record<string, string> = {
    CONFIRMED: "Agendamento confirmado",
    IN_PROGRESS: "Serviço em andamento",
    COMPLETED: "Serviço concluído",
    CANCELLED: "Agendamento cancelado",
  }

  const label = statusLabels[status] ?? `Status: ${status}`

  // In-app
  await createInAppNotification(
    userId,
    `BOOKING_${status}`,
    label,
    details ?? `O agendamento #${bookingId.slice(0, 8)} está "${status}".`,
  )

  // WhatsApp
  await sendWhatsApp(
    userId,
    (to) => sendBookingStatusNotification(to, status, serviceName, bookingId, details),
    `booking:${bookingId}:${status}`,
  )
}

// ---------------------------------------------------------------------------
// Quote notifications
// ---------------------------------------------------------------------------

/**
 * Notificar provider sobre novo pedido de orçamento.
 */
export async function notifyNewQuote(
  clientId: string,
  providerId: string,
  quoteId: string,
  itemsCount: number,
  clientName: string,
): Promise<void> {
  // In-app
  await createInAppNotification(
    providerId,
    "QUOTE_CREATED",
    "Nova solicitação de orçamento",
    `${clientName} solicitou um orçamento com ${itemsCount} item(ns).`,
  )

  // WhatsApp
  await sendWhatsApp(
    providerId,
    (to) => sendNewQuoteNotification(to, clientName, itemsCount, quoteId),
    `quote:${quoteId}:new`,
  )
}

/**
 * Notificar cliente sobre resposta de orçamento do provider.
 */
export async function notifyQuoteResponse(
  clientId: string,
  quoteId: string,
  providerName: string,
  total: number,
): Promise<void> {
  // In-app
  await createInAppNotification(
    clientId,
    "QUOTE_RESPONDED",
    "Orçamento respondido",
    `${providerName} respondeu ao orçamento — R$ ${total.toFixed(2)}.`,
  )

  // WhatsApp
  await sendWhatsApp(
    clientId,
    (to) => sendQuoteResponseNotification(to, providerName, total, quoteId),
    `quote:${quoteId}:responded`,
  )
}

// ---------------------------------------------------------------------------
// Message notifications
// ---------------------------------------------------------------------------

/**
 * Notificar usuário sobre nova mensagem recebida.
 */
export async function notifyNewMessage(
  toId: string,
  fromName: string,
  content: string,
  bookingId?: string,
): Promise<void> {
  // In-app (já feito no messages route, mas garantimos que caiam aqui também)
  await createInAppNotification(
    toId,
    "MESSAGE",
    `Nova mensagem de ${fromName}`,
    content.length > 80 ? `${content.slice(0, 80)}…` : content,
  )

  // WhatsApp
  await sendWhatsApp(
    toId,
    (to) => sendNewMessageNotification(to, fromName, content, bookingId),
    `message:${bookingId ?? "general"}:new`,
  )
}

// ---------------------------------------------------------------------------
// Payment notifications
// ---------------------------------------------------------------------------

/**
 * Notificar provider sobre pagamento confirmado.
 */
export async function notifyPaymentConfirmed(
  providerId: string,
  bookingId: string,
  amount: number,
): Promise<void> {
  await createInAppNotification(
    providerId,
    "PAYMENT_CONFIRMED",
    "Pagamento confirmado",
    `Pagamento de R$ ${amount.toFixed(2)} confirmado para #${bookingId.slice(0, 8)}.`,
  )

  await sendWhatsApp(
    providerId,
    (to) =>
      sendText(
        to,
        `🟢 *Pagamento confirmado!*\n\n📋 Agendamento: #${bookingId.slice(0, 8)}\n💰 Valor: R$ ${amount.toFixed(2)}\n\nO valor já está disponível para saque.`,
      ),
    `payment:${bookingId}:confirmed`,
  )
}

export { notificationLogger }
