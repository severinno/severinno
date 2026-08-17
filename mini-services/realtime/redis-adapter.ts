/**
 * Severinno Marketplace SaaS — Realtime Mini-Service: Redis adapter
 * (escala horizontal)
 *
 * Attaches the socket.io Redis adapter (@socket.io/redis-adapter) so ROOMS e
 * BROADCASTS são compartilhados entre N réplicas do realtime:
 *
 *   io.adapter(createAdapter(pubClient, subClient, { key }))
 *
 * Sem o adapter, cada réplica só vê os próprios sockets: um `io.to(user:{id})`
 * emitido na réplica A nunca alcança um socket conectado na réplica B. Com o
 * adapter, o emit vira um publish no Redis e TODAS as réplicas entregam aos
 * membros locais da sala (fan-out via subscribe).
 *
 * CONTRATO DE CONSISTÊNCIA entre réplicas (documentado também no README):
 *   - ROOMS/broadcasts: globais (é o ponto do adapter).
 *   - fetchSockets() (adapter v8): global — os sweeps de TTL, limite de
 *     sessões, revoke e órfãos passam a enxergar sockets de TODAS as réplicas
 *     (mais correto que o escopo por-réplica anterior). PORÉM o socket.data é
 *     serializado via JSON no transporte cross-node: campos custom devem ser
 *     JSON-serializáveis (a VerifiedSession é: userId/role/expiresAt —
 *     strings/number). Dados não-serializáveis chegam vazios na réplica remota.
 *   - Estado in-memory (emitCounters, recentEmits, renew/expired counters,
 *     pending do kick audit): PERMANECE por processo — o /health de cada
 *     réplica mostra só o que ELA processou; o /metrics agregado via Redis
 *     soma os deltas de todas (buckets de minuto, hincrby) e a flag multi usa
 *     MAX por minuto — corretos.
 *   - STICKY SESSIONS obrigatórias no gateway (Caddy lb_policy cookie): a
 *     CONEXÃO socket.io (handshake + polling + upgrade) é estado in-memory do
 *     engine.io da réplica que a aceitou — o adapter compartilha salas, não
 *     conexões. Sem sticky, um polling que cai noutra réplica quebra a sessão.
 *   - Redis é single point para cross-replica: se cair, cada réplica continua
 *     degradada (broadcasts só alcançam sockets locais) e o adapter loga
 *     erros; requestsTimeout evita hangs nos broadcasts.
 *
 * FAIL-OPEN: sem REDIS_URL ou erro no connect/createAdapter → o loader
 * devolve null e o serviço roda em modo single-node (comportamento atual).
 * A falha NÃO é memoizada — o próximo load() tenta de novo (auto-recuperação,
 * mesmo padrão do createRedisLoader da telemetria).
 *
 * Deps INJETÁVEIS (duck-typed) para testes unitários herméticos: o módulo
 * nunca importa ioredis/@socket.io/redis-adapter no topo — os factories
 * default usam dynamic import; testes passam fakes.
 */

import { readSecret } from "./security"

// ---------------------------------------------------------------------------
// Key do adapter (namespace do pub/sub no Redis — compartilhado por todas as
// réplicas; um valor único evita colisão com outros apps no mesmo Redis).
// ---------------------------------------------------------------------------

/** Prefixo das chaves/canais do adapter no Redis. Fonte única — usado pelo
 *  factory default e exposto no /health para ops confirmar o modo. */
export const REDIS_ADAPTER_KEY = "realtime-adapter"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Par de clientes Redis (pub + sub) — o adapter precisa de DOIS clientes
 *  (um para publish, um para subscribe). `close` desconecta ambos. */
export interface RedisClientPair {
  pub: unknown
  sub: unknown
  close: () => Promise<void>
}

/** Handle do adapter attachado: `adapter` é o factory passado ao io.adapter()
 *  e `close` encerra os clientes pub/sub no graceful shutdown. */
export interface RedisAdapterHandle {
  adapter: unknown
  close: () => Promise<void>
}

/** Estado pós-attach (o que o /health expõe). */
export interface RedisAdapterState {
  attached: boolean
  mode: "redis" | "local"
  close: () => Promise<void>
}

/** Loader promise-memoizado: resolve o handle do adapter ou null (fail-open). */
export type RedisAdapterLoader = () => Promise<RedisAdapterHandle | null>

/** Deps injetáveis (testes passam fakes; o serviço usa os defaults). */
export interface RedisAdapterDeps {
  readSecret?: (name: string) => string | undefined
  /** Cria o par pub/sub a partir da REDIS_URL. Retorna null em falha. */
  createClientPair?: (url: string) => Promise<RedisClientPair | null>
  /** Cria o factory do adapter a partir dos dois clientes. */
  createAdapter?: (pub: unknown, sub: unknown) => unknown
}

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

/** Decide se o adapter DEVE ser usado: presente quando REDIS_URL existe.
 *  Fail-open — sem REDIS_URL → single-node (nenhuma sincronia cross-replica,
 *  que é exatamente o comportamento atual sem o adapter). Pura. */
export function shouldUseRedisAdapter(url: string | undefined): boolean {
  return Boolean(url)
}

