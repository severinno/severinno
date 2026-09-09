/**
 * Evolution API — WhatsApp HTTP Client
 *
 * Integração com a Evolution API para envio de mensagens via WhatsApp.
 * A Evolution API é um servidor REST auto-hospedado que se conecta ao WhatsApp.
 *
 * ## Configuração
 * - EVOLUTION_API_URL: URL do seu servidor Evolution API (ex: https://evo.severinno.com.br)
 * - EVOLUTION_API_KEY: API key global (configurada no .env do servidor Evolution)
 * - EVOLUTION_INSTANCE: Nome da instância WhatsApp conectada
 * - EVOLUTION_WEBHOOK_URL: URL do webhook para mensagens recebidas (opcional)
 *
 * ## Fluxo (precisa ser feito UMA VEZ no painel Evolution)
 * 1. POST /instance/create → cria instância
 * 2. POST /instance/connect/{instanceName} → obtém QR code
 * 3. Escaneia QR code com WhatsApp
 * 4. Pronto para enviar/receber mensagens
 */

import logger from "./logger"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvolutionMessageText = {
  /** Número do destinatário com DDI (ex: 5511999999999) */
  number: string
  /** Texto da mensagem */
  text: string
  /** Opções avançadas (opcional) */
  options?: {
    /** Marcar como lida */
    read?: boolean
    /** Responder a uma mensagem específica (messageId) */
    replyTo?: string
    /** Marcar como mensagem estrelada */
    starred?: boolean
  }
}

export type EvolutionMessageMedia = {
  number: string
  mediatype: "image" | "video" | "document" | "audio"
  media: string // URL ou base64 do arquivo
  caption?: string
  filename?: string
}

export type EvolutionWebhookPayload = {
  /** Evento: "messages.upsert" | "message.update" | "connection.update" | ... */
  event: string
  instance: string
  /** Dados do evento (varia por tipo) */
  data: {
    /** ID da mensagem no WhatsApp */
    key?: {
      remoteJid: string
      fromMe: boolean
      id: string
    }
    /** Conteúdo da mensagem */
    message?: {
      conversation?: string
      extendedTextMessage?: { text: string }
      imageMessage?: { caption?: string; mimetype: string }
      videoMessage?: { caption?: string }
      documentMessage?: { title?: string }
    }
    /** Timestamp */
    messageTimestamp?: number
    /** Status: "PENDING" | "SERVER_ACK" | "READ" | "PLAYED" */
    status?: string
    /** Nome do contato */
    pushName?: string
  }
}

export type EvolutionConnectionStatus = {
  instance: {
    instanceName: string
    status: "connecting" | "connected" | "disconnected" | "error"
    qrcode?: string
  }
}

export type EvolutionWebhookConfig = {
  enabled: boolean
  url: string
  /** Eventos a escutar (ex: ["messages.upsert", "connection.update"]) */
  events: string[]
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getConfig() {
  const baseUrl = process.env.EVOLUTION_API_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  const instance = process.env.EVOLUTION_INSTANCE ?? "severinno"

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Evolution API não configurada. Defina EVOLUTION_API_URL e EVOLUTION_API_KEY no .env",
    )
  }

  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, instance }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

import { evolutionBreaker } from "./external-circuit-breakers"

