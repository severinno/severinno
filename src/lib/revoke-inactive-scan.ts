/**
 * revoke-inactive-scan.ts
 *
 * Motor compartilhado da varredura de revogação de sessões inativas.
 * Usado por:
 *   - GET  /api/cron/revoke-inactive-sessions  (cron agendado)
 *   - POST /api/admin/cron/revoke-inactive/run (disparo manual do painel)
 *
 * Critérios (configuráveis):
 *   - INACTIVE_DAYS — usuários com active=false há mais de N dias (padrão 7).
 *     Usa updatedAt como proxy do momento da desativação (o PATCH admin
 *     atualiza updatedAt).
 *   - DELETED_DAYS  — usuários soft-deleted (deletedAt) há mais de N dias
 *     (padrão 7).
 *   - PASSWORD_CHANGE_DAYS — usuários que trocaram a senha (passwordChangedAt)
 *     há mais de N dias (padrão 30). Defesa extra pós-vazamento: sockets
 *     antigos que sobreviveram à troca de senha são revogados. Once-only:
 *     ao revogar, o cron grava revokedByCronAt (ver schema User); a condição
 *     exige revokedByCronAt = null, então o usuário NÃO é re-revogado todo
 *     dia (passwordChangedAt não muda no login). A próxima troca de senha
 *     limpa o marcador, reabilitando a varredura.
 *
 * Segurança/limites:
 *   - Cooldown Redis (23h) por padrão; o disparo admin pode bypassar
 *     (bypassCooldown) porque é uma ação explícita e pontual.
 *   - Dry-run: conta o que seria revogado sem emitir nada.
 *   - Concorrência limitada (pool de 5) no revoke; revokeUserSessions nunca
 *     lança (emitRealtime captura erros).
 *   - Cada execução registra uma entrada no audit trail (revoke-run-audit.ts):
 *     status completed / skipped (cooldown) / error.
 */

import { db } from "@/lib/db"
import { revokeUserSessions } from "@/lib/auth"
import { isCooldownElapsed, markCompleted } from "@/lib/cron-cooldown"
import { captureMessage } from "@/lib/sentry"
import logger from "@/lib/logger"
import { recordRevokeRun, type RevokeRunSource } from "./revoke-run-audit"

export const DEFAULT_INACTIVE_DAYS = 7
export const DEFAULT_DELETED_DAYS = 7
export const DEFAULT_PASSWORD_CHANGE_DAYS = 30
export const DEFAULT_COOLDOWN_MS = 23 * 60 * 60 * 1000
export const CONCURRENCY = 5
export const BATCH_SIZE = 100

const JOB_NAME = "revoke-inactive-sessions"

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

export type RevokeScanResult =
  | { ok: true; status: "skipped"; reason: "cooldown" }
  | {
      ok: true
      status: "completed"
      dryRun: boolean
      scanned: number
      revoked: number
      failed: number
      elapsedMs: number
      threshold: {
        inactiveSince: string
        deletedSince: string
        passwordChangedSince: string
      }
    }

/**
 * Executa a varredura completa de revogação (lote com cursor + pool) e
 * registra a execução no audit trail. Nunca lança para o cooldown (retorna
 * skipped); erros do banco são registrados como "error" e relançados para o
 * handler da rota mapear o status HTTP.
 */
