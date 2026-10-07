/**
 * auth-rate-limit.ts — rate limit PROGRESSIVO por fingerprint de sessão.
 *
 * Camada adicional às que já existem nas rotas de autenticação:
 *
 *   1. `assertRateLimit(request, RATE_LIMITS.login)` — volume por IP
 *      (janela fixa, Redis atômico — rate-limit.ts);
 *   2. lockout por E-MAIL (login/route.ts — 5 falhas → 15 min bloqueado);
 *   3. ESTA lib — atraso progressivo por FINGERPRINT (IP + hash de
 *      user-agent/accept, via getCompositeFingerprint de
 *      rate-limit-shared.ts — mesma identidade dos limiters global/rota).
 *
 * Por que progressivo (delay) e não bloqueio fixo: o fingerprint é
 * FRACO — um atacante com rotação de IP/user-agent simplesmente gera um
 * fingerprint novo e zera o contador. Um lockout rígido por fingerprint
 * causaria DoS trivial (bloquear a VÍTIMA forjando o fingerprint dela atrás
 * de NAT compartilhado). O delay progressivo, em vez disso, encarece cada
 * tentativa do fingerprint sem negar a resposta — combinado com o lockout
 * por e-mail (que é a identidade real atacada), fecha a lacuna: quem varia
 * IP para fugir do limite por IP continua batendo no lockout da conta; quem
 * martela UMA origem espera cada vez mais antes de cada tentativa.
 *
 * Escada (windowMs = 10 min, RAMP_FREE = 3 tentativas "de graça"):
 *   tentativas 0..2   → sem atraso (login normal, digitação errada, 2FA)
 *   3                 → 0.5s
 *   4                 → 1s
 *   5                 → 2s   6 → 4s   7+ → teto de 8s (DELAY_CAP_MS)
 * O contador decai sozinho: cada tentativa expira 10 min após feita
 * (ZSET com score = timestamp; poda por CUTOFF a cada leitura).
 *
 * Armazenamento: mem cache do @/lib/redis (MESMA camada do lockout por
 * e-mail — degrada junto, um mock só nos testes). O custo é uma leitura +
 * escrita JSON por request de auth, sem rede quando o tier é "memory".
 *
 * Contrato para as rotas:
 *   const guard = await authFingerprintGuard(request, "login")
 *   if (guard.blocked) return guard.response!        // 429 + Retry-After
 *   ... handler ...
 *   if (falhou) await guard.recordFailure()          // satura a escada
 *   // sucesso: nada a fazer — não satura
 */

import { NextResponse } from "next/server"
import { getCompositeFingerprint } from "@/lib/rate-limit-shared"
import { cacheGet, cacheSet } from "@/lib/redis"
import logger from "@/lib/logger"

// ── Parâmetros da escada progressiva ───────────────────────────────────────

/** Janela do contador de falhas por fingerprint (10 minutos). */
export const FINGERPRINT_WINDOW_SECONDS = 600

/** Tentativas sem atraso — tolerância para digitação errada + fluxo 2FA. */
export const RAMP_FREE_ATTEMPTS = 3

/** Atraso da 1ª tentativa saturada (a N-ésima satura para base * 2^(n-N)). */
export const RAMP_BASE_MS = 500

/** Teto do atraso progressivo. */
export const DELAY_CAP_MS = 8_000

/** Limite duro: acima deste nº de tentativas na janela, resposta 429 imediata. */
export const HARD_LIMIT = 12

/** Overrides só de teste — aceleram a escada sem dormidas reais longas. */
export interface LadderOverrides {
  baseMs?: number
  capMs?: number
}

const PREFIX = "auth:fp:"

// ── Tipos ───────────────────────────────────────────────────────────────────

export type FingerprintGuard =
  | {
      fingerprint: string
      blocked: true
      /** Resposta 429 com Retry-After. */
      response: NextResponse
      recordFailure: () => Promise<void>
    }
  | {
      fingerprint: string
      blocked: false
      response: null
      /** Registra falha de credencial/código para ESTE fingerprint. */
      recordFailure: () => Promise<void>
    }

interface StoredEntry {
  /** Timestamps (ms) das tentativas dentro da janela. */
  hits: number[]
}

// ── Núcleo ──────────────────────────────────────────────────────────────────

/**
 * Atraso aplicado à N-ésima tentativa (0-based). Escada exponencial com teto:
 * 0..2 livres, 3 → base, 4 → base*2, 5 → base*4… (overrides só de teste).
 */
export function delayForAttempt(hits: number, overrides?: LadderOverrides): number {
  const baseMs = overrides?.baseMs ?? RAMP_BASE_MS
  const capMs = overrides?.capMs ?? DELAY_CAP_MS
  const saturated = hits - RAMP_FREE_ATTEMPTS
  if (saturated < 0) return 0
  return Math.min(baseMs * 2 ** saturated, capMs)
}

/** Chave Redis/cache do contador por fingerprint. */
export function fingerprintKey(fingerprint: string): string {
  return `${PREFIX}${fingerprint}`
}

/** Lê as tentativas atuais (dentro da janela) do cache. */
async function readHits(fingerprint: string): Promise<number[]> {
  const now = Date.now()
  const cutoff = now - FINGERPRINT_WINDOW_SECONDS * 1000
  const entry = await cacheGet<StoredEntry>(fingerprintKey(fingerprint))
  return (entry?.hits ?? []).filter((t) => t > cutoff)
}

/**
 * Avalia e aplica o guard progressivo para um request de autenticação.
 *
 * - Dentro da tolerância: devolve `blocked: false` imediatamente.
 * - Acima da tolerância: dorme o atraso da escada ANTES de devolver
 *   (encarece a tentativa sem negar o serviço) e segue `blocked: false`.
 * - Acima do HARD_LIMIT: devolve `blocked: true` com 429 + Retry-After.
 */
export async function authFingerprintGuard(
  request: Request,
  scope: string,
  overrides?: LadderOverrides,
): Promise<FingerprintGuard> {
  const fingerprint = `${scope}:${getCompositeFingerprint(request)}`
  const hits = await readHits(fingerprint)

  if (hits.length >= HARD_LIMIT) {
    const oldest = hits[0] ?? Date.now()
    const retryAfter = Math.max(
      1,
      Math.ceil((oldest + FINGERPRINT_WINDOW_SECONDS * 1000 - Date.now()) / 1000),
    )
    logger.warn(
      { fingerprint: fingerprint.slice(0, PREFIX.length + 24), hits: hits.length, scope },
      "auth fingerprint hard-limited",
    )
    return {
      fingerprint,
      blocked: true,
      response: NextResponse.json(
        { error: "Muitas tentativas. Tente novamente mais tarde." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      ),
      recordFailure: async () => {},
    }
  }

  const delay = delayForAttempt(hits.length, overrides)
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  return {
    fingerprint,
    blocked: false,
    response: null,
    async recordFailure() {
      const current = await readHits(fingerprint)
      current.push(Date.now())
      // TTL cobre a janela inteira — o contador apodrece sozinho.
      await cacheSet(
        fingerprintKey(fingerprint),
        { hits: current.slice(-HARD_LIMIT * 2) } satisfies StoredEntry,
        FINGERPRINT_WINDOW_SECONDS,
      )
    },
  }
}