async function evolutionRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { baseUrl, apiKey } = getConfig()
  const url = `${baseUrl}${path}`

  const res = await evolutionBreaker.execute(() =>
    fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        apikey: apiKey,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  )

  const contentType = res.headers.get("content-type") ?? ""
  let parsed: unknown = null
  if (contentType.includes("application/json")) {
    parsed = await res.json().catch(() => null)
  }

  if (!res.ok) {
    const message =
      (parsed &&
      typeof parsed === "object" &&
      "message" in parsed &&
      typeof (parsed as { message?: unknown }).message === "string"
        ? (parsed as { message: string }).message
        : undefined) ??
      (parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as { error?: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : undefined) ??
      `Evolution API error: ${res.status} ${res.statusText}`
    throw new EvolutionError(message, res.status)
  }

  return parsed as T
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class EvolutionError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "EvolutionError"
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// Message sending
// ---------------------------------------------------------------------------

/**
 * Enviar mensagem de texto via WhatsApp.
 *
 * @param to Número com DDI (ex: "5511999999999")
 * @param text Texto da mensagem
 * @param instanceName Nome da instância (default: EVOLUTION_INSTANCE)
 */
export async function sendText(
  to: string,
  text: string,
  instanceName?: string,
): Promise<{ key: { id: string } }> {
  const instance = instanceName ?? getConfig().instance

  // Garantir que o número tem o formato correto (números apenas)
  const number = to.replace(/\D/g, "")

  return evolutionRequest<{ key: { id: string } }>("POST", `/message/sendText/${instance}`, {
    number,
    text,
  } as EvolutionMessageText)
}

export type EvolutionButton = {
  id: string
  text: string
}

/**
 * Enviar mensagem com botões interativos via WhatsApp (Evolution API).
 * Se a instância não suportar botões interativos ou falhar, faz fallback
 * gracioso para mensagem de texto formatada com opções numeradas.
 */
export async function sendButtons(
  to: string,
  title: string,
  description: string,
  buttons: EvolutionButton[],
  footer = "Severinno Marketplace",
  instanceName?: string,
): Promise<{ key: { id: string } }> {
  const instance = instanceName ?? getConfig().instance
  const number = to.replace(/\D/g, "")

  try {
    const payload = {
      number,
      title,
      description,
      footer,
      buttons: buttons.map((b) => ({
        buttonId: b.id,
        buttonText: { displayText: b.text },
        type: 1,
      })),
    }
    return await evolutionRequest<{ key: { id: string } }>(
      "POST",
      `/message/sendButtons/${instance}`,
      payload,
    )
  } catch (err) {
    logger.warn(
      { err, to: number.slice(0, 4) + "****" },
      "sendButtons falhou na Evolution API, enviando fallback em texto",
    )
    const buttonList = buttons.map((b, i) => `👉 *${i + 1}. ${b.text}*`).join("\n")
    const fallbackText = `*${title}*\n\n${description}\n\n${buttonList}\n\n_${footer}_`
    return sendText(number, fallbackText, instance)
  }
}

/**
 * Enviar mensagem com template de cobrança PIX (link + QR code).
 */
export async function sendPixPaymentMessage(
  to: string,
  bookingId: string,
  amount: number,
  qrCode?: string,
  _qrCodeImage?: string,
): Promise<{ key: { id: string } } | null> {
  const text =
    `🟢 *Pagamento PIX - Severinno*\n\n` +
    `📋 Agendamento: #${bookingId.slice(0, 8)}\n` +
    `💰 Valor: R$ ${amount.toFixed(2)}\n\n` +
    (qrCode ? `📱 *Código PIX (copia e cola):*\n\`\`\`${qrCode}\`\`\`\n\n` : "") +
    `Após o pagamento, a confirmação é automática! ✅`

  return sendText(to, text)
}

/**
 * Enviar uma notificação de novo booking para o provider.
 */
export async function sendNewBookingNotification(
  to: string,
  clientName: string,
  serviceName: string,
  scheduledAt: Date,
  bookingId: string,
): Promise<{ key: { id: string } } | null> {
  const { getTimezoneFromCoords } = await import("@/lib/geo-timezone")
  const { db } = await import("@/lib/db")
  const booking = await db.booking.findUnique({ where: { id: bookingId }, select: { lat: true, lng: true } })
  const timezone = getTimezoneFromCoords(booking?.lat ?? 0, booking?.lng ?? 0)
  const scheduledStr = scheduledAt.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  })

  const text =
    `🆕 *Novo agendamento recebido!*\n\n` +
    `👤 Cliente: ${clientName}\n` +
    `🔧 Serviço: ${serviceName}\n` +
    `📅 Data: ${scheduledStr}\n` +
    `🆔 #${bookingId.slice(0, 8)}\n\n` +
    `Acesse o painel para confirmar ou ajustar o horário.`

  return sendText(to, text)
}

/**
 * Enviar notificação de status de booking (confirmado, cancelado, concluído).
 */
export async function sendBookingStatusNotification(
  to: string,
  status: string,
  serviceName: string,
  bookingId: string,
  details?: string,
): Promise<{ key: { id: string } } | null> {
  const statusMap: Record<string, { emoji: string; label: string }> = {
    CONFIRMED: { emoji: "✅", label: "Confirmado" },
    IN_PROGRESS: { emoji: "🔄", label: "Em andamento" },
    COMPLETED: { emoji: "🎉", label: "Concluído" },
    CANCELLED: { emoji: "❌", label: "Cancelado" },
  }

  const s = statusMap[status] ?? { emoji: "📋", label: status }

  const text =
    `${s.emoji} *Agendamento ${s.label}*\n\n` +
    `🔧 Serviço: ${serviceName}\n` +
    `🆔 #${bookingId.slice(0, 8)}\n` +
    (details ? `\n${details}\n` : "") +
    `\nAcompanhe no app Severinno.`

  return sendText(to, text)
}

