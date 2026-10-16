export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import {
  identifyDueServiceReminders,
  formatRebookingInvitation,
} from "@/lib/smart-service-reminders"

/**
 * GET /api/cron/service-reminders
 *
 * Cron diário para varredura e disparo de lembretes preventivos de manutenção
 * (LTV Booster & Reagendamento com o mesmo prestador).
 *
 * Requer Bearer token correspondente ao CRON_SECRET.
 */
export const GET = withRoute("api.cron.service-reminders.GET", async (req: Request) => {
  const authHeader = req.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const candidates = await identifyDueServiceReminders()
  const previews = candidates.slice(0, 50).map((c) => ({
    client: c.clientName,
    provider: c.providerName,
    service: c.serviceTitle,
    daysSince: c.daysSinceCompleted,
    invitation: formatRebookingInvitation(c),
  }))

  return NextResponse.json({
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    totalDueCandidates: candidates.length,
    previews,
  })
})
