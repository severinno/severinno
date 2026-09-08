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
  sendPaymentReminderMessage,
  sendServiceCompletionRequest,
  sendReviewRequest,
  sendPixPaymentMessage,
  sendLiveTrackingNotification,
  sendPixPaymentReceiptToClient,
  sendBookingReminder24hNotification,
  formatPhone,
  isValidWhatsApp,
} from "./evolution"
import { sendPushNotification } from "./push"
import { emitRealtime } from "./realtime-client"
import { fireEvent } from "./event-hub"

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
 * Retorna o registro criado (ou null em erro) para permitir
 * dispatch realtime com o id da notificação.
 */
async function createInAppNotification(
  userId: string,
  type: string,
  title: string,
  body?: string,
): Promise<{ id: string; createdAt: Date } | null> {
  try {
    const notif = await db.notification.create({
      data: { userId, type, title, body: body ?? null, read: false },
      select: { id: true, createdAt: true },
    })
    try {
      emitRealtime(`user:${userId}`, {
        type: "notification",
        data: { id: notif.id, type, title, body },
      })
    } catch {
      // Best effort realtime dispatch
    }
    return notif
  } catch (e) {
    notificationLogger.error({ err: e, userId, type }, "Erro ao criar notificação in-app")
    return null
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
      notificationLogger.debug({ userId, context }, "WhatsApp não configurado para usuário")
      return
    }

    await sendFn(whatsapp)
    notificationLogger.info(
      { userId, whatsapp: whatsapp.slice(0, 6) + "****", context },
      "WhatsApp enviado com sucesso",
    )
  } catch (e) {
    // Não-propagar erro — notificação WhatsApp é best-effort
    notificationLogger.warn({ err: e, userId, context }, "Falha ao enviar WhatsApp")
  }
}

// ---------------------------------------------------------------------------
// Booking notifications
// ---------------------------------------------------------------------------

/**
 * Notificar provider sobre novo agendamento.
 * Canais: in-app + WhatsApp + Push
 */
export async function notifyNewBooking(
  clientId: string,
  providerId: string,
  bookingId: string,
  serviceName: string,
  scheduledAt: Date,
  clientName: string,
): Promise<void> {
  const dateStr = scheduledAt.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    weekday: "short",
  })
  const timeStr = scheduledAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  const title = `📅 Novo agendamento: ${serviceName}`
  const body = `${clientName} agendou para ${dateStr} às ${timeStr}`
  const pushUrl = `/dashboard?tab=bookings&booking=${bookingId}`

  // In-app para o provider
  const created = await createInAppNotification(providerId, "BOOKING_CREATED", title, body)

  // 🔔 Realtime (WebSocket) para o provider — toast + invalidação de queries.
  // Best-effort: falha de rede não deve derrubar a criação do booking.
  if (created) {
    emitRealtime("notification:new", {
      toId: providerId,
      notification: {
        id: created.id,
        type: "BOOKING_CREATED",
        title,
        body,
        read: false,
        createdAt: created.createdAt.toISOString(),
      },
    }).catch(() => {})
  }

  // Push notification com botões Aceitar/Recusar
  await sendPushNotification(providerId, title, body, pushUrl, {
    notificationType: "BOOKING_CREATED",
    bookingId,
    tag: `booking:${bookingId}:new`,
  }).catch(() => {})

  // WhatsApp para o provider
  await sendWhatsApp(
    providerId,
    (to) => sendNewBookingNotification(to, clientName, serviceName, scheduledAt, bookingId),
    `booking:${bookingId}:new`,
  )

  // 🔔 Fire event webhook — admin pode criar regras que disparam push automaticamente
  // Scoped to providerId so the rule only notifies the affected provider, not ALL providers
  await fireEvent(
    "booking.created",
    {
      clientName,
      serviceName,
      providerName: "",
      date: `${dateStr} às ${timeStr}`,
    },
    { scopedUserIds: [providerId] },
  ).catch(() => {})
}

/**
 * Notificar cliente e provider sobre mudança de status do agendamento.
 * Canais: in-app + WhatsApp + Push
 */