// ---------------------------------------------------------------------------
// Default factories (lazy dynamic imports — nunca resolvidos em testes)
// ---------------------------------------------------------------------------

async function defaultCreateClientPair(url: string): Promise<RedisClientPair | null> {
  try {
    const { Redis } = await import("ioredis")
    const pub = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })
    // O adapter precisa de DOIS clientes: pub (publish) + sub (subscribe).
    // duplicate() herda a config da conexão base (mesmo host/credenciais).
    const sub = pub.duplicate()
    pub.on("error", (err: unknown) => {
      console.error("[realtime] redis adapter pub error:", err)
    })
    sub.on("error", (err: unknown) => {
      console.error("[realtime] redis adapter sub error:", err)
    })
    await Promise.all([pub.connect(), sub.connect()])
    return {
      pub,
      sub,
      close: async () => {
        sub.disconnect()
        pub.disconnect()
      },
    }
  } catch (err) {
    console.error("[realtime] could not create redis adapter clients (fail-open):", err)
    return null
  }
}

async function defaultCreateAdapter(pub: unknown, sub: unknown): Promise<unknown> {
  const { createAdapter } = await import("@socket.io/redis-adapter")
  return createAdapter(pub as never, sub as never, {
    key: REDIS_ADAPTER_KEY,
    // Timeout do round-trip de um broadcast cross-replica (ex.: o ack de
    // fetchSockets via adapter). Evita que um Redis lento/fora pendure emits.
    requestsTimeout: 5_000,
  })
}

// ---------------------------------------------------------------------------
// Loader + attach
// ---------------------------------------------------------------------------

/**
 * Cria o loader do adapter (promise-memoizado). Fail-open:
 *   - sem REDIS_URL → null (single-node);
 *   - createClientPair/createAdapter falham → null, SEM memoizar a falha
 *     (o próximo load() tenta de novo — auto-recuperação quando o Redis volta).
 *
 * Deps injetáveis: o serviço chama `createRedisAdapterLoader()` (defaults
 * ioredis + @socket.io/redis-adapter); testes injetam fakes herméticos.
 */
export function createRedisAdapterLoader(deps: RedisAdapterDeps = {}): RedisAdapterLoader {
  const readSecretFn = deps.readSecret ?? readSecret
  const createClientPair = deps.createClientPair ?? defaultCreateClientPair
  const createAdapter = deps.createAdapter ?? defaultCreateAdapter
  let memo: Promise<RedisAdapterHandle | null> | null = null
  return () => {
    memo ??= (async () => {
      const url = readSecretFn("REDIS_URL")
      if (!url) {
        console.warn(
          "[realtime] ⚠️ REDIS_URL not configured — Redis adapter DISABLED (single-node rooms; N réplicas não compartilham salas sem o adapter)",
        )
        return null
      }
      try {
        const clients = await createClientPair(url)
        if (!clients) {
          // Connect/init falhou — o default factory engole o erro e devolve
          // null (nunca lança), então SEM o reset o null ficaria memoizado e
          // o adapter nunca tentaria de novo. Mesmo contrato do throw abaixo:
          // a falha NÃO é memoizada — o próximo load() tenta de novo.
          memo = null
          return null
        }
        const adapter = await createAdapter(clients.pub, clients.sub)
        return { adapter, close: clients.close }
      } catch (err) {
        // Não memoiza a falha: um Redis fora no BOOT não pode deixar o adapter
        // permanentemente desligado (mesmo padrão do createRedisLoader).
        memo = null
        console.error("[realtime] could not load redis adapter (fail-open, single-node):", err)
        return null
      }
    })()
    return memo
  }
}

/**
 * Attach o adapter ao io (se o loader resolver um handle) e devolve o estado
 * para o /health + shutdown. O io é tipado estruturalmente (só io.adapter)
 * para o helper ser testável sem socket.io.
 *
 * @param io        servidor socket.io (estrutural: só precisa de .adapter())
 * @param loadAdapter loader do adapter (createRedisAdapterLoader)
 * @returns { attached, mode, close } — close encerra os clientes pub/sub no
 *          shutdown; close é no-op quando não attachado.
 */
export async function attachRedisAdapter(
  io: { adapter: (factory: unknown) => void },
  loadAdapter: RedisAdapterLoader,
): Promise<RedisAdapterState> {
  try {
    const handle = await loadAdapter()
    if (handle) {
      try {
        io.adapter(handle.adapter)
        console.log(
          "[realtime] Redis adapter attached — rooms/broadcasts compartilhados entre réplicas",
        )
        return { attached: true, mode: "redis", close: handle.close }
      } catch (err) {
        // Fail-open: um erro do io.adapter() (raro) NÃO pode vazar os clientes
        // pub/sub recém-criados — fecha best-effort antes de cair para local.
        console.error("[realtime] redis adapter attach error (fail-open, single-node):", err)
        await handle.close().catch(() => {})
      }
    }
  } catch (err) {
    console.error("[realtime] redis adapter attach error (fail-open, single-node):", err)
  }
  return { attached: false, mode: "local", close: async () => {} }
}
