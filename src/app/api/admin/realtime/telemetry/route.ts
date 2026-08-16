import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { getClient } from "@/lib/redis"
import { handleError } from "@/lib/api-server"

/**
 * GET /api/admin/realtime/telemetry
 *
 * Reads the realtime telemetry persisted in Redis by the mini-service
 * (mini-services/realtime/redis-telemetry.ts) — the SLIDING WINDOW of
 * per-minute buckets (TTL 24h) plus the orphan-socket alert flag:
 *
 *   realtime:telemetry:emits:{minuteBucket}   HASH  event → emits in that minute
 *   realtime:telemetry:multi:{minuteBucket}   STRING JSON session metrics
 *   realtime:telemetry:multi:flag             STRING "1" when orphan sockets > 0
 *
 * Query params:
 *   minutes  (number, optional) — lookback window in minutes, default 60,
 *                                 max 1440 (24h — the bucket TTL).
 *
 * Response:
 * ```json
 * {
 *   "ok": true,
 *   "available": true,
 *   "minutes": 60,
 *   "windowStart": 1700000000000,
 *   "windowEnd": 1700000000000,
 *   "emits": { "notification:new": 42, "booking:update": 3 },
 *   "multi": [
 *     { "bucket": 28333333, "ts": 1700000000000,
 *       "total": 5, "byRole": { "PROVIDER": 5 },
 *       "usersWithMultipleSockets": 1, "maxSocketsPerUser": 2 }
 *   ],
 *   "flag": true
 * }
 * ```
 *
 * The `multi` array is ordered oldest → newest, including every bucket that
 * had data (the client filters). `flag` is the "orphan sockets right now"
 * signal (self-clearing TTL ≈ 2× the realtime persist interval).
 *
 * Authentication: admin only (same pattern as GET /api/admin/realtime/sessions).
 * Degradation: Redis unavailable → `{ ok: false, available: false }` (the
 * dashboard shows the store as offline, never a 500).
 */

const BUCKET_MS = 60_000
const DEFAULT_MINUTES = 60
const MAX_MINUTES = 1440 // 24h — o TTL dos buckets

// Espelha mini-services/realtime/redis-telemetry.ts (contrato compartilhado;
// o app não importa o mini-service para não acoplar os dois pacotes).
function emitBucketKey(bucket: number): string {
  return `realtime:telemetry:emits:${bucket}`
}
function multiBucketKey(bucket: number): string {
  return `realtime:telemetry:multi:${bucket}`
}
const MULTI_FLAG_KEY = "realtime:telemetry:multi:flag"

type MultiBucket = {
  bucket: number
  ts: number
  total: number
  byRole: Record<string, number>
  usersWithMultipleSockets: number
  maxSocketsPerUser: number
}

type TelemetryResponse = {
  ok: boolean
  available: boolean
  minutes: number
  windowStart: number
  windowEnd: number
  emits: Record<string, number>
  multi: MultiBucket[]
  flag: boolean
}

/** Resposta de degradação graciosa (Redis fora do ar / sem client). */
const UNAVAILABLE: TelemetryResponse = {
  ok: false,
  available: false,
  minutes: 0,
  windowStart: 0,
  windowEnd: 0,
  emits: {},
  multi: [],
  flag: false,
}

export async function GET(req: Request): Promise<NextResponse<TelemetryResponse>> {
  try {
    await requireRole("ADMIN")

    const client = getClient()
    if (!client) {
      // Redis indisponível (tier in-memory ou falha) → dashboard mostra a
      // telemetria como offline; nunca quebra o painel admin.
      return NextResponse.json(UNAVAILABLE)
    }

    const url = new URL(req.url)
    const rawMinutes = Number(url.searchParams.get("minutes") ?? DEFAULT_MINUTES)
    const minutes = Math.min(
      MAX_MINUTES,
      Math.max(1, Number.isFinite(rawMinutes) ? Math.floor(rawMinutes) : DEFAULT_MINUTES),
    )

    const now = Date.now()
    const windowEnd = now
    const windowStart = now - minutes * BUCKET_MS
    const buckets: number[] = []
    for (let i = minutes - 1; i >= 0; i--) {
      buckets.push(Math.floor((now - i * BUCKET_MS) / BUCKET_MS))
    }

    // Um pipeline: hgetall (emits) + get (multi) por bucket + get (flag).
    // Chaves derivadas do range — sem SCAN, custo O(minutes) independente do
    // volume total. ioredis exec() devolve [err, result][] por comando.
    const pipeline = client.multi()
    for (const b of buckets) {
      pipeline.hgetall(emitBucketKey(b))
      pipeline.get(multiBucketKey(b))
    }
    pipeline.get(MULTI_FLAG_KEY)
    const results = (await pipeline.exec()) as Array<[Error | null, unknown]>

    const emits: Record<string, number> = {}
    const multi: MultiBucket[] = []
    let flag = false

    for (let i = 0; i < buckets.length; i++) {
      const [errHash, hashRaw] = results[i * 2]!
      const [errMulti, multiRaw] = results[i * 2 + 1]!
      if (!errHash && hashRaw && typeof hashRaw === "object") {
        for (const [event, count] of Object.entries(hashRaw as Record<string, string>)) {
          emits[event] = (emits[event] ?? 0) + (Number(count) || 0)
        }
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
            ts: buckets[i]! * BUCKET_MS,
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
    flag = flagRaw === "1"

    return NextResponse.json({
      ok: true,
      available: true,
      minutes,
      windowStart,
      windowEnd,
      emits,
      multi,
      flag,
    })
  } catch (e) {
    const err = handleError(e) as NextResponse<unknown>
    return err as NextResponse<TelemetryResponse>
  }
}
