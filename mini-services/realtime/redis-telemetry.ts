/**
 * Severinno Marketplace SaaS — Realtime Mini-Service: Redis telemetry
 *
 * Persists the realtime telemetry (emit counters + the orphan-socket signal)
 * to Redis with a SLIDING WINDOW (per-minute buckets with TTL — old buckets
 * expire on their own, no cleanup job):
 *
 *   realtime:telemetry:emits:{minuteBucket}   HASH   event → emits in that minute
 *   realtime:telemetry:multi:{minuteBucket}   STRING JSON snapshot of session
 *                                                    metrics for that minute
 *   realtime:telemetry:multi:flag             STRING "1" (short TTL) whenever
 *                                                    usersWithMultipleSockets > 0
 *
 * Consumers:
 *   - ops dashboards: the app's admin route GET /api/admin/realtime/telemetry
 *     reads the last N minute-buckets (derived keys — no SCAN) and the flag;
 *   - alerts: the flag is the "orphan sockets right now" signal — an alerting
 *     job just GETs it (TTL ≈ 2× persist interval, so it self-clears).
 *
 * The `usersWithMultipleSockets` signal is the HMR-orphan symptom (a dev
 * reload leaves stale sockets behind); spiking in production means leaked /
 * stale sessions that the TTL sweep or session limit should have reclaimed.
 *
 * Design notes:
 *   - Bucket value for emits is a DELTA (per persist cycle), so the hash
 *     accumulates the true per-minute rate even when the interval is < 60s.
 *   - Fail-open everywhere: without REDIS_URL or with Redis down, persist()
 *     logs (deduped) and resolves — telemetry never breaks the realtime.
 *   - Lazy ioredis (same pattern as booking-participant's lazy pg Pool):
 *     no heavy import at boot, one shared client, docker-secret aware.
 */

import { readSecret } from "./security"

// ---------------------------------------------------------------------------
// Keys (shared contract — the admin route mirrors these names)
// ---------------------------------------------------------------------------

/** TTL em segundos de cada bucket — a janela deslizante (24h de histórico). */
export const TELEMETRY_BUCKET_TTL_S = 86_400

/** Sinal de alerta: "há sockets órfãos AGORA" (TTL curto, self-clearing). */
export const MULTI_FLAG_KEY = "realtime:telemetry:multi:flag"

/** Bucket de minuto (epoch ms → minuto). Pure. */
export function buildTelemetryBucket(tsMs: number): number {
  return Math.floor(tsMs / TELEMETRY_BUCKET_MS)
}

/** 1 minuto em ms — fonte única do bucket (buildTelemetryBucket usa). */
export const TELEMETRY_BUCKET_MS = 60_000
/** Lookback default e teto do window de leitura (24h — o TTL dos buckets). */
export const DEFAULT_METRICS_MINUTES = 60
export const MAX_METRICS_MINUTES = 1440

export function emitBucketKey(bucket: number): string {
  return `realtime:telemetry:emits:${bucket}`
}