export async function runRevokeInactiveScan(opts: {
  dryRun: boolean
  source: RevokeRunSource
  bypassCooldown?: boolean
}): Promise<RevokeScanResult> {
  const startedAt = Date.now()
  const { dryRun, source, bypassCooldown = false } = opts
  const ranAt = new Date().toISOString()
  // Rota nodejs (runtime = "nodejs") — crypto.randomUUID sempre disponível.
  const newId = () => crypto.randomUUID()

  // ── Cooldown (idempotente, mas não repetir a cada minuto) ─────────
  // Não registra "skipped" no audit: o cooldown é comportamento esperado do
  // cron (rodaria todo dia) e inundaria o trail bounded em 50 com ruído,
  // afogando os runs completed que importam. O disparo admin usa
  // bypassCooldown=true, então nunca chega aqui.
  if (!bypassCooldown && !(await isCooldownElapsed(JOB_NAME, DEFAULT_COOLDOWN_MS))) {
    return { ok: true, status: "skipped", reason: "cooldown" }
  }

  const inactiveDays = Number(process.env.INACTIVE_DAYS) || DEFAULT_INACTIVE_DAYS
  const deletedDays = Number(process.env.DELETED_DAYS) || DEFAULT_DELETED_DAYS
  const passwordChangeDays =
    Number(process.env.PASSWORD_CHANGE_DAYS) || DEFAULT_PASSWORD_CHANGE_DAYS
  const inactiveThreshold = daysAgoIso(inactiveDays)
  const deletedThreshold = daysAgoIso(deletedDays)
  const passwordChangedThreshold = daysAgoIso(passwordChangeDays)
  const threshold = {
    inactiveSince: inactiveThreshold,
    deletedSince: deletedThreshold,
    passwordChangedSince: passwordChangedThreshold,
  }

  // ── Varredura em lote ─────────────────────────────────────────────
  let scanned = 0
  let revokedTotal = 0
  let failedTotal = 0
  let cursor: { id: string } | undefined

  try {
    do {
      const page = await db.user.findMany({
        where: {
          OR: [
            { active: false, updatedAt: { lte: new Date(inactiveThreshold) } },
            { deletedAt: { lte: new Date(deletedThreshold) } },
            // Troca de senha há mais de PASSWORD_CHANGE_DAYS: revoga sockets
            // antigos que sobreviveram à troca (defesa extra pós-vazamento).
            // Once-only: revokedByCronAt != null (já revogado sob o estado de
            // senha atual) exclui o usuário — sem isso, um usuário ativo que
            // trocou a senha uma vez seria re-revogado TODO dia para sempre
            // (a data não muda no login): expulsão forçada diária + flooding
            // do audit. A próxima troca de senha limpa o marcador.
            {
              passwordChangedAt: { lte: new Date(passwordChangedThreshold) },
              revokedByCronAt: null,
            },
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

      // Once-only marker: grava revokedByCronAt nos revogados para a condição
      // de troca de senha não os pegar de novo amanhã (passwordChangedAt não
      // muda no login → re-revogação diária). Marcar todos da página é seguro
      // porque o marcador só é consultado junto da condição de senha; quem
      // entrou por inativo/deletado não é afetado, e a próxima troca de senha
      // o limpa (rotas change/reset-password). Dry-run não grava nada.
      if (!dryRun) {
        await db.user.updateMany({
          where: { id: { in: page.map((u) => u.id) } },
          data: { revokedByCronAt: new Date() },
        })
      }

      cursor = page[page.length - 1]!
    } while (scanned % BATCH_SIZE === 0)
  } catch (e) {
    await recordRevokeRun({
      id: newId(),
      ranAt,
      source,
      status: "error",
      dryRun,
      scanned,
      revoked: revokedTotal,
      failed: failedTotal,
      elapsedMs: Date.now() - startedAt,
      threshold,
      error: e instanceof Error ? e.message : "Erro interno",
    })
    throw e
  }

  // Cooldown só em execuções REAIS: um dry-run (cron de debug ou o default
  // do painel) não deve suprimir o cron agendado por 23h — senão um dry-run
  // admin atrasaria uma revogação real que deveria acontecer.
  if (!dryRun) {
    await markCompleted(JOB_NAME, DEFAULT_COOLDOWN_MS)
  }

  const elapsedMs = Date.now() - startedAt
  logger.info(
    {
      dryRun,
      source,
      scanned,
      revoked: revokedTotal,
      failed: failedTotal,
      elapsedMs,
      inactiveDays,
      passwordChangeDays,
    },
    "cron revoke-inactive-sessions completed",
  )
  captureMessage(
    `[Cron] Revoke de sessões inativas — ${revokedTotal} revogadas (${scanned} varridas, ${failedTotal} falhas, dryRun=${dryRun})`,
    "info",
    {
      dryRun,
      source,
      scanned,
      revoked: revokedTotal,
      failed: failedTotal,
      elapsedMs,
      passwordChangeDays,
    },
  )

  await recordRevokeRun({
    id: newId(),
    ranAt,
    source,
    status: "completed",
    dryRun,
    scanned,
    revoked: revokedTotal,
    failed: failedTotal,
    elapsedMs,
    threshold,
  })

  return {
    ok: true,
    status: "completed",
    dryRun,
    scanned,
    revoked: revokedTotal,
    failed: failedTotal,
    elapsedMs,
    threshold,
  }
}
