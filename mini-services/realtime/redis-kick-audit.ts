/**
 * Severinno Marketplace SaaS — Realtime Mini-Service: Redis kick audit
 *
 * Persists the kick audit (WHY a user's sockets were force-closed: session_limit
 * / revoke / session_expired) to Redis so it SURVIVES a realtime restart and
 * carries PER-USER HISTORY (not just the latest reason) for the admin panel.
 *
 *   realtime:kick-audit   STRING  JSON map userId → { count, entries[] } (TTL
 *                                  sliding — old audits expire on their own)
 *
 * Data model (single key, bounded):
 *   StoredKickAudit = Record<userId, { count: number, entries: Array<{
 *     reason: KickReason, at: string, socketId: string }> }>
 *   - count: total kicks for the user (accumulated across restarts — the
 *     running counter the admin tooltip shows).
 *   - entries: bounded recent history (historyMax, default 20) — oldest →
 *     newest; the admin panel renders the list ("últimos kicks").
 *
 * Design (mirrors the repo's operational patterns):
 *   - POOL: single in-flight flush guard (pool of 1) — concurrent flushes are
 *     coalesced (the cron revoke uses a pool of 5; a Redis RMW on ONE key must
 *     be serialized, so 1 is the correct pool here).
 *   - COOLDOWN: writes are BATCHED (debounced flush every flushIntervalMs,
 *     default 5s, env REALTIME_KICK_AUDIT_FLUSH_MS) instead of one RMW per
 *     kick — the same idea as the revoke cron's cooldown (don't hammer Redis).
 *   - FAIL-OPEN: without REDIS_URL or with Redis down, record() keeps the
 *     pending buffer in memory (best-effort); snapshot() falls back to the
 *     pending buffer (current-process view). NOTA: o pending acumula desde o
 *     último flush bem-sucedido (bounded 20/usuário) — numa queda LONGA do
 *     Redis o contador exibido sub-reporta (best-effort documentado; os
 *     kicks entram no Redis assim que ele volta). Redis failures never
 *     break a kick or a /sessions read.
 *   - Lazy ioredis (same as redis-telemetry): no heavy import at boot, shared
 *     client, docker-secret aware. The loader is INJECTED (duck-typed) so unit
 *     tests pass fakes — this module never imports `ioredis` directly.
 *
 * Consumers:
 *   - GET /sessions + GET /health/detailed (realtime): kicks snapshot with
 *     history (Bearer-protected) → admin panel "last kick + history".
 *   - The app's admin route /api/admin/realtime/sessions proxies it through.
 */

import { type KickReason } from "./security"

// ---------------------------------------------------------------------------
// Keys + bounds (shared contract — the snapshot shape mirrors the admin route)
// ---------------------------------------------------------------------------

/** Chave única do audit (mapa userId → { count, entries }) — sem SCAN. */
export const KICK_AUDIT_KEY = "realtime:kick-audit"

/** TTL em segundos — janela deslizante (7 dias de histórico). */
export const KICK_AUDIT_TTL_S = 7 * 24 * 60 * 60

/** Máx. entradas de histórico por usuário (bounded — o painel mostra os
 *  últimos kicks, não o histórico completo da vida do usuário). */
export const KICK_HISTORY_MAX = 20

/** Máx. usuários rastreados (espelho do KICK_AUDIT_MAX em security.ts). */
export const KICK_USERS_MAX = 500

/** Reasons válidas — o parse rejeita qualquer outra (contrato do admin: o
 *  tooltip indexa o label por reason; um valor desconhecido renderizaria
 *  undefined). Espelho do tipo KickReason de security.ts. */
const VALID_KICK_REASONS: ReadonlySet<string> = new Set([
  "session_limit",
  "session_expired",
  "revoke",
])

/** Cooldown default do flush em lote (ms). Env REALTIME_KICK_AUDIT_FLUSH_MS. */
export const KICK_AUDIT_FLUSH_INTERVAL_MS = 5_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Entrada persistida (com socketId — debugging). `max` é o limite de
 *  sessões por role APLICADO no momento do kick (só session_limit carrega;
 *  revoke/expired não têm limite associado → undefined). O tooltip do admin
 *  exibe "limite N" usando este campo — o mesmo `max` do payload
 *  session:limit emitido ao socket derrubado. */