export function multiBucketKey(bucket: number): string {
  return `realtime:telemetry:multi:${bucket}`
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Session metrics snapshot persisted per minute-bucket. */
export interface TelemetrySessionsSnapshot {
  total: number
  byRole: Record<string, number>
  usersWithMultipleSockets: number
  maxSocketsPerUser: number
}

/**
 * Emit deltas since the last persist cycle: current minus previous per event.
 * A new event (no previous entry) reports its full count; events that stopped
 * growing report no delta (omitted). Pure — state lives in the persister.
 */
export function computeEmitDeltas(
  prev: ReadonlyMap<string, number>,
  current: Readonly<Record<string, number>>,
): Record<string, number> {
  const deltas: Record<string, number> = {}
  for (const [event, count] of Object.entries(current)) {
    const delta = count - (prev.get(event) ?? 0)
    if (delta > 0) deltas[event] = delta
  }
  return deltas
}

// ---------------------------------------------------------------------------
// Redis client (lazy, docker-secret aware)
// ---------------------------------------------------------------------------

/** Structural view of the pipeline commands the persister AND the reader
 *  issue (ioredis `multi()` duck-typed so unit tests inject a fake). */
export interface RedisPipelineLike {
  hincrby(key: string, field: string, by: number): unknown
  expire(key: string, seconds: number): unknown
  setex(key: string, seconds: number, value: string): unknown
  hgetall(key: string): unknown
  get(key: string): unknown
  exec(): Promise<unknown>
}

export interface RedisLike {
  multi(): RedisPipelineLike
}

export type RedisClientLoader = () => Promise<RedisLike | null>

/**
 * Promise-memoized lazy ioredis loader (same pattern as the booking-participant
 * pg Pool). Fail-open: no REDIS_URL → null (telemetry is best-effort).
 * An 'error' handler is attached BEFORE connect so a later Redis outage logs
 * instead of crashing the process (unhandled 'error' event).
 */
export function createRedisLoader(): RedisClientLoader {
  let memo: Promise<RedisLike | null> | null = null
  return () => {
    memo ??= (async () => {
      const url = readSecret("REDIS_URL")
      if (!url) {
        console.warn("[realtime] ⚠️ REDIS_URL not configured — telemetry not persisted (fail open)")
        return null
      }
      try {
        const { Redis } = await import("ioredis")
        const client = new Redis(url, {
          lazyConnect: true,
          connectTimeout: 2_000,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        })
        client.on("error", (err: unknown) => {
          console.error("[realtime] redis telemetry connection error:", err)
        })
        await client.connect()
        return client as unknown as RedisLike
      } catch (err) {
        // Não memoiza a falha: sem isso, um Redis fora no BOOT deixaria a
        // telemetria permanentemente desligada (memo resolveria null para
        // sempre). Resetar permite retry no próximo ciclo — auto-recuperação.
        memo = null
        console.error("[realtime] could not load ioredis for telemetry:", err)
        return null
      }
    })()
    return memo
  }
}

// ---------------------------------------------------------------------------
// Reader (GET /metrics do realtime)
// ---------------------------------------------------------------------------

/** Entrada do histórico por minuto (usersWithMultipleSockets ao longo do tempo). */
export interface TelemetryMultiEntry {
  bucket: number
  ts: number
  total: number
  byRole: Record<string, number>
  usersWithMultipleSockets: number
  maxSocketsPerUser: number
}

/** Série temporal por minuto dos emitCounters (o dashboard plota a TAXA). */
export interface TelemetryEmitSeriesEntry {
  bucket: number
  ts: number
  emits: Record<string, number>
}

/** Janela de telemetria lida do Redis (espelha o contrato do admin route do app). */
export interface TelemetryWindow {
  available: true
  minutes: number
  windowStart: number
  windowEnd: number
  /** Agregado do window: event → total emits. */
  emits: Record<string, number>
  /** Série por minuto (oldest → newest) — a dimensão TEMPORAL do "por minuto". */
  emitSeries: TelemetryEmitSeriesEntry[]
  multi: TelemetryMultiEntry[]
  flag: boolean
}

/**
 * Read the last `minutes` of telemetry buckets (DERIVED keys from the minute
 * range — no SCAN, cost O(minutes) regardless of total volume) plus the
 * orphan-socket flag, in ONE pipeline (hgetall for emits + get for multi per
 * bucket + get for the flag). Fail-open: Redis down or exec error → `null`
 * (the endpoint answers `{ ok: false, available: false }`, never a 500).
 * Emits come in TWO shapes: the aggregate across the window (`emits`, event →
 * total) AND the per-minute series (`emitSeries`, oldest → newest — the time
 * dimension a dashboard needs to plot emit RATE over time). `multi` is also
 * ordered oldest → newest including every bucket that had data. Corrupt
 * bucket JSON is skipped (the next snapshot overwrites it). This mirrors the
 * app's admin route logic (src/app/api/admin/realtime/telemetry/route.ts) —
 * keep both in sync when changing the bucket contract.
 */
export async function readTelemetryWindow(
  client: RedisLike,
  rawMinutes: number | undefined,
  nowMs: number,
): Promise<TelemetryWindow | null> {
  try {
    // typeof guard: Number.isFinite NÃO estreita number | undefined (assinatura
    // aceita unknown) — sem o typeof, Math.floor receberia undefined (TS2345).
    const minutes = Math.min(
      MAX_METRICS_MINUTES,
      Math.max(
        1,
        typeof rawMinutes === "number" && Number.isFinite(rawMinutes)
          ? Math.floor(rawMinutes)
          : DEFAULT_METRICS_MINUTES,
      ),
    )
    const windowStart = nowMs - minutes * TELEMETRY_BUCKET_MS
    const buckets: number[] = []
    for (let i = minutes - 1; i >= 0; i--) {
      buckets.push(Math.floor((nowMs - i * TELEMETRY_BUCKET_MS) / TELEMETRY_BUCKET_MS))
    }

    const pipeline = client.multi()
    for (const b of buckets) {
      pipeline.hgetall(emitBucketKey(b))
      pipeline.get(multiBucketKey(b))
    }
    pipeline.get(MULTI_FLAG_KEY)
    const results = (await pipeline.exec()) as Array<[Error | null, unknown]>

    const emits: Record<string, number> = {}
    const emitSeries: TelemetryEmitSeriesEntry[] = []
    const multi: TelemetryMultiEntry[] = []
    for (let i = 0; i < buckets.length; i++) {
      const [errHash, hashRaw] = results[i * 2]!
      const [errMulti, multiRaw] = results[i * 2 + 1]!
      const bucketEmits: Record<string, number> = {}
      if (!errHash && hashRaw && typeof hashRaw === "object") {
        for (const [event, count] of Object.entries(hashRaw as Record<string, string>)) {
          const n = Number(count) || 0
          emits[event] = (emits[event] ?? 0) + n
          if (n > 0) bucketEmits[event] = n
        }
      }
      // Série temporal: inclui o bucket SEMPRE que ele teve algum emit (o
      // dashboard plota a taxa por minuto; buckets vazios ficam de fora).
      if (Object.keys(bucketEmits).length > 0) {
        emitSeries.push({
          bucket: buckets[i]!,
          ts: buckets[i]! * TELEMETRY_BUCKET_MS,
          emits: bucketEmits,
        })
      }
      if (!errMulti && multiRaw && typeof multiRaw === "string") {
        try {
          const parsed = JSON.parse(multiRaw) as {
            total?: number
            byRole?: Record<string, number>
            usersWithMultipleSockets?: number
            maxSocketsPerUser?: number
          }
          multi.push({
            bucket: buckets[i]!,
            ts: buckets[i]! * TELEMETRY_BUCKET_MS,
            total: parsed.total ?? 0,
            byRole: parsed.byRole ?? {},
            usersWithMultipleSockets: parsed.usersWithMultipleSockets ?? 0,
            maxSocketsPerUser: parsed.maxSocketsPerUser ?? 0,
          })
        } catch {
          // Bucket corrompido → ignora (o próximo snapshot sobrescreve).
        }
      }
    }

    const flagRaw = results[results.length - 1]?.[1]
    return {
      available: true,
      minutes,
      windowStart,
      windowEnd: nowMs,
      emits,
      emitSeries,
      multi,
      flag: flagRaw === "1",
    }
  } catch {
    return null // Redis fora / exec falhou → endpoint responde available: false
  }
}

// ---------------------------------------------------------------------------
// Persister
// ---------------------------------------------------------------------------

export interface TelemetryPersisterOptions {
  loadClient: RedisClientLoader
  /** TTL em segundos da flag de órfãos (sinal de alerta). Default 120. */
  flagTtlS?: number
}

export interface TelemetryPersister {
  /**
   * Persist one telemetry cycle. Fail-open: Redis unavailable → log (deduped)
   * and resolve. `emits` are the process's accumulated counters (the persister
   * computes the deltas internally); `sessions` is the current snapshot.
   */
  persist(
    emits: Readonly<Record<string, number>>,
    sessions: TelemetrySessionsSnapshot,
  ): Promise<void>
}

export function createTelemetryPersister(opts: TelemetryPersisterOptions): TelemetryPersister {
  const flagTtlS = Math.max(60, opts.flagTtlS ?? 120)
  // Deltas são calculados contra o ÚLTIMO persist bem-sucedido. Quando o Redis
  // está fora, lastCounts não avança — na próxima janela o delta cobre o gap
  // acumulado (distribuição por minuto levemente enviesada, total preservado).
  const lastCounts = new Map<string, number>()
  let warned = false

  return {
    async persist(emits, sessions) {
      try {
        const client = await opts.loadClient()
        if (!client) return // fail-open: sem Redis a telemetria é best-effort

        const deltas = computeEmitDeltas(lastCounts, emits)
        for (const [event, count] of Object.entries(emits)) lastCounts.set(event, count)

        const bucket = buildTelemetryBucket(Date.now())
        const pipeline = client.multi()
        for (const [event, delta] of Object.entries(deltas)) {
          pipeline.hincrby(emitBucketKey(bucket), event, delta)
          pipeline.expire(emitBucketKey(bucket), TELEMETRY_BUCKET_TTL_S)
        }
        pipeline.setex(multiBucketKey(bucket), TELEMETRY_BUCKET_TTL_S, JSON.stringify(sessions))
        // Sinal de alerta: TTL curto — a flag some sozinha quando a condição
        // deixa de ser observada (janela deslizante do "agora").
        if (sessions.usersWithMultipleSockets > 0) {
          pipeline.setex(MULTI_FLAG_KEY, flagTtlS, "1")
        }
        await pipeline.exec()
        warned = false
      } catch (err) {
        // Log deduplicado: enquanto o Redis estiver fora, um aviso por ciclo
        // viraria spam no timer (30s). Reset no próximo sucesso.
        if (!warned) {
          console.error("[realtime] telemetry persist error (fail-open):", err)
          warned = true
        }
      }
    },
  }
}
