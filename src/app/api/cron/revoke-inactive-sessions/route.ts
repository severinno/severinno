import { NextResponse } from "next/server"
import { runRevokeInactiveScan } from "@/lib/revoke-inactive-scan"
import logger from "@/lib/logger"
import { handleError } from "@/lib/api-server"

// Re-export do batch puro (usado pelos testes unitários da varredura).
export { revokeInactiveSessionsBatch } from "@/lib/revoke-inactive-scan"

/**
 * GET /api/cron/revoke-inactive-sessions
 *
 * Varredura em lote que revoga os sockets realtime de usuários inativos,
 * evitando que contas desativadas/soft-deleted mantenham sessões vivas no
 * mini-service.
 *
 * Auth: Bearer CRON_SECRET (mesmo padrão dos outros crons). Sem token
 * configurado, o check de auth é pulado com warning.
 * Params: ?dryRun=1 reporta sem emitir nada.
 *
 * A lógica de varredura (lote + cursor + pool de concorrência + cooldown +
 * audit trail) vive em src/lib/revoke-inactive-scan.ts, compartilhada com o
 * disparo manual do painel admin (POST /api/admin/cron/revoke-inactive/run).
 *
 * Resposta: { ok, dryRun, scanned, revoked, failed, elapsedMs, threshold }
 * Audit: entrada no worklog.md + resumo no Sentry + registro em
 * cron:revoke-inactive:runs (revoke-run-audit.ts).
 */

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    // ── Auth (mesmo padrão dos outros crons) ──────────────────────────
    const auth = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET ?? ""
    if (!cronSecret) {
      logger.warn("revoke-inactive-sessions: CRON_SECRET not configured — skipping auth check")
    } else if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const url = new URL(request.url)
    const dryRun = url.searchParams.get("dryRun") === "1"

    const result = await runRevokeInactiveScan({ dryRun, source: "cron" })
    return NextResponse.json(result)
  } catch (e) {
    return handleError(e)
  }
}
