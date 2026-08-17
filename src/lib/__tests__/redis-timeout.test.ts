/**
 * redis-timeout.test.ts
 *
 * Hang protection do cliente Redis (src/lib/redis.ts):
 *   - REDIS_CONNECT_TIMEOUT_MS — handshake TCP/connect (default 10s)
 *   - REDIS_COMMAND_TIMEOUT_MS — comando sem resposta (default 5s)
 *
 * Segue o padrão do realtime-client.test.ts / api-timeout.test.ts: um serviço
 * que aceita TCP mas nunca responde. Aqui o servidor é TCP REAL (node:net) e
 * o cliente é o ioredis REAL — se o commandTimeout não estivesse wireado, o
 * cacheGet/cacheSet penduraria para sempre (o teste falharia por timeout).
 *
 * Com o timeout, o comando aborta e a cadeia de tiers degrada (standalone →
 * memory), devolvendo o valor da memória — a request completa em tempo finito.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import net from "node:net"
import type { Server, Socket } from "node:net"

// O vitest.setup.ts mocka ioredis GLOBALMENTE (previne "Unhandled error
// event" nos testes de rate-limit). Este arquivo quer o ioredis REAL (o hang
// é contra um servidor TCP real) — restaura via importOriginal, mesmo padrão
// do api-timeout.test.ts contra o mock global de @/lib/api.
vi.mock("ioredis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ioredis")>()
  return { ...actual }
})

// ── TCP server que aceita conexões mas NUNCA responde (o cenário do hang) ──
function startHangingRedisServer(): Promise<{ server: Server; port: number; sockets: Socket[] }> {
  return new Promise((resolve) => {
    const sockets: Socket[] = []
    const server = net.createServer((socket) => {
      sockets.push(socket)
      socket.on("error", () => {
        /* cliente abortou a conexão — ok */
      })
      // Aceita o TCP mas nunca envia nenhuma resposta.
    })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      resolve({
        server,
        port: typeof addr === "object" && addr !== null ? addr.port : 0,
        sockets,
      })
    })
  })
}

function cleanupHangingServer(server: Server, sockets: Socket[]): void {
  for (const s of sockets) {
    try {
      s.destroy()
    } catch {
      /* ignore */
    }
  }
  server.close()
}

afterEach(() => {
  delete process.env.REDIS_URL
  delete process.env.REDIS_COMMAND_TIMEOUT_MS
  delete process.env.REDIS_CONNECT_TIMEOUT_MS
  vi.resetModules()
})

describe("Redis hang protection (TCP aceita, nunca responde)", () => {
  it(
    "cacheSet + cacheGet não travam com comando pendurado (commandTimeout aborta " +
      "e a cadeia degrada para a memória)",
    async () => {
      const { server, port, sockets } = await startHangingRedisServer()
      try {
        // O módulo lê as envs no import (consts de topo) — precisa resetModules
        // + env antes do import dinâmico.
        vi.resetModules()
        process.env.REDIS_URL = `redis://127.0.0.1:${port}`
        process.env.REDIS_COMMAND_TIMEOUT_MS = "150"
        process.env.REDIS_CONNECT_TIMEOUT_MS = "150"

        const redis = await import("@/lib/redis")

        const started = Date.now()
        // cacheSet grava na memória primeiro e tenta o Redis (que vai abortar
        // por commandTimeout → degrada para memory). Não pode pendurar.
        await redis.cacheSet("hang:key", "valor", 60)
        // cacheGet cai na memória — retorna o valor sem tocar no Redis.
        const value = await redis.cacheGet<string>("hang:key")
        const elapsed = Date.now() - started

        expect(value).toBe("valor")
        // Bounded: 150ms × retries/backoff do ioredis, nunca "para sempre".
        expect(elapsed).toBeLessThan(3_000)
        // Degradou de standalone → memory (disponibilidade do Redis perdida).
        expect(redis.getCacheStats().activeTier).toBe("memory")
      } finally {
        cleanupHangingServer(server, sockets)
      }
    },
  )

  it("wirea commandTimeout/connectTimeout no cliente standalone a partir das envs", async () => {
    vi.resetModules()
    process.env.REDIS_URL = "redis://127.0.0.1:6379"
    process.env.REDIS_COMMAND_TIMEOUT_MS = "150"
    process.env.REDIS_CONNECT_TIMEOUT_MS = "150"

    const redis = await import("@/lib/redis")
    const client = redis.getClient() as unknown as {
      options?: { commandTimeout?: number; connectTimeout?: number }
    }

    // lazyConnect: true → nenhuma conexão é aberta ao criar o client.
    expect(client.options?.commandTimeout).toBe(150)
    expect(client.options?.connectTimeout).toBe(150)
  })
})
