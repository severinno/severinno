import logger from "./logger"
import { safeFetch } from "./safe-fetch"

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL

export async function sendAlertWebhook(alert: {
  severity: string
  title: string
  message: string
  metric: string
}): Promise<void> {
  const emoji = alert.severity === "critical" ? "🔴" : "🟡"

  if (DISCORD_WEBHOOK_URL) {
    try {
      await safeFetch(DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "Severinno Alerts",
          embeds: [{
            title: `${emoji} ${alert.title}`,
            description: alert.message,
            color: alert.severity === "critical" ? 0xe74c3c : 0xf39c12,
            fields: [{ name: "Metric", value: alert.metric, inline: true }],
            timestamp: new Date().toISOString(),
          }],
        }),
        timeoutMs: 5_000,
        label: "discord-webhook",
      })
    } catch (e) {
      logger.warn({ err: e }, "Failed to send Discord alert")
    }
  }

  if (SLACK_WEBHOOK_URL) {
    try {
      await safeFetch(SLACK_WEBHOOK_URL, {
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
}
