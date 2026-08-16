/**
 * revoke-run-audit.ts
 *
 * Audit trail (Redis-backed) das execuções do cron de revogação de sessões
 * inativas (revoke-inactive-sessions) e dos disparos manuais do painel admin.
 *
 * Guarda uma lista LIMITADA (MAX_RUNS) dos últimos runs sob uma única chave
 * Redis (array serializado como JSON). Usa a camada tier-aware de cache
 * (cacheGet/cacheSet) do redis.ts — quando o Redis está fora do ar, degrada
 * para a store em memória, então o audit NUNCA quebra a varredura em si
 * (best-effort, com try/catch).
 *
 * Estrutura de cada entrada:
 *   { id, ranAt, source: "cron" | "admin", status: "completed" | "skipped" | "error",
 *     dryRun, scanned, revoked, failed, elapsedMs, threshold, reason?, error? }
 */

import { cacheGet, cacheSet } from "./redis"

const AUDIT_KEY = "cron:revoke-inactive:runs"
const MAX_RUNS = 50
const TTL_SECONDS = 60 * 60 * 24 * 30 // 30 dias

export type RevokeRunSource = "cron" | "admin"

export type RevokeRunStatus = "completed" | "skipped" | "error"

export type RevokeRunEntry = {
  id: string
  /** ISO timestamp do início da execução. */
  ranAt: string
  /** Quem disparou: o cron agendado ou um admin pelo painel. */
  source: RevokeRunSource
  status: RevokeRunStatus
  dryRun: boolean
  /** Usuários varridos na página (soma de todas as páginas). */
  scanned: number
  /** Sessões revogadas (contadas mesmo em dry-run). */
  revoked: number
  /** Falhas ao revogar (não-dry-run). */
  failed: number
  elapsedMs: number
  threshold: {
    inactiveSince: string
    deletedSince: string
    passwordChangedSince: string
  } | null
  /** Motivo quando status === "skipped" (ex.: cooldown). */
  reason?: string
  /** Mensagem quando status === "error". */
  error?: string
}

/**
 * Registra um run no audit trail (bounded em MAX_RUNS, mais recente primeiro).
 * Best-effort — nunca lança.
 */
export async function recordRevokeRun(entry: RevokeRunEntry): Promise<void> {
  try {
    const existing = (await cacheGet<RevokeRunEntry[]>(AUDIT_KEY)) ?? []
    const next = [entry, ...existing].slice(0, MAX_RUNS)
    await cacheSet(AUDIT_KEY, next, TTL_SECONDS)
  } catch {
    // Audit é best-effort — a varredura segue mesmo sem Redis.
  }
}

/**
 * Lista os últimos runs registrados (mais recente primeiro).
 * Retorna [] quando não há audit persistido ou o Redis está indisponível.
 */
export async function listRevokeRuns(limit = MAX_RUNS): Promise<RevokeRunEntry[]> {
  try {
    const runs = (await cacheGet<RevokeRunEntry[]>(AUDIT_KEY)) ?? []
    return runs.slice(0, limit)
  } catch {
    return []
  }
}
