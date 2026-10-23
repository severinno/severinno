export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { runPixReconciliation } from "@/lib/pix-reconciliation"
import logger from "@/lib/logger"

/**
 * GET /api/cron/reconcile-pix
 *
 * Cron de fechamento diário D+1 para conciliação contábil do PIX e Gateway Lytex.
 * Executado preferencialmente na madrugada (ex: 03:30) pelo scheduler do sistema.
 *
 * Headers:
 *   Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = request.headers.get("authorization")

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const lookbackHours = searchParams.get("lookback")
      ? parseInt(searchParams.get("lookback")!, 10)
      : 24
    const autoHeal = searchParams.get("autoHeal") !== "false"

    const report = await runPixReconciliation({
      lookbackHours,
      autoHeal,
    })

    logger.info(
      {
        reportId: report.id,
        status: report.status,
        audited: report.totalAudited,
        discrepancies: report.discrepanciesCount,
        autoHealed: report.autoHealedCount,
      },
      "[cron:reconcile-pix] Relatório de conciliação diária gerado com sucesso",
    )

    return NextResponse.json({
      ok: true,
      report,
    })
  } catch (err) {
    logger.error({ err }, "[cron:reconcile-pix] Erro fatal durante rotina de conciliação")
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Erro desconhecido na conciliação",
      },
      { status: 500 },
    )
  }
}