export interface StoredKickEntry {
  reason: KickReason
  at: string
  socketId: string
  max?: number
}

/** Estado persistido de um usuário no audit. */
export interface StoredKickUser {
  count: number
  entries: StoredKickEntry[]
}

export type StoredKickAudit = Record<string, StoredKickUser>

/** Snapshot da API (GET /sessions): último kick + histórico por usuário. */
export interface KickAuditSnapshotEntry {
  reason: KickReason
  at: string
  count: number
  /** Limite de sessões por role aplicado no último kick (session_limit). */
  max?: number
  /** Histórico recente (oldest → newest) — o painel admin lista os kicks. */
  history: Array<{ reason: KickReason; at: string; socketId: string; max?: number }>
}

export type KickAuditSnapshot = Record<string, KickAuditSnapshotEntry>

/** Client Redis que o persister usa (get/setex — ioredis tem ambos). */
export interface KickAuditRedisLike {
  get(key: string): Promise<string | null>
  setex(key: string, seconds: number, value: string): Promise<unknown>
}

export type KickAuditRedisLoader = () => Promise<KickAuditRedisLike | null>

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Append entries to a user's stored audit (bounded per user AND per total
 * users). `count` increments by the number of appended entries. Pure —
 * returns a NEW object; the input is never mutated. When the user already
 * exists, entries are appended (oldest → newest, bounded to historyMax);
 * when the user cap is reached, the OLDEST user is evicted (insertion order).
 */
export function appendKickEntries(
  stored: StoredKickAudit,
  userId: string,
  entries: readonly StoredKickEntry[],
  historyMax = KICK_HISTORY_MAX,
  usersMax = KICK_USERS_MAX,
): StoredKickAudit {
  if (!userId || entries.length === 0) return stored
  const next: StoredKickAudit = { ...stored }
  const prev = next[userId]
  const mergedEntries = [...(prev?.entries ?? []), ...entries].slice(-historyMax)
  next[userId] = { count: (prev?.count ?? 0) + entries.length, entries: mergedEntries }

  const keys = Object.keys(next)
  if (keys.length > usersMax) {
    const overflow = keys.length - usersMax
    for (const oldest of keys.slice(0, overflow)) delete next[oldest]
  }
  return next
}

/**
 * Convert the stored audit into the API snapshot (last kick + history).
 * The LATEST entry (last in the array) is the current reason/at — the same
 * semantics as snapshotKickAudit in security.ts, plus the history list.
 */
export function storedToKickSnapshot(stored: StoredKickAudit): KickAuditSnapshot {
  const out: KickAuditSnapshot = {}
  for (const [userId, user] of Object.entries(stored)) {
    const last = user.entries[user.entries.length - 1]
    if (!last) continue
    out[userId] = {
      reason: last.reason,
      at: last.at,
      count: user.count,
      max: last.max,
      history: user.entries.map((e) => ({
        reason: e.reason,
        at: e.at,
        socketId: e.socketId,
        max: e.max,
      })),
    }
  }
  return out
}

/** Parse a stored JSON string → audit map. Corrupt/empty → {}. Never throws. */
export function parseStoredKickAudit(raw: string | null): StoredKickAudit {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as StoredKickAudit
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    // Sanitize shape: entries must be arrays with reason/at; count a number.
    for (const [userId, user] of Object.entries(parsed)) {
      if (!userId || typeof user !== "object" || user === null) {
        delete parsed[userId]
        continue
      }
      const entries = Array.isArray(user.entries) ? user.entries : []
      parsed[userId] = {
        count: Number.isFinite(Number(user.count)) ? Number(user.count) : 0,
        // Shape completo: reason válida + at + socketId (string) — o snapshot
        // expõe socketId no history, então entrada sem ele é descartada.
        // `max` opcional: número >= 1 (limite por role) ou ausente — um max
        // inválido é DERRUBADO (undefined), não aceito como dado corrompido.
        entries: entries
          .filter(
            (e): e is StoredKickEntry =>
              !!e &&
              typeof e === "object" &&
              typeof e.reason === "string" &&
              VALID_KICK_REASONS.has(e.reason) &&
              typeof e.at === "string" &&
              typeof e.socketId === "string",
          )
          .map((e) => {
            const max = e.max
            return typeof max === "number" && Number.isFinite(max) && max >= 1
              ? { ...e, max: Math.floor(max) }
              : { reason: e.reason, at: e.at, socketId: e.socketId }
          }),
      }
    }
    return parsed
  } catch {
    return {}
  }
}

