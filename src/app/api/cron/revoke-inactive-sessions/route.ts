import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { revokeUserSessions } from "@/lib/auth"
import { isCooldownElapsed, markCompleted } from "@/lib/cron-cooldown"
import { captureMessage } from "@/lib/sentry"
import logger from "@/lib/logger"
import { handleError } from "@/lib/api-server"

/**
 * GET /api/cron/revoke-inactive-sessions
 *
 * Varredura em lote que revoga os sockets realtime de usuários inativos,
 * evitando que contas desativadas/soft-deleted mantenham sessões vivas no
 * mini-service (um socket revogado não pode mais receber eventos da sala
 * user:{id} nem emitir mensagens).
 *
 * Critérios (configuráveis):
 *   - INACTIVE_DAYS  — usuários com active=false há mais de N dias (padrão 7).
 *     Usa updatedAt como proxy do momento da desativação: o PATCH admin de
 *     desativação atualiza updatedAt, então "inativo há N dias" = active=false
 *     && updatedAt <= agora − N dias.
 *   - DELETED_DAYS   — usuários soft-deleted (deletedAt) há mais de N dias
 *     (padrão 7). Cobre soft-deletes antigos (anteriores à revogação no DELETE).
 *
 * Segurança/limites:
 *   - Autenticação: Bearer CRON_SECRET (mesmo padrão dos outros crons).
 *   - Cooldown Redis (padrão 23h) — a varredura é idempotente (revokeUserSessions
 *     é non-blocking e seguro de repetir), mas não deve rodar a cada minuto.
 *   - Dry-run: `?dryRun=1` reporta o que seria revogado sem emitir nada.
 *   - Concorrência limitada (pool de 5) para não sobrecarregar o /emit do
 *     realtime; `revokeUserSessions` nunca lança (emitRealtime captura erros),
 *     então um realtime fora do ar degrada a varredura, não a quebra.
 *
 * Resposta: { ok, dryRun, scanned, revoked, failed, elapsedMs, thresholdIso }
 * Audit: summary no Sentry (captureMessage) + entrada no worklog.md.
 */

export const runtime = "nodejs"

const DEFAULT_INACTIVE_DAYS = 7
const DEFAULT_COOLDOWN_MS = 23 * 60 * 60 * 1000
const CONCURRENCY = 5
const BATCH_SIZE = 100

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Run the revocation over one page of users with a concurrency-limited pool.
 * Pure enough to unit-test with a mocked db + revoke.
 */
export async function revokeInactiveSessionsBatch(
  users: Array<{ id: string }>,
  opts: { dryRun: boolean; revoke: (userId: string) => Promise<void> },
): Promise<{ revoked: number; failed: number }> {
  let revoked = 0
  let failed = 0
  const queue = [...users]

  const worker = async () => {
    while (queue.length > 0) {
      const user = queue.shift()!
      if (opts.dryRun) {
        revoked++
        continue
      }
      try {
        await opts.revoke(user.id)
        revoked++
      } catch {
        failed++
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, Math.max(1, users.length)) }, worker)
  await Promise.all(workers)
  return { revoked, failed }
}

export async function GET(request: Request) {
  const startedAt = Date.now()
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

    // ── Cooldown (idempotente, mas não repetir a cada minuto) ─────────
    if (!(await isCooldownElapsed("revoke-inactive-sessions", DEFAULT_COOLDOWN_MS))) {
      return NextResponse.json({ ok: true, status: "skipped", reason: "cooldown" })
    }

    const inactiveDays = Number(process.env.INACTIVE_DAYS) || DEFAULT_INACTIVE_DAYS
    const deletedDays = Number(process.env.DELETED_DAYS) || DEFAULT_INACTIVE_DAYS
    const inactiveThreshold = daysAgoIso(inactiveDays)
    const deletedThreshold = daysAgoIso(deletedDays)

    // ── Varredura em lote ─────────────────────────────────────────────
    let scanned = 0
    let revokedTotal = 0
    let failedTotal = 0
    let cursor: { id: string } | undefined

    do {
      const page = await db.user.findMany({
        where: {
          OR: [
            { active: false, updatedAt: { lte: new Date(inactiveThreshold) } },
            { deletedAt: { lte: new Date(deletedThreshold) } },
          ],
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor.id } } : {}),
      })

      if (page.length === 0) break

      const result = await revokeInactiveSessionsBatch(page, {
        dryRun,
        revoke: revokeUserSessions,
      })
      scanned += page.length
      revokedTotal += result.revoked
      failedTotal += result.failed

      cursor = page[page.length - 1]!
    } while (scanned % BATCH_SIZE === 0)

    await markCompleted("revoke-inactive-sessions", DEFAULT_COOLDOWN_MS)

    const elapsedMs = Date.now() - startedAt
    logger.info(
      { dryRun, scanned, revoked: revokedTotal, failed: failedTotal, elapsedMs, inactiveDays },
      "cron revoke-inactive-sessions completed",
    )
    captureMessage(
      `[Cron] Revoke de sessões inativas — ${revokedTotal} revogadas (${scanned} varridas, ${failedTotal} falhas, dryRun=${dryRun})`,
      "info",
      { dryRun, scanned, revoked: revokedTotal, failed: failedTotal, elapsedMs },
    )

    return NextResponse.json({
      ok: true,
      dryRun,
      scanned,
      revoked: revokedTotal,
      failed: failedTotal,
      elapsedMs,
      threshold: { inactiveSince: inactiveThreshold, deletedSince: deletedThreshold },
    })
  } catch (e) {
    return handleError(e)
  }
}
