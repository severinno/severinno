/**
 * src/lib/performance.ts — Instrumentação de performance
 *
 * Fornece helpers para criar transações e spans rastreados pelo Sentry/GlitchTip,
 * além de métricas locais de performance armazenadas em Redis.
 *
 * Uso:
 *   import { measureDb, measureExternal, trackApiRoute } from "@/lib/performance"
 *
 *   // Medir query no banco
 *   const users = await measureDb("User.findMany", () => db.user.findMany(...))
 *
 *   // Medir chamada externa
 *   const result = await measureExternal("Evolution API", () => evolutionRequest(...))
 *
 *   // Rastrear rota de API (usado nas rotas)
 *   await trackApiRoute("POST /api/bookings", req, async () => { ... })
 */

import "server-only"
import * as Sentry from "@sentry/nextjs"
import logger from "./logger"

// ── Config ────────────────────────────────────────────────────────────────

const ENABLED = process.env.SENTRY_DSN ? process.env.NODE_ENV === "production" : false

// ── Tipos ─────────────────────────────────────────────────────────────────

export interface SpanOptions {
  /** Nome descritivo da operação (ex: "db.users.findMany") */
  op: string
  /** Descrição detalhada (ex: "Buscar usuários ativos com role PROVIDER") */
  description?: string
  /** Tags adicionais para o span */
  tags?: Record<string, string>
  /** Dados extras */
  data?: Record<string, unknown>
}

export interface TransactionResult<T> {
  data: T
  durationMs: number
}

// ── Helper: escapar de async_hooks para Sentry spans ──────────────────────

/**
 * Inicia um span filho da transação atual e executa `fn`.
 * Retorna o resultado + duração em ms.
 *
 * Se o Sentry não estiver configurado ou não houver transação ativa,
 * apenas executa a função e mede o tempo.
 */
export async function startSpan<T>(
  options: SpanOptions,
  fn: () => Promise<T> | T,
): Promise<TransactionResult<T>> {
  const start = performance.now()

  // Se Sentry está ativo, cria um span rastreado
  if (ENABLED) {
    try {
      return await Sentry.startSpan(
        {
          op: options.op,
          name: options.description ?? options.op,
        },
        async (span) => {
          if (options.tags && span) {
            Object.entries(options.tags).forEach(([k, v]) => span.setAttribute(k, v))
          }
          if (options.data && span) {
            Object.entries(options.data).forEach(([k, v]) => span.setAttribute(k, String(v)))
          }
          const result = await fn()
          const durationMs = performance.now() - start
          return { data: result, durationMs }
        },
      )
    } catch (err) {
      Sentry.captureException(err, {
        tags: { op: options.op, ...options.tags },
      })
      throw err
    }
  }

  // Fallback: apenas mede o tempo
  const result = await fn()
  const durationMs = performance.now() - start
  return { data: result, durationMs }
}

/**
 * Versão síncrona de startSpan, para operações que não são async.
 */
export function startSpanSync<T>(options: SpanOptions, fn: () => T): TransactionResult<T> {
  const start = performance.now()

  if (ENABLED) {
    try {
      return Sentry.startSpan(
        {
          op: options.op,
          name: options.description ?? options.op,
        },
        (span) => {
          if (options.tags && span) {
            Object.entries(options.tags).forEach(([k, v]) => span.setAttribute(k, v))
          }
          if (options.data && span) {
            Object.entries(options.data).forEach(([k, v]) => span.setAttribute(k, String(v)))
          }
          const result = fn()
          const durationMs = performance.now() - start
          return { data: result, durationMs }
        },
      )
    } catch (err) {
      Sentry.captureException(err, {
        tags: { op: options.op, ...options.tags },
      })
      throw err
    }
  }

  const result = fn()
  const durationMs = performance.now() - start
  return { data: result, durationMs }
}

// ── Helpers específicos ───────────────────────────────────────────────────

/**
 * Mede performance de uma query no banco de dados.
 */
export async function measureDb<T>(
  queryName: string,
  fn: () => Promise<T>,
  tags?: Record<string, string>,
): Promise<TransactionResult<T>> {
  return startSpan(
    {
      op: `db.${queryName}`,
      description: `Database query: ${queryName}`,
      tags: { db: "postgresql", ...tags },
    },
    fn,
  )
}

/**
 * Mede performance de uma chamada a API externa (Evolution, Lytex, etc.).
 */
export async function measureExternal<T>(
  serviceName: string,
  fn: () => Promise<T>,
  tags?: Record<string, string>,
): Promise<TransactionResult<T>> {
  return startSpan(
    {
      op: `http.${serviceName}`,
      description: `External API: ${serviceName}`,
      tags: { external: serviceName, ...tags },
    },
    fn,
  )
}

/**
 * Mede performance de cache (Redis).
 */
export async function measureCache<T>(
  operation: string,
  fn: () => Promise<T>,
  tags?: Record<string, string>,
): Promise<TransactionResult<T>> {
  return startSpan(
    {
      op: `cache.${operation}`,
      description: `Cache: ${operation}`,
      tags: { cache: "redis", ...tags },
    },
    fn,
  )
}

// ── Logger de performance (independente de Sentry) ────────────────────────

/**
 * Loga métricas de performance no logger (pino) com nível `debug`.
 * Útil para diagnóstico mesmo sem Sentry.
 */
export function logPerformance(
  operation: string,
  durationMs: number,
  tags?: Record<string, unknown>,
): void {
  if (durationMs > 1000) {
    // Operações lentas (>1s) viram warning
    logger.warn(
      { operation, durationMs: Math.round(durationMs), ...tags },
      `[perf] SLOW: ${operation} took ${Math.round(durationMs)}ms`,
    )
  } else if (durationMs > 200) {
    // Operações moderadas viram info
    logger.info(
      { operation, durationMs: Math.round(durationMs), ...tags },
      `[perf] ${operation} (${Math.round(durationMs)}ms)`,
    )
  }
}
