import { NextResponse } from "next/server"
import { runRealtimeOrphanAlert } from "@/lib/realtime-orphan-alert"
import logger from "@/lib/logger"
import { handleError } from "@/lib/api-server"

// Re-export dos helpers puros (usados pelos testes unitários).
export {
  readOrphanPersistence,
  buildMultiBucketKey,
  parseOrphanAlertMinutes,
  parseOrphanAlertCooldownMs,
} from "@/lib/realtime-orphan-alert"

/**
 * GET /api/cron/realtime-orphan-alert
 *
 * Job de alerta operacional de sockets órfãos PERSISTIDOS. Lê a flag
 * `realtime:telemetry:multi:flag` (STRing "1") que o mini-service realtime
 * grava no Redis sempre que usersWithMultipleSockets > 0 e confirma a
 * persistência lendo os N buckets de minuto (`realtime:telemetry:multi:{bucket}`):
 * o alerta (GlitchTip/Sentry + email para ADMIN_EMAIL) dispara somente quando a
 * flag está ativa AGORA E os N buckets consecutivos confirmam a condição —
 * "sockets órfãos persistirem por N minutos seguidos".
 *
 * Auth: Bearer CRON_SECRET (mesmo padrão dos outros crons). Sem token
 * configurado, o check de auth é pulado com warning.
 * Params: ?dryRun=1 reporta o que seria alertado sem notificar nada.
 *
 * Env:
 *   ORPHAN_ALERT_MINUTES     — N minutos consecutivos (default 5)
 *   ORPHAN_ALERT_COOLDOWN_MS — cooldown entre alertas reais (default 60min)
 *   ADMIN_EMAIL              — destinatário do email (sem env → só Sentry)
 *
 * A lógica (cooldown Redis + dry-run + persistência + notificação) vive em
 * src/lib/realtime-orphan-alert.ts. Fail-open: Redis fora do ar → completed
 * sem alerta (nunca 500); notificação falha → logged, job segue.
 *
 * Exemplo cron-job.org: GET https://severinno.com.br/api/cron/realtime-orphan-alert
 *   Header: Authorization: Bearer <CRON_SECRET> — a cada 5 minutos.
 */

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    // ── Auth (mesmo padrão dos outros crons) ──────────────────────────
    const auth = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET ?? ""
    if (!cronSecret) {
      logger.warn("realtime-orphan-alert: CRON_SECRET not configured — skipping auth check")
    } else if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const url = new URL(request.url)
    const dryRun = url.searchParams.get("dryRun") === "1"

    const result = await runRealtimeOrphanAlert({ dryRun })
    return NextResponse.json(result)
  } catch (e) {
    return handleError(e)
  }
}
