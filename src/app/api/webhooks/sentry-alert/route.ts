export const dynamic = "force-dynamic"

/**
 * POST /api/webhooks/sentry-alert — Recebe alertas do GlitchTip/Sentry e encaminha
 *
 * Este endpoint funciona como webhook de destino para os alertas do GlitchTip:
 *   - GlitchTip detecta erro crítico → dispara regra de alerta → faz POST aqui
 *   - Este handler formata a mensagem e envia para Discord + Telegram
 *
 * ── Configuração no GlitchTip (via UI) ───────────────────────────────────
 * 1. Acesse: Organização > Projetos > [Severinno] > Settings > Project Alerts
 * 2. Crie as regras de alerta recomendadas (abaixo)
 * 3. Em "Add An Alert Recipient", escolha "Webhook"
 * 4. URL: https://severinno.com.br/api/webhooks/sentry-alert
 *
 * ── Regras de alerta recomendadas ────────────────────────────────────────
 *   A. "Erros 5xx"     — 1 ocorrência em 5 minutos (nível: error ou fatal)
 *   B. "Unhandled"     — 1 ocorrência em 5 minutos (tags: source=unhandledRejection|uncaughtException)
 *   C. "Alta taxa"     — 10+ erros em 5 minutos
 *   D. "Queda de performance" — P95 > 5s em 10 minutos (se APM ativo)
 *
 * ── Variáveis de ambiente necessárias ────────────────────────────────────
 *   DISCORD_WEBHOOK_URL=      (opcional) URL do webhook do Discord
 *   TELEGRAM_BOT_TOKEN=       (opcional) Token do bot do Telegram
 *   TELEGRAM_CHAT_ID=         (opcional) Chat ID do grupo/canal no Telegram
 *   SENTRY_ALERT_SECRET=      (opcional) Token secreto para validar a origem
 *
 * ── Formato do payload recebido (Sentry webhook) ─────────────────────────
 *   {
 *     "action": "triggered",
 *     "data": { "event": { ... }, "triggered_rule": { ... } },
 *     "installation": { ... },
 *     "actor": { "type": "application", ... }
 *   }
 */

import { NextRequest, NextResponse } from "next/server"
import logger from "@/lib/logger"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

// ── Types ─────────────────────────────────────────────────────────────────

interface SentryWebhookPayload {
  action: "triggered" | "resolved"
  data: {
    event?: {
      event_id?: string
      level?: string
      message?: string
      culprit?: string
      url?: string
      logger?: string
      tags?: Array<[string, string]>
      exception?: {
        values?: Array<{
          type?: string
          value?: string
          mechanism?: { type?: string }
        }>
      }
      request?: {
        url?: string
        method?: string
      }
      metadata?: {
        title?: string
        value?: string
        filename?: string
        type?: string
      }
    }
    triggered_rule?: {
      id?: string
      name?: string
    }
  }
  installation?: {
    uuid?: string
  }
  actor?: {
    type?: string
    id?: string
    name?: string
  }
}

interface AlertMessage {
  title: string
  description: string
  level: string
  project: string
  environment: string
  timestamp: string
  url?: string
  culprit?: string
  ruleName?: string
  tags: Array<[string, string]>
}

// ── Helpers de formatação ────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

// ── Formatação ────────────────────────────────────────────────────────────

const LEVEL_EMOJI: Record<string, string> = {
  fatal: "🔥",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
  debug: "🔍",
  default: "🔔",
}

function getLevelEmoji(level?: string): string {
  return LEVEL_EMOJI[level?.toLowerCase() ?? "default"] ?? LEVEL_EMOJI.default
}

function getLevelColor(level?: string): number {
  switch (level?.toLowerCase()) {
    case "fatal":
      return 0xe74c3c // red
    case "error":
      return 0xf39c12 // orange
    case "warning":
      return 0xf1c40f // yellow
    case "info":
      return 0x3498db // blue
    default:
      return 0x95a5a6 // gray
  }
}

function formatMessage(payload: SentryWebhookPayload, projectName: string): AlertMessage {
  const event = payload.data?.event
  const rule = payload.data?.triggered_rule
  const tags = event?.tags ?? []

  const title =
    event?.metadata?.title ??
    event?.exception?.values?.[0]?.type ??
    event?.message ??
    "Erro desconhecido"

  const description =
    event?.exception?.values?.[0]?.value ??
    event?.metadata?.value ??
    event?.culprit ??
    "Sem detalhes adicionais"

  return {
    title: title.slice(0, 200),
    description: description.slice(0, 500),
    level: event?.level ?? "error",
    project: projectName,
    environment: tags.find(([k]) => k === "environment")?.[1] ?? process.env.NODE_ENV ?? "unknown",
    timestamp: new Date().toISOString(),
    url: event?.url ?? event?.request?.url,
    culprit: event?.culprit,
    ruleName: rule?.name,
    tags,
  }
}

// ── Discord ───────────────────────────────────────────────────────────────

