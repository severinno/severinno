/**
 * proactive-alert-dispatcher.ts — Central de Alertas Proativos em Tempo Real
 *
 * Dispara notificações imediatas para canais operacionais (WhatsApp via Evolution API,
 * Telegram Bot, Discord e Webhooks) sobre eventos críticos do sistema:
 * - Pressão de armazenamento em disco da VPS
 * - Falhas em transações de custódia / split financeiro Pix
 * - Disparo de Circuit Breakers (Lytex, OSRM, Evolution)
 * - Reinicialização inesperada de contêineres Docker
 * - Anomalias de segurança e desintermediação
 */

import { safeFetch } from "./safe-fetch"
import logger from "./logger"

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL" | "EMERGENCY"

export type AlertCategory =
  | "DISK_PRESSURE"
  | "ESCROW_ANOMALY"
  | "PAYMENT_FAILURE"
  | "CIRCUIT_BREAKER_TRIPPED"
  | "SYSTEM_RESTART"
  | "SECURITY_ALERT"
  | "CUSTOM"

export interface ProactiveAlertPayload {
  category: AlertCategory
  severity: AlertSeverity
  title: string
  message: string
  metric?: string
  metadata?: Record<string, unknown>
  recipientPhone?: string
  recipientChatId?: string
}

export interface DispatchResult {
  dispatched: boolean
  channels: {
    whatsapp: boolean
    telegram: boolean
    webhook: boolean
  }
  debounced: boolean
  timestamp: string
  error?: string
}

export interface StoredAlertLog {
  id: string
  category: AlertCategory
  severity: AlertSeverity
  title: string
  message: string
  metric?: string
  timestamp: string
  channelsSent: string[]
}

// Histórico recente em memória para consulta da Torre de Controle / Admin
const alertHistory: StoredAlertLog[] = []
const MAX_HISTORY = 100

// Registro de debounce para evitar tempestade de notificações (5 minutos por categoria)
const lastAlertTimestampByCategory = new Map<AlertCategory, number>()
const DEBOUNCE_WINDOW_MS = 5 * 60 * 1000

/**
 * Retorna o emoji visual apropriado para a severidade do alerta.
 */
export function getSeverityEmoji(severity: AlertSeverity): string {
  switch (severity) {
    case "INFO":
      return "ℹ️"
    case "WARNING":
      return "⚠️"
    case "CRITICAL":
      return "🚨"
    case "EMERGENCY":
      return "🛑"
  }
}

/**
 * Formata o texto final com layout otimizado para leitura móvel no WhatsApp e Telegram.
 */
export function formatProactiveAlertMessage(alert: ProactiveAlertPayload): string {
  const emoji = getSeverityEmoji(alert.severity)
  const env = process.env.NODE_ENV || "production"
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })

  let text = `${emoji} *[SEVERINNO OPS] ${alert.severity}*\n`
  text += `*${alert.title}*\n\n`
  text += `${alert.message}\n`

  if (alert.metric) {
    text += `\n📊 *Métrica:* \`${alert.metric}\``
  }

  if (alert.metadata && Object.keys(alert.metadata).length > 0) {
    text += `\n📋 *Detalhes Técnicos:*\n`
    for (const [key, val] of Object.entries(alert.metadata)) {
      text += `  • *${key}:* ${typeof val === "object" ? JSON.stringify(val) : String(val)}\n`
    }
  }

  text += `\n⏰ *Horário:* ${now} | *Ambiente:* ${env.toUpperCase()}`
  return text
}

/**
 * Dispara alerta via WhatsApp utilizando a instância local da Evolution API.
 */
async function sendWhatsAppAlert(
  phone: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  const evolutionUrl =
    process.env.EVOLUTION_API_URL || process.env.WHATSAPP_API_URL || "http://evolution-api:8080"
  const apiKey = process.env.EVOLUTION_API_KEY || process.env.WHATSAPP_API_KEY || ""
  const instance = process.env.EVOLUTION_INSTANCE || "severinno"

  if (!apiKey) {
    return { success: false, error: "EVOLUTION_API_KEY não configurada" }
  }

  // Normaliza o telefone para formato limpo (DDI + DDD + número)
  const cleanPhone = phone.replace(/\D/g, "")
  if (cleanPhone.length < 10) {
    return { success: false, error: "Número de WhatsApp inválido" }
  }

  const endpoint = `${evolutionUrl}/message/sendText/${instance}`

  try {
    const res = await safeFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
      },
      body: JSON.stringify({
        number: cleanPhone,
        text: message,
      }),
      timeoutMs: 6_000,
      label: "evolution-proactive-alert",
    })

    return { success: res.ok }
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : "Erro desconhecido ao chamar Evolution API"
    logger.warn({ err }, "Falha ao enviar alerta WhatsApp via Evolution API")
    return { success: false, error: errorMsg }
  }
}

