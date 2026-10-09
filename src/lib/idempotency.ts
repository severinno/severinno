/**
 * idempotency.ts — proteção contra criação duplicada de cobranças (Lytex).
 *
 * Problema: retry de rede, timeout do gateway ou duplo-clique no checkout
 * podem disparar duas criações de cobrança. A tabela `IdempotencyRecord`
 * garante que UMA chave (= UMA intenção de pagamento) cria UMA cobrança.
 *
 * Contrato do fluxo (ver pay route):
 *   1. `getIdempotencyKey(request)` extrai o header `Idempotency-Key`
 *      (valida formato; ausente → null → rota deriva uma chave server-side).
 *   2. `acquireIdempotency(key, context)` tenta RESERVAR a chave:
 *        - reserva concedida            → { kind: "fresh" }  → executa a criação;
 *        - chave existente "completed"  → { kind: "replay", response } → replay;
 *        - chave existente "processing" → { kind: "in_flight" } (409);
 *        - chave existente "failed"     → { kind: "failed", error } (409;
 *          o retry precisa de uma chave NOVA ou do fluxo de recuperação);
 *        - contexto divergente (mesma chave, outro booking/valor) → 409.
 *   3. A criação roda e `completeIdempotency(key, response)` grava o payload
 *      para futuros replays. Em erro, `failIdempotency(key, message)`.
 *
 * A CORRIDA entre dois requests simultâneos com a mesma chave é resolvida
 * pelo banco: o segundo INSERT fere o `@unique` e cai em "in_flight" — nunca
 * em uma segunda cobrança.
 */

import type { Prisma } from "@prisma/client" // apenas tipos (InputJsonValue) — runtime some sob o SSR do Vitest
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library"
import { db } from "./db"
import logger from "./logger"

/** Janela de replay: quanto tempo a resposta fica disponível para reenvio. */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/** Formato aceito para a chave enviada pelo cliente. */
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/

export class IdempotencyError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = "IdempotencyError"
    this.status = status
    this.code = code
  }
}

/**
 * Extrai e valida o header `Idempotency-Key`. Retorna null quando ausente
 * (a rota decide derivar uma chave server-side).
 */
export function getIdempotencyKey(request: Request): string | null {
  const raw = request.headers.get("idempotency-key")?.trim()
  if (!raw) return null
  if (!KEY_RE.test(raw)) {
    throw new IdempotencyError(
      "Idempotency-Key inválida: use 8–128 caracteres alfanuméricos (- e _ permitidos).",
      400,
      "IDEMPOTENCY_KEY_INVALID",
    )
  }
  return raw
}

/**
 * Deriva uma chave server-side determinística para uma intenção de pagamento
 * (booking + método). Cliente SEM header continua protegido: a mesma intenção
 * mapeia para a mesma chave. (Retry com intenção NOVA — regenerar PIX expirado,
 * por exemplo — deve vir com chave explícita do cliente.)
 */
export function deriveIdempotencyKey(bookingId: string, scope = "pay:create"): string {
  return `srv:${scope}:${bookingId}`
}

export type IdempotencyContext = Record<string, unknown>

export type AcquireResult =
  | { kind: "fresh" }
  | { kind: "replay"; response: unknown }
  | { kind: "in_flight" }
  | { kind: "failed"; error: string }
  | { kind: "conflict"; reason: string }

/**
 * Canonical deep equality check for idempotency context.
 * Key-order insensitive (unlike JSON.stringify) to prevent false conflicts
 * when objects have matching keys serialized in different order.
 */
export function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || typeof a !== "object" || b === null || typeof b !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false

  if (Array.isArray(a)) {
    const arrB = b as unknown[]
    if (a.length !== arrB.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], arrB[i])) return false
    }
    return true
  }

  const objA = a as Record<string, unknown>
  const objB = b as Record<string, unknown>
  const keysA = Object.keys(objA)
  const keysB = Object.keys(objB)

  if (keysA.length !== keysB.length) return false
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, k)) return false
    if (!isDeepEqual(objA[k], objB[k])) return false
  }
  return true
}

/**
 * Tenta reservar a chave. Ver o contrato no topo do arquivo.
 */