/**
 * Enviar notificação de novo orçamento para provider.
 */
export async function sendNewQuoteNotification(
  to: string,
  clientName: string,
  itemsCount: number,
  quoteId: string,
): Promise<{ key: { id: string } } | null> {
  const text =
    `📋 *Nova solicitação de orçamento!*\n\n` +
    `👤 Cliente: ${clientName}\n` +
    `📦 Itens: ${itemsCount}\n` +
    `🆔 #${quoteId.slice(0, 8)}\n\n` +
    `Acesse o painel para responder ao orçamento.`

  return sendText(to, text)
}

/**
 * Enviar notificação de resposta de orçamento para o cliente.
 */
export async function sendQuoteResponseNotification(
  to: string,
  providerName: string,
  total: number,
  quoteId: string,
): Promise<{ key: { id: string } } | null> {
  const text =
    `💰 *Orçamento respondido!*\n\n` +
    `👤 Prestador: ${providerName}\n` +
    `💵 Total: R$ ${total.toFixed(2)}\n` +
    `🆔 #${quoteId.slice(0, 8)}\n\n` +
    `Acesse o app para aprovar ou recusar o orçamento.`

  return sendText(to, text)
}

/**
 * Enviar notificação de nova mensagem.
 */
export async function sendNewMessageNotification(
  to: string,
  fromName: string,
  content: string,
  bookingId?: string,
): Promise<{ key: { id: string } } | null> {
  const text =
    `💬 *Nova mensagem de ${fromName}*\n\n` +
    `${content.slice(0, 200)}${content.length > 200 ? "…" : ""}\n` +
    (bookingId ? `\n📋 Agendamento: #${bookingId.slice(0, 8)}\n` : "") +
    `\nResponda pelo app Severinno.`

  return sendText(to, text)
}

/**
 * Enviar lembrete de pagamento PIX pendente.
 */
export async function sendPaymentReminderMessage(
  to: string,
  bookingId: string,
  amount: number,
  qrCode?: string,
): Promise<{ key: { id: string } } | null> {
  const text =
    `⏰ *Lembrete de Pagamento - Severinno*\n\n` +
    `📋 Agendamento: #${bookingId.slice(0, 8)}\n` +
    `💰 Valor pendente: R$ ${amount.toFixed(2)}\n\n` +
    (qrCode ? `📱 *Código PIX (copia e cola):*\n\`\`\`${qrCode}\`\`\`\n\n` : "") +
    `Garanta seu horário realizando o pagamento via PIX no app!`

  return sendText(to, text)
}

/**
 * Enviar solicitação de confirmação de conclusão do serviço para o cliente.
 */
export async function sendServiceCompletionRequest(
  to: string,
  bookingId: string,
  providerName: string,
): Promise<{ key: { id: string } } | null> {
  const text =
    `🔧 *Confirmação de Serviço - Severinno*\n\n` +
    `O prestador *${providerName}* marcou o serviço #${bookingId.slice(0, 8)} como concluído.\n\n` +
    `Por favor, acesse o app Severinno para confirmar a entrega e liberar o pagamento!`

  return sendText(to, text)
}

/**
 * Enviar solicitação de avaliação (review) para o cliente.
 */
export async function sendReviewRequest(
  to: string,
  bookingId: string,
  providerName: string,
): Promise<{ key: { id: string } } | null> {
  const text =
    `⭐ *Como foi o atendimento com ${providerName}?*\n\n` +
    `Sua opinião ajuda outros clientes a escolherem os melhores profissionais.\n` +
    `Avalie o serviço #${bookingId.slice(0, 8)} no app Severinno em menos de 1 minuto! ✨`

  return sendText(to, text)
}

/**
 * Enviar notificação de prestador a caminho com link de rastreamento ao vivo.
 */
