/**
 * alerting-service.ts — Real-time Multi-channel Incident Alerting Engine
 *
 * Sends formatted alert payloads to webhooks when critical events occur:
 * - High API Latency (> 250ms)
 * - Database or PostGIS connection failures
 * - Redis GEO in-memory cache degradation
 * - Fraud / Anti-Leakage detection spikes
 * - Payment / Escrow anomalies
 *
 * Supports Discord, Slack, Telegram & Generic Webhooks.
 */

import logger from "./logger"

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL" | "EMERGENCY"

export interface AlertPayload {
  title: string
  message: string
  severity: AlertSeverity
  source: string
  metadata?: Record<string, unknown>
  timestamp?: string
}

// Debounce map for outages: prevents spamming webhooks when frequent health probes (e.g. every 5s) hit an outage.
const outageDebounceMap = new Map<string, number>()
const OUTAGE_DEBOUNCE_MS = 5 * 60 * 1000 // 5 minutes

export const AlertingService = {
  /**
   * Dispatch an incident alert to configured notification webhooks
   */
  async sendAlert(alert: AlertPayload): Promise<boolean> {
    const timestamp = alert.timestamp || new Date().toISOString()
    const webhookUrl =
      process.env.ALERT_WEBHOOK_URL ||
      process.env.DISCORD_WEBHOOK_URL ||
      process.env.SLACK_WEBHOOK_URL

    const severityIcons: Record<AlertSeverity, string> = {
      INFO: "ℹ️",
      WARNING: "⚠️",
      CRITICAL: "🚨",
      EMERGENCY: "🔥",
    }

    const icon = severityIcons[alert.severity] || "⚠️"
    const formattedTitle = `${icon} [${alert.severity}] ${alert.title}`

    logger.warn({ severity: alert.severity, title: alert.title }, alert.message)

    if (!webhookUrl) {
      // In dev or without webhook configured, log to stdout/stderr
      return true
    }

    try {
      // Format payload (Discord/Slack compatible JSON)
      const payload = {
        username: "Severinno Monitor",
        avatar_url: "https://severinno.com.br/icon-512.png",
        content: `**${formattedTitle}**\n${alert.message}\n*Origem:* \`${alert.source}\` | *Hora:* \`${timestamp}\``,
        embeds: alert.metadata
          ? [
              {
                title: alert.title,
                description: alert.message,
                color:
                  alert.severity === "CRITICAL" || alert.severity === "EMERGENCY"
                    ? 0xdc2626
                    : alert.severity === "WARNING"
                      ? 0xd97706
                      : 0x059669,
                fields: Object.entries(alert.metadata).map(([k, v]) => ({
                  name: k,
                  value: String(v),
                  inline: true,
                })),
                footer: { text: "Severinno Health Sentry" },
                timestamp,
              },
            ]
          : undefined,
      }

      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000),
      })

      return res.ok
    } catch (e) {
      logger.error({ err: e }, "[ALERTING] Failed to send webhook alert")
      return false
    }
  },

  /**
   * Helper for DB / Service connection outage (debounced per service to 1 alert per 5min)
   */
  async reportOutage(serviceName: string, errorDetails: string): Promise<boolean> {
    const now = Date.now()
    const lastSent = outageDebounceMap.get(serviceName)
    if (lastSent && now - lastSent < OUTAGE_DEBOUNCE_MS) {
      logger.info(
        { serviceName, remainingMs: OUTAGE_DEBOUNCE_MS - (now - lastSent) },
        "[ALERTING] Outage report debounced (avoiding webhook spam on repetitive healthchecks)",
      )
      return true
    }
    outageDebounceMap.set(serviceName, now)

    return this.sendAlert({
      title: `Queda de Conexão: ${serviceName}`,
      message: `O serviço ${serviceName} parou de responder ou falhou nos healthchecks.\nDetalhes: ${errorDetails}`,
      severity: "CRITICAL",
      source: "HealthMonitor",
      metadata: {
        service: serviceName,
        status: "UNREACHABLE",
      },
    })
  },

  /**
   * Helper for SLA Degradation (High Latency)
   */
  async reportLatencySpike(
    endpoint: string,
    latencyMs: number,
    thresholdMs: number,
  ): Promise<boolean> {
    return this.sendAlert({
      title: `Pico de Latência Detectado`,
      message: `A rota ${endpoint} registrou latência de ${latencyMs}ms (limite de SLA: ${thresholdMs}ms).`,
      severity: "WARNING",
      source: "LatencyProbe",
      metadata: {
        endpoint,
        latencyMs,
        thresholdMs,
      },
    })
  },

  /**
   * Helper for Fraud Detection Spike
   */
  async reportFraudAttempt(
    bookingId: string,
    senderId: string,
    matchedPatterns: string[],
  ): Promise<boolean> {
    return this.sendAlert({
      title: `Tentativa de Desintermediação Bloqueada`,
      message: `Mensagem no chat do agendamento #${bookingId} continha padrões de pagamento por fora.`,
      severity: "INFO",
      source: "AntiFraudLeakDetector",
      metadata: {
        bookingId,
        senderId,
        patterns: matchedPatterns.join(", "),
      },
    })
  },
}
