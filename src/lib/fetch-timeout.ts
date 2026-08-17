/**
 * Shared fetch-timeout helpers.
 *
 * Eliminates the duplicated `Math.max(1, Number(env) || default)` guard +
 * `AbortSignal.timeout()` pattern that was copy-pasted across HTTP clients
 * (lytex, evolution, realtime-client, sentry tunnel, alert webhooks, admin
 * gateway routes).
 *
 * Why the guard: an upstream service that accepts TCP but never responds
 * would leave the fetch pending forever (hanging the calling flow — booking
 * creation, logout, alert dispatch). `AbortSignal.timeout()` aborts after the
 * deadline (rejects with TimeoutError). Invalid env values are guarded:
 * missing/empty/NaN → fallback; 0/negative → clamped to 1ms (a 0ms timeout
 * would abort immediately, a negative one throws).
 */

/**
 * Resolve a timeout in milliseconds from an env var, guarding against
 * invalid values:
 *   - missing/empty/non-numeric (NaN) → `fallbackMs`
 *   - "0" (falsy) → `fallbackMs`
 *   - negative → clamped to 1
 * Mirrors the previous inline `Math.max(1, Number(env) || default)`.
 */
export function resolveTimeoutMs(envName: string, fallbackMs: number): number {
  // `process?.env?.` com optional chaining: no BROWSER (client components,
  // ex.: src/store/geo.ts) o `process` pode não existir no bundle — sem o `?.`
  // isso lançaria ReferenceError em vez de cair no fallback. O fallback é o
  // valor efetivo no client (env não-NEXT_PUBLIC não chega ao browser).
  return Math.max(1, Number(process?.env?.[envName]) || fallbackMs)
}

/**
 * `AbortSignal.timeout()` with a timeout resolved from env (same guard as
 * `resolveTimeoutMs`). Convenience wrapper for fetch calls:
 *
 *   signal: envTimeoutSignal("LYTEX_TIMEOUT_MS", 10_000)
 */
export function envTimeoutSignal(envName: string, fallbackMs: number): AbortSignal {
  return AbortSignal.timeout(resolveTimeoutMs(envName, fallbackMs))
}

// ---------------------------------------------------------------------------
// Global fetch timeout floor (defense in depth)
//
// Modelo de precedência (documentado no worklog):
//   1. Signal EXPLÍCITO no `init` (ex.: envTimeoutSignal("API_TIMEOUT_MS", ...))
//      → passado INTACTO ao fetch nativo. Timeouts env-specific sempre vencem.
//   2. Sem signal → o piso global se aplica: AbortSignal.timeout resolvido de
//      GLOBAL_FETCH_TIMEOUT_MS (default 60s), com o mesmo guard de invalidez.
//
// É uma rede de segurança para código que NÃO passa signal (libs de terceiros,
// fetches fora do guard check-fetch-timeout). NÃO substitui o guard: em runtime
// edge/middleware ou antes do register() o piso pode não estar instalado, então
// o signal explícito continua obrigatório em src/.
// ---------------------------------------------------------------------------

export const GLOBAL_FETCH_TIMEOUT_MS_ENV = "GLOBAL_FETCH_TIMEOUT_MS"
export const GLOBAL_FETCH_TIMEOUT_DEFAULT_MS = 60_000 // Chave STRING (não Symbol): no HMR o módulo client é re-avaliado e um Symbol
// novo perde identidade — o check `g.fetch[novoSymbol]` falharia no wrapper
// antigo e o fetch seria re-embrulhado a cada reload (leak de camadas). Igualdade
// por valor de string sobrevive à re-avaliação; o marker vive NO wrapper, então
// restaurar o fetch original (testes) também o remove.
const FLOOR_MARKER_KEY = "__severinno_fetch_timeout_floor__"

/**
 * Instala o piso de timeout no fetch GLOBAL (server: instrumentation register;
 * client: módulo "use client"). Idempotente — um fetch já embrulhado (marcado
 * com FLOOR_MARKER_KEY) não é re-embrulhado (protege HMR/registro duplo).
 */ export function installGlobalFetchTimeoutFloor(): void {
  const g = globalThis as typeof globalThis & { fetch: typeof fetch }
  if (
    typeof g.fetch !== "function" ||
    (g.fetch as unknown as { [FLOOR_MARKER_KEY]?: boolean })[FLOOR_MARKER_KEY]
  ) {
    return
  }

  const nativeFetch = g.fetch
  const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
    // Precedência: signal EXPLÍCITO vence SEMPRE (não é substituído nem
    // embrulhado). Checa o init E o Request (no spec, init.signal sobrescreve
    // o signal do Request — se o caller passou signal por qualquer um dos dois
    // caminhos, ele controla o timeout).
    // Duck-typed (typeof input?.signal?.aborted) em vez de instanceof: o
    // instanceof falha para Requests de outro realm (iframe/worker/polyfill) —
    // um Request cross-realm com signal explícito seria tratado como "sem
    // signal" e o piso substituiria o signal dele (init.signal REPLACE
    // request.signal no spec), sobrescrevendo a intenção de timeout do caller.
    const requestSignal =
      typeof input === "object" &&
      input !== null &&
      typeof (input as { signal?: AbortSignal }).signal?.aborted === "boolean"
        ? (input as { signal: AbortSignal }).signal
        : undefined
    if (init?.signal || requestSignal) return nativeFetch(input, init)
    return nativeFetch(input, {
      ...init,
      signal: envTimeoutSignal(GLOBAL_FETCH_TIMEOUT_MS_ENV, GLOBAL_FETCH_TIMEOUT_DEFAULT_MS),
    })
  }) as typeof fetch

  ;(wrapped as unknown as { [FLOOR_MARKER_KEY]: boolean })[FLOOR_MARKER_KEY] = true
  g.fetch = wrapped
}
