import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { listRevokeRuns } from "@/lib/revoke-run-audit"
import { handleError } from "@/lib/api-server"

/**
 * GET /api/admin/cron/revoke-inactive/runs
 *
 * Audit trail das execuções do cron de revogação de sessões inativas:
 * lista os últimos runs (mais recente primeiro, bounded em 50) persistidos
 * em Redis (cron:revoke-inactive:runs) pelo cron agendado e pelos disparos
 * manuais deste painel.
 *
 * ADMIN-only. Degrada para { runs: [] } se o Redis estiver indisponível —
 * o painel nunca quebra por causa do audit.
 */

export async function GET(): Promise<NextResponse> {
  try {
    await requireRole("ADMIN")
    const runs = await listRevokeRuns(50)
    return NextResponse.json({ ok: true, runs })
  } catch (e) {
    const err = handleError(e) as NextResponse<unknown>
    return err as NextResponse<{ ok: boolean; runs: unknown[] }>
  }
}