async function sendDiscord(msg: AlertMessage): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL
  if (!webhookUrl) {
    logger.debug("[sentry-alert] DISCORD_WEBHOOK_URL não configurado — pulando Discord")
    return
  }

  const emoji = getLevelEmoji(msg.level)
  const color = getLevelColor(msg.level)

  const fields: Array<{ name: string; value: string; inline?: boolean }> = []

  if (msg.culprit) {
    fields.push({ name: "📍 Origem", value: `\`${msg.culprit.slice(0, 200)}\``, inline: false })
  }
  if (msg.url) {
    fields.push({ name: "🔗 URL", value: msg.url.slice(0, 200), inline: true })
  }
  if (msg.environment) {
    fields.push({ name: "🌍 Ambiente", value: `\`${msg.environment}\``, inline: true })
  }
  if (msg.ruleName) {
    fields.push({ name: "📋 Regra", value: msg.ruleName, inline: true })
  }

  // Extrair tags relevantes
  const relevantTags = msg.tags.filter(([k]) =>
    ["source", "type", "endpoint", "userId"].includes(k),
  )
  for (const [k, v] of relevantTags) {
    fields.push({ name: `🏷️ ${k}`, value: `\`${v.slice(0, 100)}\``, inline: true })
  }

  const payload = {
    username: "Severinno Alertas",
    avatar_url: "https://severinno.com.br/icon-192.png",
    embeds: [
      {
        title: `${emoji} ${msg.title}`,
        description: msg.description.length > 0 ? `\`\`\`\n${msg.description}\n\`\`\`` : undefined,
        color,
        fields,
        footer: {
          text: `${msg.project} • ${new Date(msg.timestamp).toLocaleString("pt-BR")}`,
        },
        timestamp: msg.timestamp,
      },
    ],
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    logger.error(
      { status: res.status, response: text.slice(0, 200) },
      "[sentry-alert] Discord webhook failed",
    )
  } else {
    logger.info("[sentry-alert] Discord alert sent")
  }
}

// ── Telegram ──────────────────────────────────────────────────────────────

async function sendTelegram(msg: AlertMessage): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!token || !chatId) {
    logger.debug(
      "[sentry-alert] TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurados — pulando Telegram",
    )
    return
  }

  const emoji = getLevelEmoji(msg.level)
  const lines: string[] = [
    `${emoji} <b>${escapeHtml(msg.title)}</b>`,
    "",
    msg.description ? `<code>${escapeHtml(msg.description)}</code>` : "",
    "",
    `🌍 Ambiente: <code>${escapeHtml(msg.environment)}</code>`,
    msg.culprit ? `📍 Origem: <code>${escapeHtml(msg.culprit)}</code>` : "",
    msg.url ? `🔗 URL: ${escapeHtml(msg.url)}` : "",
    msg.ruleName ? `📋 Regra: ${escapeHtml(msg.ruleName)}` : "",
    "",
    `📅 ${new Date(msg.timestamp).toLocaleString("pt-BR")}`,
    `🏷️ ${escapeHtml(msg.project)}`,
  ]

  const text = lines.filter(Boolean).join("\n").slice(0, 4096) // Telegram limit

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    logger.error({ status: res.status, telegramError: body }, "[sentry-alert] Telegram send failed")
  } else {
    logger.info("[sentry-alert] Telegram alert sent")
  }
}

// ── Validação de origem ──────────────────────────────────────────────────

function isAuthorized(request: NextRequest, body: string): boolean {
  const secret = process.env.SENTRY_ALERT_SECRET
  if (!secret) {
    // In production, reject if secret is not configured
    if (process.env.NODE_ENV === "production") return false
    return true // dev: accept any origin
  }

  // Verifica header Authorization
  const auth = request.headers.get("authorization")
  if (auth === `Bearer ${secret}`) return true

  // Verifica token no corpo (caso o webhook do GlitchTip envie no payload)
  try {
    const parsed = JSON.parse(body)
    if (parsed?.secret === secret || parsed?.token === secret) return true
  } catch {
    // não-JSON
  }

  return false
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  await assertRateLimit(request, RATE_LIMITS.webhookSentry)
  const projectName = process.env.SENTRY_PROJECT_NAME ?? "Severinno"

  try {
    const body = await request.text()

    if (!isAuthorized(request, body)) {
      logger.warn("[sentry-alert] webhook recebido de origem não autorizada")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payload: SentryWebhookPayload = JSON.parse(body)
    logger.info(
      { action: payload.action, rule: payload.data?.triggered_rule?.name },
      "[sentry-alert] webhook recebido",
    )

    if (payload.action === "triggered") {
      const msg = formatMessage(payload, projectName)

      // Dispara para todos os canais configurados em paralelo
      const dispatches: Promise<void>[] = []
      dispatches.push(sendDiscord(msg))
      dispatches.push(sendTelegram(msg))

      const results = await Promise.allSettled(dispatches)
      const failed = results.filter((r) => r.status === "rejected")
      if (failed.length > 0) {
        logger.error({ failed: failed.length }, "[sentry-alert] alguns canais falharam")
      }
    }

    // Sempre retorna 200 para evitar reenvio do GlitchTip
    return NextResponse.json({ received: true })
  } catch (err) {
    logger.error({ err }, "[sentry-alert] erro ao processar webhook")
    return NextResponse.json({ received: true })
  }
}