/**
 * Resolve o cooldown do flush (ms) da env REALTIME_KICK_AUDIT_FLUSH_MS.
 * Guard padrão do repo (`Math.max(1, Number(env) || default)`): missing/
 * empty/NaN/"0" → fallback; < 1s → clamp a 1s. Pura — o serviço chama no boot.
 */
export function parseKickAuditFlushIntervalMs(
  raw: string | undefined,
  fallback = KICK_AUDIT_FLUSH_INTERVAL_MS,
): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n === 0) return fallback
  return Math.max(1_000, n)
}

// ---------------------------------------------------------------------------
// Persister (pool + cooldown + fail-open)
// ---------------------------------------------------------------------------

export interface KickAuditPersisterOptions {
  /** Injected Redis loader (lazy, memoized) — fakes em testes. */
  loadClient: KickAuditRedisLoader
  /** Cooldown do flush em lote (ms). Default KICK_AUDIT_FLUSH_INTERVAL_MS. */
  flushIntervalMs?: number
  /** TTL da janela deslizante (s). Default KICK_AUDIT_TTL_S. */
  ttlS?: number
  /** Máx. entradas de histórico por usuário. Default KICK_HISTORY_MAX. */
  historyMax?: number
  /** Máx. usuários rastreados. Default KICK_USERS_MAX. */
  usersMax?: number
}

export interface KickAuditPersister {
  /**
   * Record one kick. NEVER throws. Updates the in-memory pending buffer
   * (source of the current-process view when Redis is down) and schedules a
   * debounced flush (cooldown — batched, not one RMW per kick). `max` é o
   * limite de sessões por role aplicado (só session_limit; undefined para
   * revoke/session_expired) — o tooltip do admin o exibe como "limite N".
   */
  record(userId: string, reason: KickReason, socketId: string, at: string, max?: number): void
  /** Force a flush NOW (coalesced by the in-flight guard). Best-effort. */
  flush(): Promise<void>
  /**
   * Snapshot do audit: Redis (sobrevive a restart) MERGED com o pending
   * (kicks ainda não flushed) → último kick + histórico por usuário.
   * Fail-open: Redis fora → só o pending (visão do processo atual).
   */
  snapshot(): Promise<KickAuditSnapshot>
}

/**
 * Create the Redis-backed kick audit persister. The loader is injected (the
 * realtime wires the lazy ioredis adapter; tests inject fakes). Writes are
 * BATCHED (debounced flush every flushIntervalMs) and serialized (pool of 1).
 * Fail-open everywhere — a Redis outage degrades to the in-memory pending
 * buffer (same behavior as the old Map) with a deduped log.
 */
