import "server-only"
import logger from "./logger"

/**
 * geo-settings.ts
 *
 * Centraliza a leitura das configurações de geolocalização que vivem na
 * tabela `Setting` (editáveis pelo painel admin via /api/admin/settings):
 *
 *   - nominatim_enabled  — kill-switch do Nominatim (default: true)
 *   - viacep_enabled     — kill-switch do ViaCEP (default: true)
 *   - NOMINATIM_BASE_URL — base URL da API Nominatim (default: OSM público)
 *   - VIACEP_BASE_URL    — base URL da API ViaCEP (default: público)
 *   - NOMINATIM_USER_AGENT / NOMINATIM_EMAIL — montam o User-Agent enviado
 *     (política OSM exige identificação válida)
 *
 * Leitura LAZY (no primeiro uso) com cache in-memory de 30s — as funções geo
 * não fazem query de settings a cada chamada. FAIL-OPEN: qualquer erro (DB
 * indisponível, tabela sem a chave) cai nos DEFAULTS — os kill-switches
 * desligados NUNCA derrubam a camada de geocodificação, apenas a degradam
 * para o fallback local.
 */

export type GeoSettings = {
  /** Kill-switch do Nominatim (search/reverse/structured). */
  nominatimEnabled: boolean
  /** Kill-switch do ViaCEP (busca por CEP). */
  viacepEnabled: boolean
  /** Base URL do Nominatim (sem barra final). */
  nominatimBaseUrl: string
  /** Base URL do ViaCEP (sem barra final). */
  viacepBaseUrl: string
  /** User-Agent completo enviado ao Nominatim. */
  userAgent: string
}

export const GEO_SETTINGS_DEFAULTS: GeoSettings = {
  nominatimEnabled: true,
  viacepEnabled: true,
  nominatimBaseUrl: "https://nominatim.openstreetmap.org",
  viacepBaseUrl: "https://viacep.com.br",
  userAgent: "SeverinnoMarketplace/1.0 (admin@severinno.com)",
}

/** Cache TTL em ms (30s) — settings mudam raramente. */
const CACHE_TTL_MS = 30_000

let cache: { at: number; value: GeoSettings } | null = null

/** Zera o cache — usado pelos testes para forçar releitura. */
export function resetGeoSettingsCache(): void {
  cache = null
}

/** Interpreta "true"/"1"/"yes" como true; qualquer outra coisa como false. */
function toBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === null || raw === "") return fallback
  const v = raw.trim().toLowerCase()
  return v === "true" || v === "1" || v === "yes"
}

/** Remove barra final de URLs configuradas. */
function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "")
}

async function loadFromDb(): Promise<GeoSettings> {
  const { db } = await import("@/lib/db")
  const rows = await db.setting.findMany()

  const map = new Map<string, string>()
  for (const row of rows) {
    map.set(String(row.key).toLowerCase(), String(row.value))
  }

  const userAgentRaw = map.get("nominatim_user_agent")
  const emailRaw = map.get("nominatim_email")
  const userAgent =
    userAgentRaw && emailRaw
      ? `${userAgentRaw} (${emailRaw})`
      : (userAgentRaw ?? GEO_SETTINGS_DEFAULTS.userAgent)

  return {
    nominatimEnabled: toBool(map.get("nominatim_enabled"), GEO_SETTINGS_DEFAULTS.nominatimEnabled),
    viacepEnabled: toBool(map.get("viacep_enabled"), GEO_SETTINGS_DEFAULTS.viacepEnabled),
    nominatimBaseUrl: stripTrailingSlash(
      map.get("nominatim_base_url") ?? GEO_SETTINGS_DEFAULTS.nominatimBaseUrl,
    ),
    viacepBaseUrl: stripTrailingSlash(
      map.get("viacep_base_url") ?? GEO_SETTINGS_DEFAULTS.viacepBaseUrl,
    ),
    userAgent,
  }
}

/**
 * Lê as settings de geolocalização (com cache de 30s).
 *
 * FAIL-OPEN: qualquer falha (DB indisponível, tabela vazia, coluna ausente)
 * retorna os DEFAULTS — a camada de geocodificação continua funcionando.
 */
export async function getGeoSettings(): Promise<GeoSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value
  }

  let settings: GeoSettings
  try {
    settings = await loadFromDb()
  } catch (err) {
    logger.warn({ err }, "geo-settings: DB read failed, using defaults")
    settings = GEO_SETTINGS_DEFAULTS
  }

  cache = { at: Date.now(), value: settings }
  return settings
}
