import logger from "./logger"
import { safeFetch } from "./safe-fetch"

export interface AlertWebhookPayload {
  severity: string
  title: string
  message: string
  metric: string
  metadata?: Record<string, unknown>
}

export async function sendAlertWebhook(alert: AlertWebhookPayload): Promise<void> {
  const isCritical =
    alert.severity.toLowerCase() === "critical" || alert.severity.toLowerCase() === "emergency"
  const emoji = isCritical ? "🔴" : "🟡"

  const discordUrl = process.env.DISCORD_WEBHOOK_URL
  const slackUrl = process.env.SLACK_WEBHOOK_URL
  const incidentUrl = process.env.INCIDENT_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN
  const telegramChatId = process.env.TELEGRAM_CHAT_ID

  if (discordUrl) {
    try {
      await safeFetch(discordUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "Severinno Alerts",
          embeds: [
            {
              title: `${emoji} ${alert.title}`,
              description: alert.message,
              color: isCritical ? 0xe74c3c : 0xf39c12,
              fields: [
                { name: "Metric", value: alert.metric, inline: true },
                ...(alert.metadata
                  ? Object.entries(alert.metadata).map(([k, v]) => ({
                      name: k,
                      value: String(v),
                      inline: true,
                    }))
                  : []),
              ],
              timestamp: new Date().toISOString(),
            },
          ],
        }),
        timeoutMs: 5_000,
        label: "discord-webhook",
      })
    } catch (e) {
      logger.warn({ err: e }, "Failed to send Discord alert")
    }
  }

  if (slackUrl) {
    try {
      await safeFetch(slackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `${emoji} *${alert.title}*\n${alert.message}\n_Metric: ${alert.metric}_`,
        }),
        timeoutMs: 5_000,
        label: "slack-webhook",
      })
    } catch (e) {
      logger.warn({ err: e }, "Failed to send Slack alert")
    }
  }

  if (telegramBotToken && telegramChatId) {
    try {
      const text = `${emoji} *${alert.title}*\n${alert.message}\n_Metric: ${alert.metric}_`
      await safeFetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text,
          parse_mode: "Markdown",
        }),
        timeoutMs: 5_000,
        label: "telegram-alert",
      })
    } catch (e) {
      logger.warn({ err: e }, "Failed to send Telegram alert")
    }
  }

  if (incidentUrl) {
    try {
      await safeFetch(incidentUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: alert.title,
          message: alert.message,
          severity: alert.severity,
          metric: alert.metric,
          metadata: alert.metadata,
          timestamp: new Date().toISOString(),
        }),
        timeoutMs: 5_000,
        label: "incident-webhook",
      })
    } catch (e) {
      logger.warn({ err: e }, "Failed to send Incident webhook alert")
    }
  }
}