/**
 * Dispara alerta via Telegram Bot API nativa.
 */
async function sendTelegramAlert(
  chatId: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken || !chatId) {
    return { success: false, error: "TELEGRAM_BOT_TOKEN ou CHAT_ID não configurados" }
  }

  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`

  try {
    const res = await safeFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
      timeoutMs: 6_000,
      label: "telegram-proactive-alert",
    })

    return { success: res.ok }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Erro desconhecido ao chamar Telegram API"
    logger.warn({ err }, "Falha ao enviar alerta Telegram")
    return { success: false, error: errorMsg }
  }
}

/**
 * Dispara alerta proativo multi-canal com controle de debounce e auditoria em memória.
 */
export async function dispatchProactiveAlert(
  alert: ProactiveAlertPayload,
  options: { force?: boolean } = {},
): Promise<DispatchResult> {
  const now = Date.now()
  const lastSent = lastAlertTimestampByCategory.get(alert.category) || 0

  // Alertas de EMERGÊNCIA e CRITICAL pulam o debounce, ou quando forçado manualmente
  const isHighSeverity = alert.severity === "CRITICAL" || alert.severity === "EMERGENCY"
  if (!options.force && !isHighSeverity && now - lastSent < DEBOUNCE_WINDOW_MS) {
    return {
      dispatched: false,
      channels: { whatsapp: false, telegram: false, webhook: false },
      debounced: true,
      timestamp: new Date().toISOString(),
    }
  }

  lastAlertTimestampByCategory.set(alert.category, now)
  const formattedText = formatProactiveAlertMessage(alert)

  const channels = {
    whatsapp: false,
    telegram: false,
    webhook: false,
  }

  const channelsSentList: string[] = []

  // 1. WhatsApp
  const targetPhone =
    alert.recipientPhone ||
    process.env.OPS_WHATSAPP_NUMBER ||
    process.env.ADMIN_WHATSAPP ||
    process.env.ADMIN_PHONE
  if (targetPhone) {
    const waRes = await sendWhatsAppAlert(targetPhone, formattedText)
    if (waRes.success) {
      channels.whatsapp = true
      channelsSentList.push("whatsapp")
    }
  }

  // 2. Telegram
  const targetChatId = alert.recipientChatId || process.env.TELEGRAM_CHAT_ID
  if (targetChatId && process.env.TELEGRAM_BOT_TOKEN) {
    const tgRes = await sendTelegramAlert(targetChatId, formattedText)
    if (tgRes.success) {
      channels.telegram = true
      channelsSentList.push("telegram")
    }
  }

  // 3. Fallback Webhook (Discord / Slack)
  const webhookUrl = process.env.ALERT_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL
  if (webhookUrl) {
    try {
      const res = await safeFetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: formattedText }),
        timeoutMs: 5_000,
        label: "generic-alert-webhook",
      })
      if (res.ok) {
        channels.webhook = true
        channelsSentList.push("webhook")
      }
    } catch {
      // Ignora falha secundária de webhook
    }
  }

  // Registra no histórico em memória
  const logItem: StoredAlertLog = {
    id: `alt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    category: alert.category,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    metric: alert.metric,
    timestamp: new Date().toISOString(),
    channelsSent: channelsSentList,
  }

  alertHistory.unshift(logItem)
  if (alertHistory.length > MAX_HISTORY) {
    alertHistory.pop()
  }

  return {
    dispatched: channelsSentList.length > 0,
    channels,
    debounced: false,
    timestamp: logItem.timestamp,
  }
}

/**
 * Retorna os últimos alertas disparados.
 */
export function getProactiveAlertHistory(): StoredAlertLog[] {
  return [...alertHistory]
}

/**
 * Limpa o histórico de alertas (utilizado para testes unitários).
 */
export function clearProactiveAlertHistory(): void {
  alertHistory.length = 0
  lastAlertTimestampByCategory.clear()
}
