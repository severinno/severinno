/**
 * Tests for mini-services/realtime/redis-adapter.ts
 *
 * Covers the Redis adapter loader/attach used for horizontal scaling (N
 * réplicas do realtime compartilhando rooms/broadcasts via Redis pub/sub):
 * the pure `shouldUseRedisAdapter` decision, the promise-memoized loader
 * with its fail-open contract (no REDIS_URL → null; failure NOT memoized →
 * next load() retries), and `attachRedisAdapter` (io.adapter wiring, the
 * state exposed on /health, and close on shutdown). No ioredis, no
 * @socket.io/redis-adapter, no network — deps are injected fakes.
 */

import { describe, it, expect, vi } from "vitest"
import {
  REDIS_ADAPTER_KEY,
  shouldUseRedisAdapter,
  createRedisAdapterLoader,
  attachRedisAdapter,
  type RedisAdapterDeps,
  type RedisClientPair,
} from "../../../mini-services/realtime/redis-adapter"

// ---------------------------------------------------------------------------
// Pure decision
// ---------------------------------------------------------------------------

describe("shouldUseRedisAdapter — decide se o adapter DEVE ser usado", () => {
  it("true quando REDIS_URL existe", () => {
    expect(shouldUseRedisAdapter("redis://localhost:6379")).toBe(true)
    expect(shouldUseRedisAdapter("redis://:pass@redis:6379/0")).toBe(true)
  })

  it("false (fail-open single-node) quando REDIS_URL falta/vazia", () => {
    expect(shouldUseRedisAdapter(undefined)).toBe(false)
    expect(shouldUseRedisAdapter("")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Loader (fail-open contract + memoização)
// ---------------------------------------------------------------------------

/** Deps com readSecret fake (hermético — nunca lê o env real). */
function depsWith(overrides: Partial<RedisAdapterDeps> = {}): RedisAdapterDeps {
  return {
    readSecret: () => "redis://localhost:6379",
    ...overrides,
  }
}

function fakeClients(): RedisClientPair & { closed: boolean } {
  const c: RedisClientPair & { closed: boolean } = {
    pub: { id: "pub" },
    sub: { id: "sub" },
    closed: false,
    close: async () => {
      c.closed = true
    },
  }
  return c
}

describe("createRedisAdapterLoader", () => {
  it("fail-open: sem REDIS_URL → resolve null SEM tocar nas factories", async () => {
    const createClientPair = vi.fn()
    const createAdapter = vi.fn()
    const loader = createRedisAdapterLoader({
      readSecret: () => undefined,
      createClientPair,
      createAdapter,
    })
    await expect(loader()).resolves.toBeNull()
    expect(createClientPair).not.toHaveBeenCalled()
    expect(createAdapter).not.toHaveBeenCalled()
  })

  it("sucesso: cria o par pub/sub com a REDIS_URL e attacha o factory", async () => {
    const clients = fakeClients()
    const createClientPair = vi.fn(async () => clients)
    const adapterFactory = { createAdapter: vi.fn((pub: unknown, sub: unknown) => ({ pub, sub })) }
    const loader = createRedisAdapterLoader({
      ...depsWith(),
      createClientPair,
      createAdapter: adapterFactory.createAdapter,
    })

    const handle = await loader()
    expect(handle).not.toBeNull()
    expect(createClientPair).toHaveBeenCalledWith("redis://localhost:6379")
    expect(adapterFactory.createAdapter).toHaveBeenCalledWith(clients.pub, clients.sub)
    expect(handle!.adapter).toEqual({ pub: clients.pub, sub: clients.sub })
    expect(handle!.close).toBe(clients.close)
  })

  it("é promise-memoizado: chamadas repetidas resolvem o MESMO handle", async () => {
    const clients = fakeClients()
    const loader = createRedisAdapterLoader({
      ...depsWith(),
      createClientPair: vi.fn(async () => clients),
      createAdapter: vi.fn(() => ({ factory: 1 })),
    })
    const a = loader()
    const b = loader()
    expect(a).toBe(b) // mesma promise — um único connect por loader
    await expect(a).resolves.not.toBeNull()
    await expect(b).resolves.not.toBeNull()
  })

  it("fail-open SEM memoizar a falha: createClientPair null → próximo load() retenta (auto-recuperação)", async () => {
    const createClientPair = vi
      .fn<() => Promise<RedisClientPair | null>>()
      .mockResolvedValueOnce(null) // Redis fora no boot
      .mockResolvedValueOnce(fakeClients()) // voltou
    const loader = createRedisAdapterLoader({
      ...depsWith(),
      createClientPair,
      createAdapter: vi.fn(() => ({ factory: 1 })),
    })

    await expect(loader()).resolves.toBeNull()
    const handle = await loader()
    expect(handle).not.toBeNull() // a falha NÃO ficou memoizada — retentou
    expect(createClientPair).toHaveBeenCalledTimes(2)
  })

  it("fail-open SEM memoizar a falha: createAdapter lança → próximo load() retenta", async () => {
    const createAdapter = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ factory: 1 })
    const loader = createRedisAdapterLoader({
      ...depsWith(),
      createClientPair: vi.fn(async () => fakeClients()),
      createAdapter,
    })

    await expect(loader()).resolves.toBeNull()
    const handle = await loader()
    expect(handle).not.toBeNull()
    expect(createAdapter).toHaveBeenCalledTimes(2)
  })

  it("createClientPair lança → fail-open null (nunca rejeita para o caller)", async () => {
    const loader = createRedisAdapterLoader({
      ...depsWith(),
      createClientPair: vi.fn(async () => {
        throw new Error("redis down")
      }),
      createAdapter: vi.fn(),
    })
    await expect(loader()).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Attach (io.adapter + estado /health + close no shutdown)
// ---------------------------------------------------------------------------

describe("attachRedisAdapter", () => {
  it("attachado: chama io.adapter(factory) e devolve { attached: true, mode: 'redis', close }", async () => {
    const clients = fakeClients()
    const io = { adapter: vi.fn() }
    const state = await attachRedisAdapter(io as never, async () => ({
      adapter: { factory: "adapter" },
      close: clients.close,
    }))

    expect(io.adapter).toHaveBeenCalledWith({ factory: "adapter" })
    expect(state.attached).toBe(true)
    expect(state.mode).toBe("redis")
    await state.close()
    expect(clients.closed).toBe(true)
  })

  it("fail-open: loader → null → { attached: false, mode: 'local' } e close é no-op", async () => {
    const io = { adapter: vi.fn() }
    const state = await attachRedisAdapter(io as never, async () => null)
    expect(io.adapter).not.toHaveBeenCalled()
    expect(state.attached).toBe(false)
    expect(state.mode).toBe("local")
    await expect(state.close()).resolves.toBeUndefined() // close nunca lança
  })

  it("fail-open: loader rejeita → local, io.adapter NÃO é chamado, close no-op", async () => {
    const io = { adapter: vi.fn() }
    const state = await attachRedisAdapter(io as never, async () => {
      throw new Error("boom")
    })
    expect(io.adapter).not.toHaveBeenCalled()
    expect(state.attached).toBe(false)
    expect(state.mode).toBe("local")
    await expect(state.close()).resolves.toBeUndefined()
  })

  it("io.adapter() lança APÓS o load OK → local MAS os clients pub/sub são fechados (sem leak)", async () => {
    // Regressão do reviewer: um erro no attach não pode vazar as conexões
    // Redis recém-criadas (o catch interno fecha best-effort antes do local).
    const clients = fakeClients()
    const io = {
      adapter: vi.fn(() => {
        throw new Error("adapter attach boom")
      }),
    }
    const state = await attachRedisAdapter(io as never, async () => ({
      adapter: { factory: "adapter" },
      close: clients.close,
    }))
    expect(io.adapter).toHaveBeenCalledWith({ factory: "adapter" })
    expect(state.attached).toBe(false)
    expect(state.mode).toBe("local")
    expect(clients.closed).toBe(true) // sem leak dos pub/sub
    await expect(state.close()).resolves.toBeUndefined()
  })

  it("REDIS_ADAPTER_KEY é a fonte única da key do namespace", () => {
    expect(REDIS_ADAPTER_KEY).toBe("realtime-adapter")
  })
})