export function createKickAuditPersister(opts: KickAuditPersisterOptions): KickAuditPersister {
  // Default honesto: option ausente → KICK_AUDIT_FLUSH_INTERVAL_MS (5s).
  // Um valor explícito é clampado a >= 1s (flush mais rápido que 1s é
  // patológico — RMW sobre a chave única a cada kick).
  const flushIntervalMs =
    opts.flushIntervalMs !== undefined && Number.isFinite(opts.flushIntervalMs)
      ? Math.max(1_000, opts.flushIntervalMs)
      : KICK_AUDIT_FLUSH_INTERVAL_MS
  const ttlS = Math.max(60, opts.ttlS ?? KICK_AUDIT_TTL_S)
  const historyMax = Math.max(1, opts.historyMax ?? KICK_HISTORY_MAX)
  const usersMax = Math.max(1, opts.usersMax ?? KICK_USERS_MAX)

  // Kicks desde o último flush bem-sucedido (por usuário, bounded). `let`:
  // o doFlush troca o buffer (take-ownership) ANTES de qualquer await — um
  // kick gravado durante o flush em voo vai para o buffer NOVO e é gravado
  // no próximo ciclo (nunca se perde num clear).
  let pending = new Map<string, StoredKickEntry[]>()
  // Pool de 1: um flush por vez — evita RMW concorrente sobre a mesma chave.
  let flushing = false
  // Cooldown: debounce do flush (timer pendente = não agenda outro).
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let warned = false

  const warnOnce = (err: unknown) => {
    if (!warned) {
      console.error("[realtime] kick audit redis error (fail-open):", err)
      warned = true
    }
  }

  /** Re-merge do batch NÃO gravado de volta ao pending (retry no próximo
   *  ciclo) — batch é mais antigo que o pending novo (entries do batch
   *  primeiro; slice mantém o histórico mais recente). */
  const remerge = (batch: Map<string, StoredKickEntry[]>) => {
    for (const [userId, entries] of batch) {
      const existing = pending.get(userId) ?? []
      pending.set(userId, [...entries, ...existing].slice(-historyMax))
    }
  }

  const readStored = async (client: KickAuditRedisLike): Promise<StoredKickAudit> => {
    try {
      return parseStoredKickAudit(await client.get(KICK_AUDIT_KEY))
    } catch {
      return {} // Redis fora/erro → trata como vazio; pending cobre o processo
    }
  }

  const doFlush = async (): Promise<void> => {
    if (flushing) return // pool de 1 — coalesce
    if (pending.size === 0) return
    flushing = true
    // Take-ownership: troca o buffer atomicamente ANTES de qualquer await
    // (o record() durante os awaits escreve no pending NOVO — sem data loss).
    const batch = pending
    pending = new Map<string, StoredKickEntry[]>()
    try {
      const client = await opts.loadClient()
      if (!client) {
        warnOnce(new Error("Redis unavailable — kick audit kept in memory (fail-open)"))
        remerge(batch)
        return
      }
      // Guard de shape do client (fail-open): o loader é duck-typed — um
      // client sem get/setex (shape incompatível) degrada como Redis fora.
      if (typeof client.get !== "function" || typeof client.setex !== "function") {
        warnOnce(new Error("Redis client shape incompatível — kick audit em memória (fail-open)"))
        remerge(batch)
        return
      }
      const stored = await readStored(client)
      let next = stored
      for (const [userId, entries] of batch) {
        next = appendKickEntries(next, userId, entries, historyMax, usersMax)
      }
      await client.setex(KICK_AUDIT_KEY, ttlS, JSON.stringify(next))
      // Sucesso: o batch entrou no Redis (o pending NOVO fica intacto para o
      // próximo ciclo — nada a limpar; o snapshot lê Redis + pending).
      warned = false
    } catch (err) {
      // Falha no write: devolve o batch ao pending (retry no próximo ciclo).
      remerge(batch)
      warnOnce(err)
    } finally {
      flushing = false
    }
  }

  const scheduleFlush = (): void => {
    if (flushTimer) return // cooldown — um debounce por vez
    flushTimer = setTimeout(() => {
      flushTimer = null
      void doFlush()
    }, flushIntervalMs)
    if (typeof flushTimer.unref === "function") flushTimer.unref()
  }

  return {
    record(userId, reason, socketId, at, max) {
      if (!userId) return
      const list = pending.get(userId) ?? []
      // Só session_limit carrega `max` (limite por role aplicado no kick);
      // os demais reasons ficam sem (undefined — o snapshot omite o campo).
      const entry: StoredKickEntry = { reason, at, socketId }
      if (typeof max === "number" && Number.isFinite(max) && max >= 1) {
        entry.max = Math.floor(max)
      }
      list.push(entry)
      pending.set(userId, list.slice(-historyMax))
      scheduleFlush()
    },

    async flush() {
      await doFlush()
    },

    async snapshot() {
      // Redis (persistido — sobrevive a restart) + pending (não flushed).
      // Fail-open: sem client/erro → o pending sozinho (visão do processo).
      let stored: StoredKickAudit = {}
      try {
        const client = await opts.loadClient()
        if (client) stored = await readStored(client)
      } catch {
        stored = {}
      }
      let merged = stored
      for (const [userId, entries] of pending) {
        merged = appendKickEntries(merged, userId, entries, historyMax, usersMax)
      }
      return storedToKickSnapshot(merged)
    },
  }
}
