/**
 * Tests for mini-services/realtime/redis-kick-audit.ts
 *
 * Covers the pure helpers (append/merge/snapshot/parse) and the Redis
 * persister (pool de 1 + cooldown + fail-open contract) with an injected
 * fake client — no ioredis, no network. Same pattern as
 * realtime-telemetry.test.ts.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import {
  KICK_AUDIT_KEY,
  KICK_AUDIT_TTL_S,
  KICK_HISTORY_MAX,
  KICK_USERS_MAX,
  KICK_AUDIT_FLUSH_INTERVAL_MS,
  appendKickEntries,
  storedToKickSnapshot,
  parseStoredKickAudit,
  parseKickAuditFlushIntervalMs,
  createKickAuditPersister,
  type StoredKickAudit,
  type KickAuditRedisLike,
} from "../../../mini-services/realtime/redis-kick-audit"

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("appendKickEntries (merge bounded por usuário e por total)", () => {
  it("cria a entrada do usuário com count = nº de entries e histórico", () => {
    const next = appendKickEntries({}, "u1", [
      { reason: "session_limit", at: "2026-01-01T00:00:00.000Z", socketId: "s1" },
    ])
    expect(next["u1"]).toEqual({
      count: 1,
      entries: [{ reason: "session_limit", at: "2026-01-01T00:00:00.000Z", socketId: "s1" }],
    })
  })

  it("append acumula count e concatena o histórico (oldest → newest)", () => {
    const base = appendKickEntries({}, "u1", [
      { reason: "session_limit", at: "t1", socketId: "s1" },
    ])
    const next = appendKickEntries(base, "u1", [{ reason: "revoke", at: "t2", socketId: "s2" }])
    expect(next["u1"].count).toBe(2)
    expect(next["u1"].entries).toEqual([
      { reason: "session_limit", at: "t1", socketId: "s1" },
      { reason: "revoke", at: "t2", socketId: "s2" },
    ])
  })

  it("limita o histórico por usuário a historyMax (bounded — descarta os mais antigos)", () => {
    let stored: StoredKickAudit = {}
    for (let i = 0; i < KICK_HISTORY_MAX + 3; i++) {
      stored = appendKickEntries(stored, "u1", [
        { reason: "session_expired", at: `t${i}`, socketId: `s${i}` },
      ])
    }
    expect(stored["u1"].entries).toHaveLength(KICK_HISTORY_MAX)
    // Os últimos historyMax ficam (os 3 primeiros foram descartados).
    expect(stored["u1"].entries[0]).toMatchObject({ at: "t3" })
    expect(stored["u1"].count).toBe(KICK_HISTORY_MAX + 3) // count nunca é truncado
  })

  it("remove o usuário mais antigo quando o total passa de usersMax", () => {
    let stored: StoredKickAudit = {}
    for (let i = 0; i < KICK_USERS_MAX + 1; i++) {
      stored = appendKickEntries(stored, `user-${i}`, [
        { reason: "revoke", at: "t", socketId: "s" },
      ])
    }
    const keys = Object.keys(stored)
    expect(keys).toHaveLength(KICK_USERS_MAX)
    expect(keys[0]).not.toBe("user-0") // o mais antigo foi evicted
  })

  it("userId vazio ou entries vazio → no-op (retorna o mesmo objeto)", () => {
    const base: StoredKickAudit = {
      u1: { count: 1, entries: [{ reason: "revoke", at: "t", socketId: "s" }] },
    }
    expect(appendKickEntries(base, "", [{ reason: "revoke", at: "t", socketId: "s" }])).toBe(base)
    expect(appendKickEntries(base, "u2", [])).toBe(base)
  })
})

describe("storedToKickSnapshot (último kick + histórico — contrato da API)", () => {
  it("mapeia o stored para { reason, at, count, history } com o ÚLTIMO entry como atual", () => {
    const stored: StoredKickAudit = {
      u1: {
        count: 2,
        entries: [
          { reason: "session_limit", at: "t1", socketId: "s1" },
          { reason: "revoke", at: "t2", socketId: "s2" },
        ],
      },
    }
    const snap = storedToKickSnapshot(stored)
    expect(snap["u1"]).toEqual({
      reason: "revoke",
      at: "t2",
      count: 2,
      history: [
        { reason: "session_limit", at: "t1", socketId: "s1" },
        { reason: "revoke", at: "t2", socketId: "s2" },
      ],
    })
  })

  it("pula usuário sem entries (shape corrompido não quebra o snapshot)", () => {
    expect(storedToKickSnapshot({ u1: { count: 0, entries: [] } })).toEqual({})
  })

  it("stored vazio → snapshot vazio", () => {
    expect(storedToKickSnapshot({})).toEqual({})
  })

  it("carrega o max (limite por role) do ÚLTIMO entry no snapshot + history", () => {
    const stored: StoredKickAudit = {
      u1: {
        count: 2,
        entries: [
          { reason: "session_limit", at: "t1", socketId: "s1", max: 2 },
          { reason: "session_limit", at: "t2", socketId: "s2", max: 2 },
        ],
      },
    }
    const snap = storedToKickSnapshot(stored)
    expect(snap["u1"]!.max).toBe(2)
    expect(snap["u1"]!.history!.map((h) => h.max)).toEqual([2, 2])
  })

  it("entrada sem max → snapshot sem max (undefined — só session_limit carrega)", () => {
    const stored: StoredKickAudit = {
      u1: { count: 1, entries: [{ reason: "revoke", at: "t", socketId: "s" }] },
    }
    const snap = storedToKickSnapshot(stored)
    expect(snap["u1"]!.max).toBeUndefined()
    expect(snap["u1"]!.history![0]!.max).toBeUndefined()
  })
})

describe("parseStoredKickAudit (corrompido → {} — nunca lança)", () => {
  it("null/empty → {}", () => {
    expect(parseStoredKickAudit(null)).toEqual({})
    expect(parseStoredKickAudit("")).toEqual({})
  })

  it("JSON inválido → {}", () => {
    expect(parseStoredKickAudit("not-json{")).toEqual({})
  })

  it("sanitiza shape: filtra entries sem reason/at e normaliza count", () => {
    const raw = JSON.stringify({
      u1: {
        count: "3", // string numérica → 3
        entries: [
          { reason: "revoke", at: "t", socketId: "s" },
          { reason: "bogus", at: "t" }, // filtrado (reason inválida) — sobra a válida
          { at: "t" }, // filtrado (sem reason)
        ],
      },
      u2: { count: "x", entries: [] }, // count inválido → 0
    })
    const parsed = parseStoredKickAudit(raw)
    expect(parsed["u1"].count).toBe(3)
    expect(parsed["u1"].entries).toEqual([{ reason: "revoke", at: "t", socketId: "s" }])
    expect(parsed["u2"].count).toBe(0)
  })

  it("sanitiza max: válido (>=1, inteiro) é mantido; inválido é DERRUBADO", () => {
    const raw = JSON.stringify({
      u1: {
        count: 2,
        entries: [
          { reason: "session_limit", at: "t", socketId: "s1", max: 2 }, // ok
          { reason: "session_limit", at: "t", socketId: "s2", max: 0 }, // inválido → sem max
          { reason: "session_limit", at: "t", socketId: "s3", max: "2" }, // string → sem max
          { reason: "session_limit", at: "t", socketId: "s4", max: 2.9 }, // fracionário → floor 2
        ],
      },
    })
    const parsed = parseStoredKickAudit(raw)
    expect(parsed["u1"].entries[0]!.max).toBe(2)
    expect(parsed["u1"].entries[1]!.max).toBeUndefined()
    expect(parsed["u1"].entries[2]!.max).toBeUndefined()
    expect(parsed["u1"].entries[3]!.max).toBe(2)
  })
})

describe("parseKickAuditFlushIntervalMs (guard Math.max(1, env) || default)", () => {
  it("missing/empty/NaN/0 → fallback (5s)", () => {
    expect(parseKickAuditFlushIntervalMs(undefined)).toBe(KICK_AUDIT_FLUSH_INTERVAL_MS)
    expect(parseKickAuditFlushIntervalMs("")).toBe(KICK_AUDIT_FLUSH_INTERVAL_MS)
    expect(parseKickAuditFlushIntervalMs("abc")).toBe(KICK_AUDIT_FLUSH_INTERVAL_MS)
    expect(parseKickAuditFlushIntervalMs("0")).toBe(KICK_AUDIT_FLUSH_INTERVAL_MS)
  })

  it("valores válidos são clampados a >= 1s", () => {
    expect(parseKickAuditFlushIntervalMs("2000")).toBe(2000)
    expect(parseKickAuditFlushIntervalMs("500")).toBe(1000) // clamp mínimo
  })
})

// ---------------------------------------------------------------------------
// Persister (fake client — pool de 1 + cooldown + fail-open)
// ---------------------------------------------------------------------------

function fakeKickClient(): KickAuditRedisLike & {
  stored: string | null
  setexCalls: Array<[string, number, string]>
  failGet: boolean
  failSetex: boolean
} {
  const c = {
    stored: null as string | null,
    setexCalls: [] as Array<[string, number, string]>,
    failGet: false,
    failSetex: false,
    async get(_key: string) {
      if (c.failGet) throw new Error("redis down (get)")
      return c.stored
    },
    async setex(key: string, seconds: number, value: string) {
      if (c.failSetex) throw new Error("redis down (setex)")
      c.setexCalls.push([key, seconds, value])
      c.stored = value
      return "OK"
    },
  }
  return c
}

afterEach(() => {
  vi.useRealTimers()
})

describe("createKickAuditPersister", () => {
  it("flush() grava o audit no Redis: setex com a chave única + TTL 7d", async () => {
    const client = fakeKickClient()
    const p = createKickAuditPersister({ loadClient: async () => client })

    p.record("u1", "session_limit", "s1", "2026-01-01T00:00:00.000Z")
    p.record("u1", "revoke", "s2", "2026-01-01T00:00:01.000Z")
    await p.flush()

    expect(client.setexCalls).toHaveLength(1)
    const [key, ttl, value] = client.setexCalls[0]!
    expect(key).toBe(KICK_AUDIT_KEY)
    expect(ttl).toBe(KICK_AUDIT_TTL_S)
    expect(JSON.parse(value!)).toEqual({
      u1: {
        count: 2,
        entries: [
          { reason: "session_limit", at: "2026-01-01T00:00:00.000Z", socketId: "s1" },
          { reason: "revoke", at: "2026-01-01T00:00:01.000Z", socketId: "s2" },
        ],
      },
    })
  })

  it("record com max (limite por role) persiste o max no entry (session_limit)", async () => {
    const client = fakeKickClient()
    const p = createKickAuditPersister({ loadClient: async () => client })

    p.record("u1", "session_limit", "s1", "2026-01-01T00:00:00.000Z", 2)
    await p.flush()

    const stored = JSON.parse(client.setexCalls[0]![2]!) as StoredKickAudit
    expect(stored["u1"].entries[0]).toMatchObject({ reason: "session_limit", max: 2 })

    // snapshot expõe o max no último kick E no history (contrato do admin).
    const snap = await p.snapshot()
    expect(snap["u1"]!.max).toBe(2)
    expect(snap["u1"]!.history![0]!.max).toBe(2)
  })

  it("record sem max (revoke/session_expired) grava entry SEM max (undefined)", async () => {
    const client = fakeKickClient()
    const p = createKickAuditPersister({ loadClient: async () => client })

    p.record("u1", "revoke", "s1", "t1")
    p.record("u1", "session_expired", "s2", "t2")
    await p.flush()

    const stored = JSON.parse(client.setexCalls[0]![2]!) as StoredKickAudit
    expect(stored["u1"].entries.map((e) => e.max)).toEqual([undefined, undefined])
  })

  it("snapshot() lê o Redis E faz merge com o pending (kicks não flushed)", async () => {
    const client = fakeKickClient()
    client.stored = JSON.stringify({
      u1: {
        count: 1,
        entries: [{ reason: "session_limit", at: "t0", socketId: "s0" }],
      },
    })
    const p = createKickAuditPersister({ loadClient: async () => client })

    p.record("u1", "revoke", "s1", "t1") // ainda não flushed
    const snap = await p.snapshot()

    expect(snap["u1"].reason).toBe("revoke")
    expect(snap["u1"].count).toBe(2)
    expect(snap["u1"].history).toHaveLength(2)
    expect(snap["u1"].history!.map((h) => h.reason)).toEqual(["session_limit", "revoke"])
  })

  it("cooldown: multiple records batched — flush só acontece após o intervalo (fake timers)", async () => {
    vi.useFakeTimers()
    const client = fakeKickClient()
    const p = createKickAuditPersister({
      loadClient: async () => client,
      flushIntervalMs: 5_000,
    })

    p.record("u1", "session_limit", "s1", "t1")
    p.record("u1", "session_limit", "s2", "t2")
    // Antes do cooldown: nada gravado no Redis (debounce).
    expect(client.setexCalls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(4_999)
    expect(client.setexCalls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    // Coalesced: um único setex com os 2 kicks.
    expect(client.setexCalls).toHaveLength(1)
    const parsed = JSON.parse(client.setexCalls[0]![2]!) as StoredKickAudit
    expect(parsed["u1"].count).toBe(2)
  })

  it("pool de 1: flush concorrente é coalesced (um único write)", async () => {
    const client = fakeKickClient()
    const p = createKickAuditPersister({ loadClient: async () => client })
    p.record("u1", "revoke", "s1", "t1")

    await Promise.all([p.flush(), p.flush(), p.flush()])
    expect(client.setexCalls).toHaveLength(1)
  })

  it("RACE (regressão): kick gravado DURANTE o flush em voo não se perde — take-ownership", async () => {
    const client = fakeKickClient()
    // Gate no setex: o 1º flush fica pendurado no await do Redis (em voo).
    let releaseSetex: () => void = () => {}
    const setexGate = new Promise<void>((resolve) => {
      releaseSetex = resolve
    })
    const origSetex = client.setex.bind(client)
    client.setex = async (key, seconds, value) => {
      await setexGate
      return origSetex(key, seconds, value)
    }
    const p = createKickAuditPersister({ loadClient: async () => client })

    p.record("u1", "session_limit", "s1", "t1")
    const flushPromise = p.flush() // entra no doFlush e fica no await do setex

    // Durante o flush em voo, um NOVO kick chega → vai para o buffer NOVO
    // (o doFlush trocou o pending antes de qualquer await).
    p.record("u1", "revoke", "s2", "t2")

    releaseSetex()
    await flushPromise
    // O flush gravou só o batch (t1) — t2 ficou no pending novo, intacto.
    const first = JSON.parse(client.setexCalls[0]![2]!) as StoredKickAudit
    expect(first["u1"].count).toBe(1)
    expect(first["u1"].entries).toEqual([{ reason: "session_limit", at: "t1", socketId: "s1" }])

    // Próximo flush grava o t2 — nada se perdeu (merge com o Redis).
    await p.flush()
    const second = JSON.parse(client.setexCalls[1]![2]!) as StoredKickAudit
    expect(second["u1"].count).toBe(2)
    expect(second["u1"].entries.map((e) => e.at)).toEqual(["t1", "t2"])
  })

  it("fail-open: loadClient → null (sem REDIS_URL) — record não lança e snapshot cobre com pending", async () => {
    const p = createKickAuditPersister({ loadClient: async () => null })
    p.record("u1", "revoke", "s1", "t1")
    const snap = await p.snapshot()
    expect(snap["u1"]).toEqual({
      reason: "revoke",
      at: "t1",
      count: 1,
      history: [{ reason: "revoke", at: "t1", socketId: "s1" }],
    })
  })

  it("fail-open: erro do Redis (setex rejeita) → flush resolve sem lançar e o pending retenta no próximo ciclo", async () => {
    const client = fakeKickClient()
    client.failSetex = true
    const p = createKickAuditPersister({ loadClient: async () => client })

    p.record("u1", "revoke", "s1", "t1")
    await expect(p.flush()).resolves.toBeUndefined()

    // Redis volta → o mesmo pending é gravado no próximo flush.
    client.failSetex = false
    p.record("u1", "revoke", "s2", "t2")
    await p.flush()
    expect(client.setexCalls).toHaveLength(1)
    const parsed = JSON.parse(client.setexCalls[0]![2]!) as StoredKickAudit
    expect(parsed["u1"].count).toBe(2)
  })

  it("fail-open: loadClient rejeita → resolve sem lançar", async () => {
    const p = createKickAuditPersister({
      loadClient: async () => {
        throw new Error("boom")
      },
    })
    p.record("u1", "revoke", "s1", "t1")
    await expect(p.flush()).resolves.toBeUndefined()
    await expect(p.snapshot()).resolves.toMatchObject({ u1: { count: 1 } })
  })

  it("fail-open: get do Redis rejeita → snapshot usa só o pending", async () => {
    const client = fakeKickClient()
    client.failGet = true
    const p = createKickAuditPersister({ loadClient: async () => client })
    p.record("u1", "revoke", "s1", "t1")
    const snap = await p.snapshot()
    expect(snap["u1"].count).toBe(1)
  })

  it("record com userId vazio → no-op (nunca grava/agenda)", async () => {
    const client = fakeKickClient()
    const p = createKickAuditPersister({ loadClient: async () => client })
    p.record("", "revoke", "s1", "t1")
    await p.flush()
    expect(client.setexCalls).toHaveLength(0)
  })
})
