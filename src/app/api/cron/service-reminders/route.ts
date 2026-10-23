export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import {
  identifyDueServiceReminders,
  formatRebookingInvitation,
  dispatchServiceReminders,
} from "@/lib/smart-service-reminders"
import logger from "@/lib/logger"

/**
 * GET /api/cron/service-reminders
 *
 * Cron diário para varredura e disparo de lembretes preventivos de manutenção
 * (LTV Booster & Reagendamento com o mesmo prestador via WhatsApp + Push).
 *
 * Query params opcionais:
 * - dryRun=true (apenas simula sem enviar)
 * - limit=50 (máximo de disparos por lote)
 *
 * Requer Bearer token correspondente ao CRON_SECRET.
 */
export const GET = withRoute("api.cron.service-reminders.GET", async (req: Request) => {
  const authHeader = req.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const dryRun = searchParams.get("dryRun") === "true"
  const limitParam = searchParams.get("limit")
  const limit = limitParam ? parseInt(limitParam, 10) : 50

  const candidates = await identifyDueServiceReminders()
  const previews = candidates.slice(0, 50).map((c) => ({
    client: c.clientName,
    provider: c.providerName,
    service: c.serviceTitle,
    daysSince: c.daysSinceCompleted,
    invitation: formatRebookingInvitation(c),
  }))

  let dispatchResult = null
  if (typeof dispatchServiceReminders === "function") {
    try {
      dispatchResult = await dispatchServiceReminders({ dryRun, limit })
      logger.info(
        {
          eligible: dispatchResult.totalEligible,
          sentWhatsApp: dispatchResult.sentWhatsApp,
          sentPush: dispatchResult.sentPush,
          skippedDedup: dispatchResult.skippedDedup,
          failed: dispatchResult.failed,
          dryRun,
        },
        "[cron:service-reminders] Disparo de retenção preventiva concluído",
      )
    } catch (err) {
      logger.warn({ err }, "[cron:service-reminders] Falha no disparo de lembretes preventivos")
    }
  }

  return NextResponse.json({
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    totalDueCandidates: candidates.length,
    previews,
    dispatch: dispatchResult,
  })
})
