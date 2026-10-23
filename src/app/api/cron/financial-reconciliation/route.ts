export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { runFinancialReconciliationAudit } from "@/lib/financial-reconciliation"

/**
 * Cron Job: Reconciliação Contábil Noturna do Ledger (Lytex Settlement Audit).
 *
 * GET /api/cron/financial-reconciliation
 * Authorization: Bearer CRON_SECRET
 */
export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = request.headers.get("authorization")

    // Validação estrita do token bearer
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const windowHours = parseInt(searchParams.get("hours") || "48", 10)
    const autoRepair = searchParams.get("repair") !== "false"

    const report = await runFinancialReconciliationAudit({
      windowHours,
      autoRepair,
      dispatchAlerts: true,
    })

    return NextResponse.json({
      success: true,
      report,
    })
  } catch (err) {
    return NextResponse.json(
      { error: "Erro interno na reconciliação financeira", details: (err as Error).message },
      { status: 500 },
    )
  }
}
