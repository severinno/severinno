export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { runAbandonedQuoteRecovery } from "@/lib/abandoned-quote-recovery"
import logger from "@/lib/logger"

/**
 * GET /api/cron/recover-quotes
 *
 * Cron periódico de recuperação ativa de cotações abandonadas via WhatsApp.
 * Pode ser executado a cada 15 a 30 minutos pelo scheduler do sistema.
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
    const minAgeMinutes = searchParams.get("minAge")
      ? parseInt(searchParams.get("minAge")!, 10)
      : undefined
    const maxAgeHours = searchParams.get("maxAge")
      ? parseInt(searchParams.get("maxAge")!, 10)
      : undefined
    const antiSpamDays = searchParams.get("antiSpamDays")
      ? parseInt(searchParams.get("antiSpamDays")!, 10)
      : undefined
    const dryRun = searchParams.get("dryRun") === "true"

    const result = await runAbandonedQuoteRecovery({
      minAgeMinutes,
      maxAgeHours,
      antiSpamDays,
      dryRun,
    })

    logger.info(
      {
        resultId: result.id,
        eligible: result.totalEligible,
        recovered: result.recoveredCount,
        skippedSpam: result.skippedSpamCount,
        skippedNoPhone: result.skippedNoPhoneCount,
        failed: result.failedCount,
      },
      "[cron:recover-quotes] Execução de recuperação concluída com sucesso",
    )

    return NextResponse.json({
      ok: true,
      result,
    })
  } catch (err) {
    logger.error({ err }, "[cron:recover-quotes] Erro fatal durante recuperação de cotações")
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Erro desconhecido na recuperação de cotações",
      },
      { status: 500 },
    )
  }
}
