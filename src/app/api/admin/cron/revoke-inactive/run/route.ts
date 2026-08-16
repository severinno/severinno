import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { runRevokeInactiveScan } from "@/lib/revoke-inactive-scan"
import { handleError } from "@/lib/api-server"

/**
 * POST /api/admin/cron/revoke-inactive/run
 *
 * Dispara a varredura de revogação de sessões inativas AGORA, pelo painel
 * admin. Usa o MESMO motor do cron (src/lib/revoke-inactive-scan.ts) e
 * registra a execução no mesmo audit trail (revoke-run-audit.ts), com
 * source="admin".
 *
 * DRY-RUN POR PADRÃO: sem query param, roda ?dryRun=1 (não revoga nada —
 * apenas conta o que seria revogado). Para executar a revogação de verdade,
 * chame ?dryRun=0 (ação destrutiva: desconecta sockets de contas inativas).
 *
 * Diferente do cron, NÃO respeita o cooldown Redis (bypassCooldown=true):
 * o admin pediu explicitamente, então a varredura roda mesmo se o cron
 * rodou há pouco.
 *
 * ADMIN-only.
 */

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireRole("ADMIN")

    const url = new URL(request.url)
    // dryRun default TRUE (seguro). Só executa de verdade com ?dryRun=0.
    const dryRun = url.searchParams.get("dryRun") !== "0"

    const result = await runRevokeInactiveScan({ dryRun, source: "admin", bypassCooldown: true })
    return NextResponse.json(result)
  } catch (e) {
    const err = handleError(e) as NextResponse<unknown>
    return err as NextResponse<unknown>
  }
}
