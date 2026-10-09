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

/** A chave na tabela Setting onde a lista de IPs permitidos durante a manutenção é salva. */
export const MAINTENANCE_ALLOWED_IPS_KEY = "maintenance_allowed_ips"

/** TTL do cache in-memory em ms (15s) — propagação rápida, custo por request ~0. */
const CACHE_TTL_MS = 15_000

let cache: { at: number; value: boolean } | null = null
let ipsCache: { at: number; value: string[] } | null = null

/** Zera o cache in-memory — chamado pelo toggle e pelos testes. */
export function resetMaintenanceModeCache(): void {
  cache = null
  ipsCache = null
}

/** Interpreta "true"/"1"/"yes" como true; qualquer outra coisa (ou ausência) = false. */
function toBool(raw: string | undefined): boolean {
  if (!raw) return false
  const v = raw.trim().toLowerCase()
  return v === "true" || v === "1" || v === "yes"
}

/**
 * Lê a lista de IPs autorizados durante a manutenção.
 * Sempre inclui localhost / loopback ("127.0.0.1", "::1", "localhost") e
 * combina com os IPs definidos na variável MAINTENANCE_ALLOWED_IPS e no banco.
 */
export async function getAllowedMaintenanceIps(): Promise<string[]> {
  const now = Date.now()
  if (ipsCache && now - ipsCache.at < CACHE_TTL_MS) return ipsCache.value

  const defaultIps = ["127.0.0.1", "::1", "localhost"]
  const envIps = (process.env.MAINTENANCE_ALLOWED_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  try {
    const { db } = await import("@/lib/db")
    const row = await db.setting.findUnique({ where: { key: MAINTENANCE_ALLOWED_IPS_KEY } })
    let dbIps: string[] = []
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value)
        if (Array.isArray(parsed)) {
          dbIps = parsed
            .map(String)
            .map((s) => s.trim())
            .filter(Boolean)
        } else {
          dbIps = String(row.value)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        }
      } catch {
        dbIps = String(row.value)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      }
    }

    const merged = Array.from(new Set([...defaultIps, ...envIps, ...dbIps]))
    ipsCache = { at: now, value: merged }
    return merged
  } catch (e) {
    logger.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "[maintenance-mode] leitura de IPs permitidos falhou — usando defaults locais",
    )
    const fallback = Array.from(new Set([...defaultIps, ...envIps]))
    ipsCache = { at: now, value: fallback }
    return fallback
  }
}

/**
 * Verifica se um determinado IP tem autorização para acessar durante a manutenção.
 */
export async function isClientAllowedDuringMaintenance(clientIp?: string | null): Promise<boolean> {
  if (!clientIp) return false
  const clean = clientIp.split(",")[0]?.trim() ?? ""
  if (!clean) return false

  // Localhost / Loopback sempre permitidos
  if (
    clean === "127.0.0.1" ||
    clean === "::1" ||
    clean === "localhost" ||
    clean === "::ffff:127.0.0.1"
  ) {
    return true
  }

  const allowed = await getAllowedMaintenanceIps()
  return allowed.some((ip) => {
    const normalized = ip.trim()
    return normalized === clean || clean.startsWith(normalized)
  })
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
 * Verifica se o request/cliente atual pode acessar a aplicação.
 * Retorna true se o modo de manutenção estiver desligado,
 * ou se o usuário for ADMIN, ou se o IP estiver na whitelist.
 */
export async function isMaintenanceAccessible(options?: {
  ip?: string | null
  session?: { role?: string } | null
}): Promise<boolean> {
  const inMaintenance = await isMaintenanceMode()
  if (!inMaintenance) return true

  if (options?.session?.role === "ADMIN") return true
  if (options?.ip && (await isClientAllowedDuringMaintenance(options.ip))) return true

  return false
}

/**
 * O gate do request: ADMIN atravessa ou clientes com IP na whitelist;
 * todo o resto toma HttpError 503. Lança HttpError — consumir dentro de
 * `withRoute` (APIs) ou capturado pelo gate do layout (páginas).
 */
export async function requireMaintenanceAccessible(
  request?: Request,
  clientIp?: string,
): Promise<void> {
  if (!(await isMaintenanceMode())) return

  // 1) Se passar IP ou request, verifica se o IP está autorizado na whitelist
  let ipToCheck = clientIp
  if (!ipToCheck && request) {
    const { getClientIp } = await import("@/lib/rate-limit-shared")
    ipToCheck = getClientIp(request)
  }

  if (ipToCheck && (await isClientAllowedDuringMaintenance(ipToCheck))) {
    return
  }

  // 2) Se o usuário for ADMIN autenticado na sessão, permite
  const { getSession } = await import("@/lib/auth")
  const session = await getSession()
  if (session?.role === "ADMIN") return

  const { HttpError } = await import("@/lib/api-server")
  throw new HttpError(503, "Manutenção preventiva — em breve estaremos online para melhor atender.")
}