export async function acquireIdempotency(
  key: string,
  context: IdempotencyContext,
  scope = "pay:create",
): Promise<AcquireResult> {
  const now = new Date()

  // 1) Caminho rápido: já existe?
  const existing = await db.idempotencyRecord.findUnique({ where: { key } })

  if (existing) {
    // Registro expirado → tratar como inexistente (recria abaixo).
    if (existing.expiresAt <= now) {
      await db.idempotencyRecord.deleteMany({ where: { key, expiresAt: { lte: now } } })
    } else {
      // Mesma chave DEVE mapear para a MESMA operação (ordem de chaves não gera conflito falso).
      const sameContext = isDeepEqual(existing.context, context)
      if (!sameContext) {
        return {
          kind: "conflict",
          reason:
            "Idempotency-Key já usada para outra operação. Gere uma chave nova para uma nova intenção.",
        }
      }
      if (existing.scope !== scope) {
        return { kind: "conflict", reason: "Idempotency-Key já usada em outro escopo." }
      }
      switch (existing.status) {
        case "completed":
          return { kind: "replay", response: existing.response }
        case "processing":
          return { kind: "in_flight" }
        case "failed":
          return { kind: "failed", error: existing.error ?? "Execução anterior falhou" }
      }
    }
  }

  // 2) Reserva: INSERT único. Corrida → unique violation → o vencedor está
  //    "processing" e este request vira in_flight.
  try {
    await db.idempotencyRecord.create({
      data: {
        key,
        scope,
        context: context as Prisma.InputJsonValue,
        status: "processing",
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    })
    return { kind: "fresh" }
  } catch (e) {
    // PrismaClientKnownRequestError importado direto do runtime: o namespace
    // `Prisma` some sob o transform SSR do Vitest (mesmo problema do
    // Prisma.Decimal). Fallback duck-type por `code` protege a correção da
    // corrida contra qualquer quirk de bundler — falso negativo aqui custaria
    // uma segunda cobrança.
    if (
      (e instanceof PrismaClientKnownRequestError && e.code === "P2002") ||
      (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002")
    ) {
      return { kind: "in_flight" }
    }
    throw e
  }
}

/** Grava a resposta da primeira execução (para replay). */
export async function completeIdempotency(key: string, response: unknown): Promise<void> {
  await db.idempotencyRecord
    .update({
      where: { key },
      data: {
        status: "completed",
        response: response as Prisma.InputJsonValue,
        error: null,
      },
    })
    .catch((err) => {
      // Nunca falha a requisição original por causa do registro de replay.
      logger.warn({ err, key }, "idempotency: falha ao salvar resposta para replay")
    })
}

/** Marca a execução como falha (retry devolve o MESMO erro, sem recriar). */
export async function failIdempotency(key: string, error: string): Promise<void> {
  await db.idempotencyRecord
    .update({
      where: { key },
      data: { status: "failed", error },
    })
    .catch((err) => {
      logger.warn({ err, key }, "idempotency: falha ao registrar erro")
    })
}

/**
 * Poda GLOBAL de registros expirados (`expiresAt <= agora`).
 *
 * O `acquireIdempotency` remove expirados apenas POR CHAVE, quando aquela
 * chave volta a ser tocada — chaves que nunca mais aparecem ficariam na
 * tabela para sempre. Este podador roda no cron diário
 * (/api/cron/settlements) e mantém o crescimento da tabela limitado ao TTL
 * (24h) mais a folga entre execuções; o índice `@@index([expiresAt])` torna
 * o deleteMany um range delete barato.
 *
 * Retorna o número de registros removidos. PROPAGA erro do banco — o
 * chamador decide se a poda é crítica (no cron ela é secundária).
 */
export async function pruneExpiredIdempotencyRecords(): Promise<number> {
  const result = await db.idempotencyRecord.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  })
  return result.count
}

/**
 * Resposta HTTP padronizada para os estados que NÃO executam a criação.
 * A rota retorna isso direto quando acquire não devolve "fresh".
 */
export function idempotencyErrorResponse(result: AcquireResult): {
  status: number
  body: Record<string, unknown>
} | null {
  switch (result.kind) {
    case "replay":
      return null // a rota devolve o próprio response gravado com 200
    case "in_flight":
      return {
        status: 409,
        body: {
          error: "Pagamento já em processamento para esta chave. Tente novamente em instantes.",
          code: "IDEMPOTENCY_IN_FLIGHT",
        },
      }
    case "failed":
      return {
        status: 409,
        body: {
          error: `Tentativa anterior com esta chave falhou: ${result.error}. Gere uma nova chave para tentar novamente.`,
          code: "IDEMPOTENCY_FAILED",
        },
      }
    case "conflict":
      return {
        status: 409,
        body: { error: result.reason, code: "IDEMPOTENCY_CONFLICT" },
      }
    case "fresh":
      return null
  }
}
