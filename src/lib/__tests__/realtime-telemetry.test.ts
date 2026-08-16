/**
 * Tests for mini-services/realtime/redis-telemetry.ts
 *
 * Covers the pure key/delta helpers and the Redis persister (fail-open
 * contract) with an injected fake client — no ioredis, no network.
 */

import { describe, it, expect, vi } from "vitest"
import {
  TELEMETRY_BUCKET_TTL_S,
  MULTI_FLAG_KEY,
  TELEMETRY_BUCKET_MS,
  DEFAULT_METRICS_MINUTES,
  MAX_METRICS_MINUTES,
  buildTelemetryBucket,
  emitBucketKey,
  multiBucketKey,
  computeEmitDeltas,
  createRedisLoader,
  createTelemetryPersister,
  readTelemetryWindow,
  type RedisPipelineLike,
  type RedisLike,
} from "../../../mini-services/realtime/redis-telemetry"

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("buildTelemetryBucket / keys (janela deslizante por minuto)", () => {
  it("floors the epoch ms into the minute bucket", () => {
    expect(buildTelemetryBucket(0)).toBe(0)
    expect(buildTelemetryBucket(59_999)).toBe(0)
    expect(buildTelemetryBucket(60_000)).toBe(1)
    expect(buildTelemetryBucket(1786919582769)).toBe((1786919582769 / 60_000) | 0)
  })

  it("builds the documented key names (contracto com o admin route)", () => {
    expect(emitBucketKey(42)).toBe("realtime:telemetry:emits:42")
    expect(multiBucketKey(42)).toBe("realtime:telemetry:multi:42")
    expect(MULTI_FLAG_KEY).toBe("realtime:telemetry:multi:flag")
    expect(TELEMETRY_BUCKET_TTL_S).toBe(86_400) // 24h
  })
})