export async function sendLiveTrackingNotification(
  to: string,
  providerName: string,
  serviceName: string,
  bookingId: string,
  trackingUrl?: string,
): Promise<{ key: { id: string } } | null> {
  const url = trackingUrl ?? `https://severinno.com.br/?view=client.bookings&tracking=${bookingId}`
  const text =
    `🚗 *Prestador a caminho!*\n\n` +
    `*${providerName}* iniciou o deslocamento para o seu atendimento de *${serviceName}*.\n\n` +
    `📍 *Acompanhe em tempo real pelo mapa:*\n` +
    `${url}\n\n` +
    `Você pode ver a rota e o tempo estimado de chegada (ETA) ao vivo.`

  return sendText(to, text)
}

/**
 * Enviar recibo de confirmação de pagamento PIX para o cliente.
 */
export async function sendPixPaymentReceiptToClient(
  to: string,
  bookingId: string,
  amount: number,
  serviceName: string,
  providerName: string,
): Promise<{ key: { id: string } } | null> {
  const text =
    `✅ *Pagamento PIX Confirmado! - Severinno*\n\n` +
    `📋 Agendamento: #${bookingId.slice(0, 8)}\n` +
    `🔧 Serviço: ${serviceName}\n` +
    `👤 Prestador: ${providerName}\n` +
    `💰 Valor pago: R$ ${amount.toFixed(2)}\n\n` +
    `🛡️ O valor está protegido pelo *Severinno Escrow* e só será liberado ao profissional após a sua confirmação de conclusão do serviço!`

  return sendText(to, text)
}

/**
 * Enviar lembrete de agendamento 24h antes para o cliente.
 */
export async function sendBookingReminder24hNotification(
  to: string,
  clientName: string,
  serviceName: string,
  providerName: string,
  scheduledDate: string,
  bookingId: string,
  address?: string,
): Promise<{ key: { id: string } } | null> {
  const text =
    `⏰ *Lembrete de Agendamento - Severinno*\n\n` +
    `Olá, ${clientName}! Lembramos que você tem um serviço agendado para amanhã:\n\n` +
    `🔧 Serviço: *${serviceName}*\n` +
    `👤 Profissional: *${providerName}*\n` +
    `📅 Data e horário: *${scheduledDate}*\n` +
    (address ? `📍 Endereço: ${address}\n` : "") +
    `🆔 #${bookingId.slice(0, 8)}\n\n` +
    `Qualquer imprevisto, você pode conversar com o profissional pelo chat do app Severinno.`

  return sendText(to, text)
}

// ---------------------------------------------------------------------------
// Instance management
// ---------------------------------------------------------------------------

/**
 * Verificar status da conexão WhatsApp.
 */
export async function getConnectionStatus(
  instanceName?: string,
): Promise<EvolutionConnectionStatus> {
  const instance = instanceName ?? getConfig().instance
  return evolutionRequest<EvolutionConnectionStatus>("GET", `/instance/connectionState/${instance}`)
}

/**
 * Obter QR code para conectar WhatsApp.
 */
export async function getQRCode(instanceName?: string): Promise<{ qrcode: string }> {
  const instance = instanceName ?? getConfig().instance
  return evolutionRequest<{ qrcode: string }>("GET", `/instance/qrcode/${instance}`)
}

/**
 * Configurar webhook da instância Evolution.
 */
export async function setWebhook(
  config: EvolutionWebhookConfig,
  instanceName?: string,
): Promise<void> {
  const instance = instanceName ?? getConfig().instance
  await evolutionRequest("POST", `/webhook/set/${instance}`, config)
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/**
 * Formatar número brasileiro para padrão Evolution (5511999999999).
 * Remove pontuação e assume DDI 55 se não informado.
 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 11) return `55${digits}` // 55 + celular com 9
  if (digits.length === 10) return `55${digits}` // 55 + celular sem 9
  if (digits.length === 13 && digits.startsWith("55")) return digits // já tem DDI
  if (digits.length === 12 && digits.startsWith("55")) return digits
  if (digits.length >= 13) return digits
  // Fallback: tenta como está
  return digits
}

/**
 * Verificar se o número de WhatsApp parece válido.
 */
export function isValidWhatsApp(phone: string | null | undefined): boolean {
  if (!phone) return false
  const digits = phone.replace(/\D/g, "")
  // Aceita: 11999999999 (BR celular), 5511999999999 (com DDI), etc.
  return digits.length >= 10 && digits.length <= 14
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const evolutionLogger = logger.child({ module: "evolution" })

export { evolutionLogger }
