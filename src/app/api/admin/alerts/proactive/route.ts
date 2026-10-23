export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import { getSession } from "@/lib/auth"
import { badRequest, unauthorized } from "@/lib/api-server"
import {
  dispatchProactiveAlert,
  getProactiveAlertHistory,
  type AlertCategory,
  type AlertSeverity,
} from "@/lib/proactive-alert-dispatcher"

function isAuthorized(request: Request, sessionUserRole?: string): boolean {
  if (sessionUserRole === "ADMIN") return true

  const adminKey = request.headers.get("x-admin-key")
  const cronSecret = request.headers.get("x-cron-secret")
  const validSecret = process.env.CRON_SECRET || process.env.ADMIN_SECRET_KEY

  if (validSecret && (adminKey === validSecret || cronSecret === validSecret)) {
    return true
  }

  return false
}

export const GET = withRoute("api.admin.alerts.proactive.GET", async (request) => {
  const session = await getSession()
  if (!isAuthorized(request, session?.role)) {
    throw unauthorized("Não autorizado")
  }

  const history = getProactiveAlertHistory()
  const channels = {
    whatsappConfigured: Boolean(process.env.EVOLUTION_API_KEY || process.env.WHATSAPP_API_KEY),
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    webhookConfigured: Boolean(process.env.ALERT_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL),
  }

  return NextResponse.json({
    status: "ok",
    channels,
    recentAlerts: history,
    count: history.length,
  })
})

export const POST = withRoute("api.admin.alerts.proactive.POST", async (request) => {
  const session = await getSession()
  if (!isAuthorized(request, session?.role)) {
    throw unauthorized("Não autorizado")
  }

  const body = await request.json()
  const {
    category = "CUSTOM",
    severity = "INFO",
    title,
    message,
    metric,
    metadata,
    recipientPhone,
    recipientChatId,
    force = false,
  } = body

  if (!title || !message) {
    throw badRequest("Os campos 'title' e 'message' são obrigatórios")
  }

  const result = await dispatchProactiveAlert(
    {
      category: category as AlertCategory,
      severity: severity as AlertSeverity,
      title,
      message,
      metric,
      metadata,
      recipientPhone,
      recipientChatId,
    },
    { force },
  )

  return NextResponse.json({
    success: result.dispatched,
    result,
  })
})
