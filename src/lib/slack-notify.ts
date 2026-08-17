/**
 * slack-notify.ts
 *
 * Send formatted messages to a Slack channel via webhook URL.
 *
 * Usage:
 *   import { sendSlackAlert } from "@/lib/slack-notify"
 *   await sendSlackAlert({
 *     title: "P95 Degradado",
 *     body: "PostGIS P95 ultrapassou 2× baseline...",
 *     severity: "error",
 *     fields: { Service: "postgis", P95: "250ms", Baseline: "30ms" },
 *     url: "/admin/geo-metrics",
 *   })
 *
 * Requires SLACK_WEBHOOK_URL env var to be set. When the env var is
 * missing, sendSlackAlert silently returns false without throwing.
 *
 * When a relative `url` is provided (e.g. "/admin/geo-metrics"), the button
 * link is automatically prefixed with NEXT_PUBLIC_APP_URL (or the default
 * "https://severinno.com.br") so that Slack renders a clickable button.
 */

import "server-only"
import { env } from "@/lib/env"
import logger from "@/lib/logger"
import { envTimeoutSignal } from "@/lib/fetch-timeout"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SlackAlertPayload = {
  /** Short title (bold text at the top). */
  title: string
  /** Body text (rendered below the title). */
  body: string
  /** Severity — changes the emoji prefix and optional color indicator. */
  severity: "info" | "warning" | "error"
  /** Optional key-value fields rendered in a compact table. */
  fields?: Record<string, string>
  /** Optional deep-link URL. When provided, a "Ver no dashboard" button is added. */
  url?: string
  /** Source identifier (e.g. "geo-performance-alert"). */
  source: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Emoji prefix per severity. */
function severityEmoji(severity: string): string {
  switch (severity) {
    case "error":
      return "🛑"
    case "warning":
      return "⚠️"
    default:
      return "ℹ️"
  }
}

/** Slack hex color for the sidebar accent stripe. */
function severityColor(severity: string): string {
  switch (severity) {
    case "error":
      return "#EF4444" // red-500
    case "warning":
      return "#F59E0B" // amber-500
    default:
      return "#3B82F6" // blue-500
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Send a structured alert to the configured Slack webhook.
 *
 * Builds a Slack Blocks payload with:
 *   - Header section (emoji + title)
 *   - Body text section
 *   - Fields section (when `fields` is provided)
 *   - Button section (when `url` is provided)
 *   - Context footer (source name)
 *
 * @returns `true` if the webhook returned 200 OK, `false` otherwise
 *          (including when SLACK_WEBHOOK_URL is not configured).
 */
export async function sendSlackAlert(payload: SlackAlertPayload): Promise<boolean> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL?.trim()

  if (!webhookUrl) {
    logger.debug("slack-notify: SLACK_WEBHOOK_URL not configured — skipping")
    return false
  }

  const { title, body, severity, fields, url, source } = payload
  const emoji = severityEmoji(severity)
  const color = severityColor(severity)

  // Build Slack Blocks
  const blocks: Array<Record<string, unknown>> = [
    // Header
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} ${title}`,
        emoji: true,
      },
    },
    // Body
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: body,
      },
    },
  ]

  // Fields (compact key-value pairs, up to 2 per row)
  if (fields && Object.keys(fields).length > 0) {
    blocks.push({
      type: "section",
      fields: Object.entries(fields).map(([key, value]) => ({
        type: "mrkdwn",
        text: `*${key}:* ${value}`,
      })),
    })
  }

  // URL button — Slack requires absolute URLs, so prefix with APP_BASE_URL
  // when a relative path is given.
  if (url) {
    const absoluteUrl = url.startsWith("http")
      ? url
      : `${env?.NEXT_PUBLIC_APP_URL || "https://severinno.com.br"}${url.startsWith("/") ? "" : "/"}${url}`

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "🔍 Ver no dashboard",
            emoji: true,
          },
          url: absoluteUrl,
          action_id: "open_dashboard",
        },
      ],
    })
  }

  // Context footer
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `*Fonte:* \`${source}\` · ${new Date().toLocaleString("pt-BR")}`,
      },
    ],
  })

  // Build the full payload
  const payloadJson = {
    attachments: [
      {
        color,
        blocks,
        mrkdwn_in: ["text", "fields"],
      },
    ],
  }

  // Send via fetch (no external dependencies)
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadJson),
      signal: envTimeoutSignal("SLACK_TIMEOUT_MS", 10_000),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error")
      logger.error(
        { status: response.status, error: errorText },
        "slack-notify: webhook returned error",
      )
      return false
    }

    logger.debug(
      { status: response.status, source, severity },
      "slack-notify: alert sent successfully",
    )
    return true
  } catch (err) {
    logger.error({ err }, "slack-notify: failed to send webhook")
    return false
  }
}
