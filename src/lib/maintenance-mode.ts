import "server-only"

import logger from "./logger"

/**
 * maintenance-mode.ts
 *
 * A CHAVE DE LIGAR/DESLIGAR o marketplace: quando ativa, todo o site fica
 * INACESSÍVEL para o público — páginas renderizam a página de manutenção
 * (/maintenance) e as APIs respondem 503 — e ACESSÍVEL apenas para sessões
 * ADMIN (o painel continua de pé para poder desligar a chave).
 *
 * Onde o valor vive: tabela `Setting` (chave única `maintenance_mode`,
 * valores "true"/"false") — o MESMO console que o admin já usa, persistente
 * (sobrevive a deploy e restart) e sem migração nova.
 *
 * Fail-safe de desenho: se o DB ou o Redis estiverem fora do ar e não houver
 * cache válido, o site volta a ficar ACESSÍVEL (flag lida como false) — a
 * manutenção é um estado operacional declarado, não uma resposta a falha de
 * infra. Quem derruba o site num incidente de infra é a infra, não uma flag
 * que ninguém consegue mais ler.
 *
 * Cache de 15s: a propagação da chave é rápida (< 15s) e o custo por request
 * é próximo de zero (novo gate por request → nada de query por request).
 *
 * Uso:
 *   await isMaintenanceMode()           // true = site INACESSÍVEL ao público
 *   await requireMaintenanceAccessible()// ADMIN passa; público toma HttpError 503
 *   await resetMaintenanceModeCache()   // após o toggle (propagação imediata)
 */

/** A chave na tabela Setting — também o valor lido pelo console de settings. */
export const MAINTENANCE_MODE_KEY = "maintenance_mode"

/** TTL do cache in-memory em ms (15s) — propagação rápida, custo por request ~0. */
const CACHE_TTL_MS = 15_000

let cache: { at: number; value: boolean } | null = null

/** Zera o cache in-memory — chamado pelo toggle e pelos testes. */
export function resetMaintenanceModeCache(): void {
  cache = null
}

/** Interpreta "true"/"1"/"yes" como true; qualquer outra coisa (ou ausência) = false. */
function toBool(raw: string | undefined): boolean {
  if (!raw) return false
  const v = raw.trim().toLowerCase()
  return v === "true" || v === "1" || v === "yes"
}

/**
 * O estado atual da chave. NUNCA lança: DB fora do ar (ou tabela sem a chave)
 * devolve `false` com aviso no log — o fail-safe que impede a manutenção de
 * sequestrar o site numa falha de infra.
 */
export async function isMaintenanceMode(): Promise<boolean> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value

  try {
    const { db } = await import("@/lib/db")
    const row = await db.setting.findUnique({ where: { key: MAINTENANCE_MODE_KEY } })
    const value = toBool(row?.value)
    cache = { at: now, value }
    return value
  } catch (e) {
    logger.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "[maintenance-mode] leitura falhou — fail-safe: site ACESSÍVEL (flag=false)",
    )
    return false
  }
}

/**
 * O gate do request: ADMIN atravessa (painel de pé para desligar a chave);
 * todo o resto toma HttpError 503. Lança HttpError — consumir dentro de
 * `withRoute` (APIs) ou capturado pelo gate do layout (páginas).
 */
export async function requireMaintenanceAccessible(): Promise<void> {
  if (!(await isMaintenanceMode())) return

  const { getSession } = await import("@/lib/auth")
  const session = await getSession()
  if (session?.role === "ADMIN") return

  const { HttpError } = await import("@/lib/api-server")
  throw new HttpError(503, "Manutenção preventiva — em breve estaremos online para melhor atender.")
}