export async function notifyBookingStatus(
  userId: string,
  bookingId: string,
  status: string,
  serviceName: string,
  details?: string,
): Promise<void> {
  const statusMeta: Record<string, { icon: string; label: string }> = {
    CONFIRMED: { icon: "✅", label: "Agendamento confirmado" },
    IN_PROGRESS: { icon: "🔧", label: "Serviço em andamento" },
    COMPLETED: { icon: "🎉", label: "Serviço concluído" },
    CANCELLED: { icon: "❌", label: "Agendamento cancelado" },
  }

  const meta = statusMeta[status] ?? { icon: "📋", label: `Status: ${status}` }
  const label = `${meta.icon} ${meta.label}`
  const body = details ?? `${serviceName} — ${meta.label.toLowerCase()}`
  const pushUrl = `/dashboard?tab=bookings&booking=${bookingId}`

  // In-app
  await createInAppNotification(userId, `BOOKING_${status}`, label, body)

  // Push notification (sem actions — status change is informational)
  await sendPushNotification(userId, label, body, pushUrl, {
    tag: `booking:${bookingId}:${status}`,
  }).catch(() => {})

  // WhatsApp
  await sendWhatsApp(
    userId,
    (to) => sendBookingStatusNotification(to, status, serviceName, bookingId, details),
    `booking:${bookingId}:${status}`,
  )

  // 🔔 Fire event webhook — scoped to the affected user (the one whose booking status changed)
  const eventMap: Record<string, "booking.confirmed" | "booking.cancelled" | "booking.completed"> =
    {
      CONFIRMED: "booking.confirmed",
      CANCELLED: "booking.cancelled",
      COMPLETED: "booking.completed",
    }
  const event = eventMap[status]
  if (event) {
    await fireEvent(
      event,
      {
        serviceName,
        date: new Date().toLocaleString("pt-BR"),
      },
      { scopedUserIds: [userId] },
    ).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Quote notifications
// ---------------------------------------------------------------------------

/**
 * Notificar provider sobre novo pedido de orçamento.
 * Canais: in-app + WhatsApp + Push
 */
export async function notifyNewQuote(
  clientId: string,
  providerId: string,
  quoteId: string,
  itemsCount: number,
  clientName: string,
): Promise<void> {
  const title = "Nova solicitação de orçamento"
  const body = `${clientName} solicitou um orçamento com ${itemsCount} item(ns).`
  const pushUrl = `/dashboard?tab=quotes&quote=${quoteId}`

  // In-app
  await createInAppNotification(providerId, "QUOTE_CREATED", title, body)

  // Push notification
  await sendPushNotification(providerId, title, body, pushUrl).catch(() => {})

  // WhatsApp
  await sendWhatsApp(
    providerId,
    (to) => sendNewQuoteNotification(to, clientName, itemsCount, quoteId),
    `quote:${quoteId}:new`,
  )

  // 🔔 Fire event webhook — scoped to the affected provider
  await fireEvent(
    "quote.received",
    {
      clientName,
      providerName: "",
      serviceName: "",
      itemsCount: String(itemsCount),
    },
    { scopedUserIds: [providerId] },
  ).catch(() => {})
}

/**
 * Notificar cliente sobre resposta de orçamento do provider.
 * Canais: in-app + WhatsApp + Push
 */
export async function notifyQuoteResponse(
  clientId: string,
  quoteId: string,
  providerName: string,
  total: number,
): Promise<void> {
  const title = "Orçamento respondido"
  const body = `${providerName} respondeu ao orçamento — R$ ${total.toFixed(2)}.`
  const pushUrl = `/dashboard?tab=quotes&quote=${quoteId}`

  // In-app
  await createInAppNotification(clientId, "QUOTE_RESPONDED", title, body)

  // Push notification
  await sendPushNotification(clientId, title, body, pushUrl).catch(() => {})

  // WhatsApp
  await sendWhatsApp(
    clientId,
    (to) => sendQuoteResponseNotification(to, providerName, total, quoteId),
    `quote:${quoteId}:responded`,
  )

  // 🔔 Fire event webhook — scoped to the affected client
  await fireEvent(
    "quote.responded",
    {
      providerName,
      clientName: "",
      serviceName: "",
      amount: String(total),
    },
    { scopedUserIds: [clientId] },
  ).catch(() => {})
}

// ---------------------------------------------------------------------------
// Message notifications
// ---------------------------------------------------------------------------

/**
 * Notificar usuário sobre nova mensagem recebida.
 * Canais: in-app + WhatsApp + Push
 */
export async function notifyNewMessage(
  toId: string,
  fromName: string,
  content: string,
  bookingId?: string,
): Promise<void> {
  const title = `Nova mensagem de ${fromName}`
  const body = content.length > 80 ? `${content.slice(0, 80)}…` : content
  const pushUrl = bookingId ? `/dashboard?tab=chat&booking=${bookingId}` : `/chat`

  // In-app
  await createInAppNotification(toId, "MESSAGE", title, body)

  // Push notification
  await sendPushNotification(toId, title, body, pushUrl).catch(() => {})

  // WhatsApp
  await sendWhatsApp(
    toId,
    (to) => sendNewMessageNotification(to, fromName, content, bookingId),
    `message:${bookingId ?? "general"}:new`,
  )

  // 🔔 Fire event webhook — scoped to the recipient
  await fireEvent(
    "message.sent",
    {
      fromName,
      toName: "",
      content: content.slice(0, 100),
    },
    { scopedUserIds: [toId] },
  ).catch(() => {})
}

// ---------------------------------------------------------------------------
// Payment notifications
// ---------------------------------------------------------------------------

/**
 * Notificar provider sobre pagamento confirmado.
 * Canais: in-app + WhatsApp + Push
 */
export async function notifyPaymentConfirmed(
  providerId: string,
  bookingId: string,
  amount: number,
): Promise<void> {
  const title = "Pagamento confirmado"
  const body = `Pagamento de R$ ${amount.toFixed(2)} confirmado para #${bookingId.slice(0, 8)}.`
  const pushUrl = `/dashboard?tab=finance&booking=${bookingId}`

  // In-app
  await createInAppNotification(providerId, "PAYMENT_CONFIRMED", title, body)

  // Push notification
  await sendPushNotification(providerId, title, body, pushUrl).catch(() => {})

  // WhatsApp
  await sendWhatsApp(
    providerId,
    (to) =>
      sendText(
        to,
        `🟢 *Pagamento confirmado!*\n\n📋 Agendamento: #${bookingId.slice(0, 8)}\n💰 Valor: R$ ${amount.toFixed(2)}\n\nO valor já está disponível para saque.`,
      ),
    `payment:${bookingId}:confirmed`,
  )

  // 🔔 Fire event webhook — scoped to the affected provider
  await fireEvent(
    "payment.confirmed",
    {
      providerName: "",
      clientName: "",
      amount: String(amount),
    },
    { scopedUserIds: [providerId] },
  ).catch(() => {})
}

// ---------------------------------------------------------------------------
// Extended Lifecycle Notifications
// ---------------------------------------------------------------------------

/**
 * Notificar cliente sobre pagamento PIX pendente.
 * Canais: in-app + WhatsApp + Push
 */
export async function notifyPaymentReminder(
  clientId: string,
  bookingId: string,
  amount: number,
  qrCode?: string,
): Promise<void> {
  const title = "⏰ Lembrete de Pagamento"
  const body = `O pagamento de R$ ${amount.toFixed(2)} do agendamento #${bookingId.slice(0, 8)} está pendente.`
  const pushUrl = `/dashboard?tab=bookings&booking=${bookingId}`

  await createInAppNotification(clientId, "PAYMENT_REMINDER", title, body)
  await sendPushNotification(clientId, title, body, pushUrl).catch(() => {})
  await sendWhatsApp(
    clientId,
    (to) => sendPaymentReminderMessage(to, bookingId, amount, qrCode),
    `payment:${bookingId}:reminder`,
  )
}

/**
 * Notificar cliente solicitando confirmação de conclusão do serviço.
 * Canais: in-app + WhatsApp + Push
 */
export async function notifyCompletionRequest(
  clientId: string,
  bookingId: string,
  providerName: string,
): Promise<void> {
  const title = "🔧 Confirmar Conclusão do Serviço"
  const body = `${providerName} finalizou o atendimento. Confirme no app para liberar o pagamento!`
  const pushUrl = `/dashboard?tab=bookings&booking=${bookingId}`

  await createInAppNotification(clientId, "SERVICE_COMPLETION_REQUEST", title, body)
  await sendPushNotification(clientId, title, body, pushUrl).catch(() => {})
  await sendWhatsApp(
    clientId,
    (to) => sendServiceCompletionRequest(to, bookingId, providerName),
    `booking:${bookingId}:completion-request`,
  )
}

/**
 * Notificar cliente solicitando avaliação do serviço.
 * Canais: in-app + WhatsApp + Push
 */
export async function notifyReviewRequest(
  clientId: string,
  bookingId: string,
  providerName: string,
): Promise<void> {
  const title = "⭐ Avalie seu atendimento"
  const body = `Como foi o serviço prestado por ${providerName}? Deixe sua nota e comentário!`
  const pushUrl = `/dashboard?tab=bookings&booking=${bookingId}`

  await createInAppNotification(clientId, "REVIEW_REQUEST", title, body)
  await sendPushNotification(clientId, title, body, pushUrl).catch(() => {})
  await sendWhatsApp(
    clientId,
    (to) => sendReviewRequest(to, bookingId, providerName),
    `booking:${bookingId}:review-request`,
  )
}

/**
 * Notificar usuário sobre aprovação ou rejeição da identidade KYC.
 */
export async function notifyIdentityResult(
  userId: string,
  action: "approve" | "reject",
  reason?: string,
): Promise<void> {
  const isApproved = action === "approve"
  const title = isApproved
    ? "Identidade verificada com sucesso! 🛡️"
    : "Verificação de identidade não aprovada ⚠️"
  const body = isApproved
    ? "Parabéns! Seus documentos foram validados e o selo de verificação já está ativo em seu perfil."
    : reason ||
      "Documento não aprovado pela equipe. Por favor, acesse seu perfil e reenvie seus documentos."
  const pushUrl = "/dashboard?tab=profile"

  await createInAppNotification(
    userId,
    isApproved ? "IDENTITY_APPROVED" : "IDENTITY_REJECTED",
    title,
    body,
  )

  await sendPushNotification(userId, title, body, pushUrl).catch(() => {})

  await sendWhatsApp(
    userId,
    (to) =>
      sendText(
        to,
        isApproved
          ? `🛡️ *Identidade Verificada — Severinno*\n\nParabéns! Sua documentação foi aprovada e seu selo de verificação já está ativo na Severinno.`
          : `⚠️ *Aviso de Verificação — Severinno*\n\nNão foi possível aprovar sua verificação: ${body}\n\nAcesse seu painel para reenviar.`,
      ),
    `identity:${userId}:${action}`,
  )
}

/**
 * Notificar cliente sobre início do deslocamento do prestador com link de rastreamento.
 * Canais: in-app + WhatsApp + Push
 */
export async function notifyLiveTrackingStarted(
  clientId: string,
  bookingId: string,
  providerName: string,
  serviceName: string,
): Promise<void> {
  const title = "🚗 Prestador a caminho!"
  const body = `${providerName} iniciou o deslocamento para o serviço "${serviceName}". Acompanhe ao vivo pelo mapa.`
  const trackingUrl = `https://severinno.com.br/?view=client.bookings&tracking=${bookingId}`

  await createInAppNotification(clientId, "LIVE_TRACKING_STARTED", title, body)
  await sendPushNotification(clientId, title, body, trackingUrl).catch(() => {})
  await sendWhatsApp(
    clientId,
    (to) => sendLiveTrackingNotification(to, providerName, serviceName, bookingId, trackingUrl),
    `tracking:${bookingId}:started`,
  )
}

/**
 * Notificar cliente com o código PIX Copia e Cola gerado para pagamento.
 * Canais: in-app + WhatsApp + Push
 */
export async function notifyPixCreated(
  clientId: string,
  bookingId: string,
  amount: number,
  qrCode?: string,
): Promise<void> {
  const title = "🟢 Pagamento PIX gerado"
  const body = `PIX de R$ ${amount.toFixed(2)} gerado para #${bookingId.slice(0, 8)}. Pague para confirmar seu agendamento.`
  const pushUrl = `/dashboard?tab=bookings&booking=${bookingId}`

  await createInAppNotification(clientId, "PIX_CREATED", title, body)
  await sendPushNotification(clientId, title, body, pushUrl).catch(() => {})
  await sendWhatsApp(
    clientId,
    (to) => sendPixPaymentMessage(to, bookingId, amount, qrCode),
    `pix:${bookingId}:created`,
  )
}

/**
 * Notificar cliente com recibo de confirmação de pagamento seguro (Severinno Escrow).
 * Canais: in-app + WhatsApp + Push
 */
export async function notifyPaymentConfirmedToClient(
  clientId: string,
  bookingId: string,
  amount: number,
  serviceName: string,
  providerName: string,
): Promise<void> {
  const title = "✅ Pagamento confirmado"
  const body = `Recebemos seu pagamento de R$ ${amount.toFixed(2)} para o serviço "${serviceName}". O valor está em custódia segura.`
  const pushUrl = `/dashboard?tab=bookings&booking=${bookingId}`

  await createInAppNotification(clientId, "PAYMENT_CONFIRMED_CLIENT", title, body)
  await sendPushNotification(clientId, title, body, pushUrl).catch(() => {})
  await sendWhatsApp(
    clientId,
    (to) => sendPixPaymentReceiptToClient(to, bookingId, amount, serviceName, providerName),
    `payment:${bookingId}:confirmed_client`,
  )
}

/**
 * Notificar cliente 24h antes do agendamento com detalhes e lembrete.
 * Canais: in-app + WhatsApp + Push
 */
export async function notifyBookingReminder24h(
  clientId: string,
  bookingId: string,
  clientName: string,
  serviceName: string,
  providerName: string,
  scheduledDate: string,
  address?: string,
): Promise<void> {
  const title = "⏰ Lembrete de Agendamento"
  const body = `Você tem um serviço de ${serviceName} com ${providerName} amanhã (${scheduledDate}).`
  const pushUrl = `/dashboard?tab=bookings&booking=${bookingId}`

  await createInAppNotification(clientId, "BOOKING_REMINDER_24H", title, body)
  await sendPushNotification(clientId, title, body, pushUrl).catch(() => {})
  await sendWhatsApp(
    clientId,
    (to) =>
      sendBookingReminder24hNotification(
        to,
        clientName,
        serviceName,
        providerName,
        scheduledDate,
        bookingId,
        address,
      ),
    `reminder:${bookingId}:24h`,
  )
}

export { notificationLogger }