describe("computeEmitDeltas", () => {
  it("reports the full count for a first observation", () => {
    expect(computeEmitDeltas(new Map(), { "notification:new": 5 })).toEqual({
      "notification:new": 5,
    })
  })

  it("reports the delta since the last persist", () => {
    const prev = new Map([
      ["notification:new", 5],
      ["booking:update", 2],
    ])
    expect(computeEmitDeltas(prev, { "notification:new": 8, "booking:update": 2 })).toEqual({
      "notification:new": 3,
    })
  })

  it("omits events with zero/negative delta", () => {
    const prev = new Map([["booking:update", 10]])
    const current: Record<string, number> = { "booking:update": 10 }
    expect(computeEmitDeltas(prev, current)).toEqual({})
    expect(computeEmitDeltas(prev, { "booking:update": 5 })).toEqual({})
  })

  it("reports a new event alongside deltas of existing ones", () => {
    const prev = new Map([["message:send", 3]])
    expect(computeEmitDeltas(prev, { "message:send": 4, "session:revoke": 1 })).toEqual({
      "message:send": 1,
      "session:revoke": 1,
    })
  })

  it("returns {} for empty current counters", () => {
    expect(computeEmitDeltas(new Map([["a", 1]]), {})).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// Persister (fail-open contract, client fake)
// ---------------------------------------------------------------------------

/** Fake pipeline que registra os comandos e devolve no exec(). */
function fakePipeline(): RedisPipelineLike & { calls: Array<[string, unknown[]]>; ok: boolean } {
  const p = {
    calls: [] as Array<[string, unknown[]]>,
    ok: true,
    hincrby(key: string, field: string, by: number) {
      p.calls.push(["hincrby", [key, field, by]])
      return p
    },
    expire(key: string, seconds: number) {
      p.calls.push(["expire", [key, seconds]])
      return p
    },
    setex(key: string, seconds: number, value: string) {
      p.calls.push(["setex", [key, seconds, value]])
      return p
    },
    hgetall(key: string) {
      p.calls.push(["hgetall", [key]])
      return p
    },
    get(key: string) {
      p.calls.push(["get", [key]])
      return p
    },
    async exec() {
      if (!p.ok) throw new Error("redis down")
      return []
    },
  }
  return p
}

/** Fake pipeline de LEITURA: devolve resultados prontos por comando (ioredis
 *  `exec()` → Array<[err, result]>). hgetall → Record, get → string|null. */
function fakeReadPipeline(
  results: Array<[Error | null, unknown]>,
): RedisPipelineLike & { exec: () => Promise<Array<[Error | null, unknown]>> } {
  const p = {
    hincrby() {
      return p
    },
    expire() {
      return p
    },
    setex() {
      return p
    },
    hgetall() {
      return p
    },
    get() {
      return p
    },
    exec: () => Promise.resolve(results),
  }
  return p
}

function fakeReadClient(pipe: RedisPipelineLike) {
  return { multi: vi.fn(() => pipe) } as RedisLike
}

function fakeClient(pipeline: RedisPipelineLike & { calls: unknown[] }) {
  return { multi: vi.fn(() => pipeline) }
}

const SESSIONS_FLAT = {
  total: 1,
  byRole: { CLIENT: 1 },
  usersWithMultipleSockets: 0,
  maxSocketsPerUser: 1,
}
const SESSIONS_ORPHAN = {
  total: 4,
  byRole: { PROVIDER: 4 },
  usersWithMultipleSockets: 2,
  maxSocketsPerUser: 3,
}

describe("createTelemetryPersister", () => {
  it("persists emit deltas (hincrby+expire) and the multi snapshot (setex) in one pipeline", async () => {
    const pipe = fakePipeline()
    const client = fakeClient(pipe)
    const persister = createTelemetryPersister({ loadClient: async () => client as never })

    await persister.persist({ "notification:new": 5, "booking:update": 1 }, SESSIONS_FLAT)

    const hincr = pipe.calls.filter(([c]) => c === "hincrby")
    const expires = pipe.calls.filter(([c]) => c === "expire")
    const setexs = pipe.calls.filter(([c]) => c === "setex")
    const bucket = buildTelemetryBucket(Date.now())

    expect(hincr).toHaveLength(2)
    expect(hincr[0]![1][0]).toBe(`realtime:telemetry:emits:${bucket}`)
    expect(expires).toHaveLength(2)
    expect(expires.every(([, a]) => a[1] === TELEMETRY_BUCKET_TTL_S)).toBe(true)
    expect(setexs).toHaveLength(1)
    expect(setexs[0]![1][0]).toBe(`realtime:telemetry:multi:${bucket}`)
    expect(JSON.parse(setexs[0]![1][2] as string)).toEqual(SESSIONS_FLAT)
  })

  it("deltas: a second persist only writes the new emits since the last cycle", async () => {
    const pipe = fakePipeline()
    const client = fakeClient(pipe)
    const persister = createTelemetryPersister({ loadClient: async () => client as never })

    await persister.persist({ "notification:new": 5 }, SESSIONS_FLAT)
    await persister.persist({ "notification:new": 7 }, SESSIONS_FLAT)

    const hincr = pipe.calls.filter(([c]) => c === "hincrby")
    expect(hincr).toHaveLength(2)
    // 1º ciclo: delta 5; 2º ciclo: delta 2.
    expect(hincr[0]![1][2]).toBe(5)
    expect(hincr[1]![1][2]).toBe(2)
  })

  it("sets the orphan flag ONLY when usersWithMultipleSockets > 0", async () => {
    const pipe = fakePipeline()
    const persister = createTelemetryPersister({
      loadClient: async () => fakeClient(pipe) as never,
      flagTtlS: 90,
    })

    await persister.persist({}, SESSIONS_FLAT)
    expect(pipe.calls.filter(([c]) => c === "setex").some(([, a]) => a[0] === MULTI_FLAG_KEY)).toBe(
      false,
    )

    await persister.persist({}, SESSIONS_ORPHAN)
    const flagSet = pipe.calls
      .filter(([c]) => c === "setex")
      .find(([, a]) => a[0] === MULTI_FLAG_KEY)
    expect(flagSet).toBeDefined()
    expect(flagSet![1][1]).toBe(90) // flagTtlS aplicado
  })

  it("flag TTL é clampado a >= 60s (minimo de janela de alerta)", async () => {
    const pipe = fakePipeline()
    const persister = createTelemetryPersister({
      loadClient: async () => fakeClient(pipe) as never,
      flagTtlS: 10,
    })
    await persister.persist({}, SESSIONS_ORPHAN)
    const flagSet = pipe.calls
      .filter(([c]) => c === "setex")
      .find(([, a]) => a[0] === MULTI_FLAG_KEY)
    expect(flagSet![1][1]).toBe(60)
  })

  it("fail-open: client null (sem REDIS_URL) → resolve sem lançar e sem comandos", async () => {
    const persister = createTelemetryPersister({ loadClient: async () => null })
    await expect(persister.persist({ a: 1 }, SESSIONS_FLAT)).resolves.toBeUndefined()
  })

  it("fail-open: erro do Redis (exec rejeita) → resolve sem lançar", async () => {
    const pipe = fakePipeline()
    pipe.ok = false
    const persister = createTelemetryPersister({
      loadClient: async () => fakeClient(pipe) as never,
    })
    await expect(persister.persist({ a: 1 }, SESSIONS_FLAT)).resolves.toBeUndefined()
  })

  it("fail-open: loadClient rejeita → resolve sem lançar", async () => {
    const persister = createTelemetryPersister({
      loadClient: async () => {
        throw new Error("boom")
      },
    })
    await expect(persister.persist({ a: 1 }, SESSIONS_FLAT)).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Reader (GET /metrics — janela de buckets + flag)
// ---------------------------------------------------------------------------

describe("readTelemetryWindow", () => {
  const NOW = 1786919580000

  it("agrega emits do window e devolve multi ordenado oldest → newest + flag", async () => {
    const bucket = buildTelemetryBucket(NOW)
    // 2 buckets: [bucket-1 (antigo), bucket (atual)] → hgetall,get x2 + flag.
    const results: Array<[Error | null, unknown]> = [
      [null, { "notification:new": "10" }],
      [
        null,
        JSON.stringify({
          total: 2,
          byRole: { CLIENT: 2 },
          usersWithMultipleSockets: 0,
          maxSocketsPerUser: 1,
        }),
      ],
      [null, { "notification:new": "5", "booking:update": "2" }],
      [
        null,
        JSON.stringify({
          total: 4,
          byRole: { PROVIDER: 4 },
          usersWithMultipleSockets: 2,
          maxSocketsPerUser: 3,
        }),
      ],
      [null, "1"], // flag
    ]
    const win = await readTelemetryWindow(fakeReadClient(fakeReadPipeline(results)), 2, NOW)

    expect(win).not.toBeNull()
    expect(win!.minutes).toBe(2)
    expect(win!.windowEnd).toBe(NOW)
    expect(win!.windowStart).toBe(NOW - 2 * TELEMETRY_BUCKET_MS)
    expect(win!.emits).toEqual({ "notification:new": 15, "booking:update": 2 })
    // Série temporal por minuto (oldest → newest) — a taxa que o dashboard plota.
    expect(win!.emitSeries).toEqual([
      {
        bucket: bucket - 1,
        ts: (bucket - 1) * TELEMETRY_BUCKET_MS,
        emits: { "notification:new": 10 },
      },
      {
        bucket,
        ts: bucket * TELEMETRY_BUCKET_MS,
        emits: { "notification:new": 5, "booking:update": 2 },
      },
    ])
    expect(win!.multi).toHaveLength(2)
    expect(win!.multi[0]).toMatchObject({ bucket: bucket - 1, usersWithMultipleSockets: 0 })
    expect(win!.multi[1]).toMatchObject({
      bucket,
      usersWithMultipleSockets: 2,
      maxSocketsPerUser: 3,
    })
    expect(win!.flag).toBe(true)
  })

  it("flag false quando a chave ausente; multi vazio quando não há buckets", async () => {
    const results: Array<[Error | null, unknown]> = [
      [null, {}],
      [null, null],
      [null, null],
    ]
    const win = await readTelemetryWindow(fakeReadClient(fakeReadPipeline(results)), 1, NOW)
    expect(win).not.toBeNull()
    expect(win!.emits).toEqual({})
    expect(win!.emitSeries).toEqual([])
    expect(win!.multi).toEqual([])
    expect(win!.flag).toBe(false)
  })

  it("ignora bucket de multi corrompido (JSON inválido) e erros por comando", async () => {
    const results: Array<[Error | null, unknown]> = [
      [new Error("hash err"), null],
      [null, "not-json{"], // corrompido → skip
      [null, null],
      [null, null],
    ]
    const win = await readTelemetryWindow(fakeReadClient(fakeReadPipeline(results)), 1, NOW)
    expect(win).not.toBeNull()
    expect(win!.emits).toEqual({})
    expect(win!.multi).toEqual([])
  })

  it("clampa minutes ao range [1, MAX_METRICS_MINUTES]; undefined → default", async () => {
    // results do tamanho exato por window (2 por bucket + flag) — o reader
    // indexa results[i*2]/[i*2+1]; tamanho errado quebraria a destructuring.
    const pipeFor = (n: number) =>
      fakeReadPipeline(
        Array.from({ length: n * 2 + 1 }, () => [null, null] as [Error | null, unknown]),
      )
    // minutes=0 → clamp mínimo 1 (mesmo do admin route: Math.max(1, ...)).
    const min = await readTelemetryWindow(fakeReadClient(pipeFor(1)), 0, NOW)
    expect(min!.minutes).toBe(1)
    // undefined → default 60.
    const def = await readTelemetryWindow(
      fakeReadClient(pipeFor(DEFAULT_METRICS_MINUTES)),
      undefined,
      NOW,
    )
    expect(def!.minutes).toBe(DEFAULT_METRICS_MINUTES)
    // minutes gigante → teto 1440 (não testa 1440 hgetalls reais, só o clamp).
    const max = await readTelemetryWindow(
      fakeReadClient(pipeFor(MAX_METRICS_MINUTES)),
      999_999,
      NOW,
    )
    expect(max!.minutes).toBe(MAX_METRICS_MINUTES)
  })

  it("fail-open: exec rejeita → null (endpoint responde available: false)", async () => {
    const pipe = fakePipeline()
    pipe.ok = false
    const win = await readTelemetryWindow(fakeReadClient(pipe), 1, NOW)
    expect(win).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Lazy loader
// ---------------------------------------------------------------------------

describe("createRedisLoader", () => {
  it("fail-open: sem REDIS_URL → null (telemetria best-effort)", async () => {
    const loader = createRedisLoader()
    const original = process.env.REDIS_URL
    delete process.env.REDIS_URL
    try {
      await expect(loader()).resolves.toBeNull()
    } finally {
      if (original !== undefined) process.env.REDIS_URL = original
    }
  })

  it("é promise-memoizado (um único client por loader)", async () => {
    // Hermético: sem REDIS_URL no env → loader retorna null sem tocar a rede.
    const original = process.env.REDIS_URL
    delete process.env.REDIS_URL
    try {
      const loader = createRedisLoader()
      const a = loader()
      const b = loader()
      expect(a).toBe(b)
      await expect(a).resolves.toBeNull()
    } finally {
      if (original !== undefined) process.env.REDIS_URL = original
    }
  })
})
