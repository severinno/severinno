/**
 * geo-cache-warm.ts
 *
 * Server-side Redis cache warmer for geo queries.
 *
 * After a server restart, the Redis cache is cold — every user request
 * triggers a Nominatim/ViaCEP API call with the associated 5s latency.
 * This module pre-fetches the most common geo queries and stores them
 * in the Redis cache (via withCache → cacheSet) so the first users
 * after restart get cached responses.
 *
 * How it works:
 *   1. Contains a curated list of the most frequent geo queries (top
 *      Brazilian cities, common CEPs, major city coordinates).
 *   2. warmGeoCache() iterates through the list and calls each geo
 *      function (geocodeSearch, geocodeCEP, reverseGeocode).
 *   3. Each call goes through withCachedGeo → withCache, which
 *      stores the result in Redis (24h TTL for search, 24h for CEP).
 *   4. Progress is tracked and returned so the cron endpoint can
 *      report how many queries were warmed.
 *
 * Idempotent: safe to run multiple times. If Redis already has an
 * entry, withCache returns it immediately (cache hit) — no external
 * API call is made. The warming is purely additive.
 *
 * Concurrency: uses rateLimitedNominatim internally (1 req/s), so
 * the warming respects OSM's rate limit automatically. A full warm
 * of ~30 queries takes ~30 seconds.
 */

import "server-only"
import { geocodeSearch, geocodeCEP, reverseGeocode } from "./geo"
import { cacheGet, getClient } from "./redis"
import { getTopSearches, getTopCEPs, getTopReverses } from "./geo-query-log"
import logger from "./logger"

// ---------------------------------------------------------------------------
// Cache key normalization (must match geo-nominatim.ts)
// ---------------------------------------------------------------------------

function normalizeCacheKey(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ")
}

// ---------------------------------------------------------------------------
// Frequency-ordered warm list
// ---------------------------------------------------------------------------

/** Cities most likely to be searched by users, ordered by estimated frequency. */
const TOP_CITIES: string[] = [
  "São Paulo, SP",
  "Rio de Janeiro, RJ",
  "Belo Horizonte, MG",
  "Brasília, DF",
  "Salvador, BA",
  "Fortaleza, CE",
  "Curitiba, PR",
  "Campinas, SP",
  "Porto Alegre, RS",
  "Manaus, AM",
  "Recife, PE",
  "Guarulhos, SP",
  "São Bernardo do Campo, SP",
  "Santo André, SP",
  "Osasco, SP",
  "Contagem, MG",
  "São José dos Campos, SP",
  "Ribeirão Preto, SP",
  "Uberlândia, MG",
  "Sorocaba, SP",
  "Niterói, RJ",
  "Santos, SP",
  "Joinville, SC",
  "Florianópolis, SC",
  "Goiânia, GO",
]

/** Common CEPs from major streets and commercial areas. */
const TOP_CEPS: string[] = [
  "01310100", // Av. Paulista, São Paulo
  "01311000", // Av. Paulista, São Paulo
  "01414001", // Faria Lima, São Paulo
  "04538133", // Berrini, São Paulo
  "20040002", // Centro, Rio de Janeiro
  "22041001", // Copacabana, Rio de Janeiro
  "30140071", // Centro, Belo Horizonte
  "70040901", // Esplanada dos Ministérios, Brasília
  "80010020", // Centro, Curitiba
  "90010010", // Centro, Porto Alegre
  "50010020", // Centro, Recife
  "40010010", // Centro, Salvador
  "60010010", // Centro, Fortaleza
  "69005010", // Centro, Manaus
  "13010001", // Centro, Campinas
]

/** Key coordinates for reverse geocode warming. */
const TOP_COORDS: Array<{ lat: number; lng: number; label: string }> = [
  { lat: -23.5505, lng: -46.6333, label: "São Paulo (centro)" },
  { lat: -22.9068, lng: -43.1729, label: "Rio de Janeiro (centro)" },
  { lat: -19.9167, lng: -43.9345, label: "Belo Horizonte (centro)" },
  { lat: -15.7939, lng: -47.8828, label: "Brasília (centro)" },
  { lat: -12.9777, lng: -38.5016, label: "Salvador (centro)" },
  { lat: -3.7319, lng: -38.5267, label: "Fortaleza (centro)" },
  { lat: -25.429, lng: -49.2671, label: "Curitiba (centro)" },
  { lat: -30.0346, lng: -51.2177, label: "Porto Alegre (centro)" },
]

/**
 * Grupo 1 — Bairros populares para busca.
 * Bairros icônicos das maiores capitais, prováveis de serem pesquisados
 * por clientes buscando prestadores próximos.
 */
const TOP_NEIGHBORHOODS: string[] = [
  "Copacabana, Rio de Janeiro, RJ",
  "Moema, São Paulo, SP",
  "Barra da Tijuca, Rio de Janeiro, RJ",
  "Pinheiros, São Paulo, SP",
  "Savassi, Belo Horizonte, MG",
]

/**
 * Grupo 3 — Capitais estaduais faltantes.
 * Capitais brasileiras com alta densidade populacional que ainda não
 * estavam na lista TOP_CITIES original.
 */
const MISSING_CAPITALS: string[] = [
  "Belém, PA",
  "Vitória, ES",
  "Natal, RN",
  "São Luís, MA",
  "Maceió, AL",
  "Campo Grande, MS",
]

// ---------------------------------------------------------------------------
// Cache warm implementation
// ---------------------------------------------------------------------------

export type WarmResult = {
  searches: number // static geocodeSearch calls made (cache misses)
  ceps: number // static geocodeCEP calls made
  reverses: number // static reverseGeocode calls made
  logSearches: number // log-based geocodeSearch calls made
  logCeps: number // log-based geocodeCEP calls made
  logReverses: number // log-based reverseGeocode calls made
  total: number
  skipped: number // already in cache
  errors: number
  elapsedMs: number
}

/**
 * Batch-check which keys are already cached via Redis MGET (1 round-trip instead of N).
 * Falls back to individual cacheGet if Redis is unavailable.
 */
async function batchCheckCached(keys: string[]): Promise<Set<string>> {
  const cached = new Set<string>()
  if (keys.length === 0) return cached
  try {
    const redis = getClient()
    if (redis) {
      const results = await redis.mget(...keys)
      for (let i = 0; i < keys.length; i++) {
        if (results[i] !== null) cached.add(keys[i]!)
      }
      return cached
    }
  } catch {
    // Redis unavailable — fall back to individual checks
  }
  // Fallback: individual checks (still better than blocking the whole warm)
  for (const key of keys) {
    try {
      if ((await cacheGet<unknown>(key)) !== null) cached.add(key)
    } catch {
      /* skip */
    }
  }
  return cached
}

/**
 * Warm all geo caches by calling the public geo functions for each
 * entry in the frequency-ordered lists.
 *
 * Each function call goes through withCachedGeo which:
 *   1. Checks Redis cache → HIT? returns instantly (no API call)
 *   2. MISS → calls Nominatim/ViaCEP via rateLimitedNominatim
 *   3. Stores result in Redis with appropriate TTL
 *
 * @returns Summary of what was warmed.
 */
export async function warmGeoCache(): Promise<WarmResult> {
  const start = Date.now()
  let searches = 0
  let ceps = 0
  let reverses = 0
  let skipped = 0
  let errors = 0

  // ── 1. Collect all cache keys and batch-check with MGET (1 round-trip) ──
  const topSearches = getTopSearches(20)
  const topCEPs = getTopCEPs(15)
  const topReverses = getTopReverses(10)

  const allKeys: string[] = []
  for (const { query } of topSearches) allKeys.push(`geo:search:${normalizeCacheKey(query)}:5`)
  for (const { cep } of topCEPs) allKeys.push(`geo:cep:${cep}`)
  for (const { coords } of topReverses) allKeys.push(`geo:reverse:${coords}`)
  for (const city of TOP_CITIES) allKeys.push(`geo:search:${normalizeCacheKey(city)}:5`)
  for (const cep of TOP_CEPS) allKeys.push(`geo:cep:${cep}`)
  for (const coord of TOP_COORDS)
    allKeys.push(`geo:reverse:${coord.lat.toFixed(4)},${coord.lng.toFixed(4)}`)
  for (const bairro of TOP_NEIGHBORHOODS) allKeys.push(`geo:search:${normalizeCacheKey(bairro)}:5`)
  for (const capital of MISSING_CAPITALS) allKeys.push(`geo:search:${normalizeCacheKey(capital)}:5`)

  const cachedKeys = await batchCheckCached(allKeys)

  // ── 2. Warm only missing keys ──────────────────────────────────────────
  let logSearches = 0
  let logCeps = 0
  let logReverses = 0

  for (const { query } of topSearches) {
    const key = `geo:search:${normalizeCacheKey(query)}:5`
    if (cachedKeys.has(key)) {
      skipped++
      continue
    }
    try {
      await geocodeSearch(query, 5)
      logSearches++
    } catch (err) {
      logger.debug({ err }, "geo-cache-warm: log search warm failed")
      errors++
    }
  }

  for (const { cep } of topCEPs) {
    const key = `geo:cep:${cep}`
    if (cachedKeys.has(key)) {
      skipped++
      continue
    }
    try {
      await geocodeCEP(cep)
      logCeps++
    } catch (err) {
      logger.debug({ err }, "geo-cache-warm: log CEP warm failed")
      errors++
    }
  }

  for (const { coords } of topReverses) {
    const key = `geo:reverse:${coords}`
    if (cachedKeys.has(key)) {
      skipped++
      continue
    }
    try {
      const [lat, lng] = coords.split(",").map(Number)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        errors++
        continue
      }
      await reverseGeocode(lat, lng)
      logReverses++
    } catch (err) {
      logger.debug({ err }, "geo-cache-warm: log reverse warm failed")
      errors++
    }
  }

  // Static lists
  for (const city of TOP_CITIES) {
    const key = `geo:search:${normalizeCacheKey(city)}:5`
    if (cachedKeys.has(key)) {
      skipped++
      continue
    }
    try {
      await geocodeSearch(city, 5)
      searches++
    } catch (err) {
      logger.debug({ err }, "geo-cache-warm: city search warm failed")
      errors++
    }
  }

  for (const cep of TOP_CEPS) {
    const key = `geo:cep:${cep}`
    if (cachedKeys.has(key)) {
      skipped++
      continue
    }
    try {
      await geocodeCEP(cep)
      ceps++
    } catch (err) {
      logger.debug({ err }, "geo-cache-warm: CEP warm failed")
      errors++
    }
  }

  for (const coord of TOP_COORDS) {
    const key = `geo:reverse:${coord.lat.toFixed(4)},${coord.lng.toFixed(4)}`
    if (cachedKeys.has(key)) {
      skipped++
      continue
    }
    try {
      await reverseGeocode(coord.lat, coord.lng)
      reverses++
    } catch (err) {
      logger.debug({ err }, "geo-cache-warm: reverse warm failed")
      errors++
    }
  }

  for (const bairro of TOP_NEIGHBORHOODS) {
    const key = `geo:search:${normalizeCacheKey(bairro)}:5`
    if (cachedKeys.has(key)) {
      skipped++
      continue
    }
    try {
      await geocodeSearch(bairro, 5)
      searches++
    } catch (err) {
      logger.debug({ err }, "geo-cache-warm: neighborhood search warm failed")
      errors++
    }
  }

  for (const capital of MISSING_CAPITALS) {
    const key = `geo:search:${normalizeCacheKey(capital)}:5`
    if (cachedKeys.has(key)) {
      skipped++
      continue
    }
    try {
      await geocodeSearch(capital, 5)
      searches++
    } catch (err) {
      logger.debug({ err }, "geo-cache-warm: capital search warm failed")
      errors++
    }
  }

  const elapsedMs = Date.now() - start
  const total = searches + ceps + reverses + logSearches + logCeps + logReverses

  logger.info(
    {
      searches,
      ceps,
      reverses,
      logSearches,
      logCeps,
      logReverses,
      total,
      skipped,
      errors,
      elapsedMs,
      warmedCities: TOP_CITIES.length,
      warmedCeps: TOP_CEPS.length,
      warmedCoords: TOP_COORDS.length,
      warmedNeighborhoods: TOP_NEIGHBORHOODS.length,
      warmedMissingCapitals: MISSING_CAPITALS.length,
      logSearchesEntries: topSearches.length,
      logCepsEntries: topCEPs.length,
      logReversesEntries: topReverses.length,
    },
    "geo-cache-warm: complete",
  )

  // Store runtime result for the debug endpoint
  _lastWarmResult = {
    searches,
    ceps,
    reverses,
    logSearches,
    logCeps,
    logReverses,
    total,
    skipped,
    errors,
    elapsedMs,
    completedAt: new Date().toISOString(),
  }

  return {
    searches,
    ceps,
    reverses,
    logSearches,
    logCeps,
    logReverses,
    total,
    skipped,
    errors,
    elapsedMs,
  }
}

// ---------------------------------------------------------------------------
// Last warm result (runtime status)
// ---------------------------------------------------------------------------

let _lastWarmResult:
  | (WarmResult & {
      /** ISO timestamp when warmGeoCache() last completed. */
      completedAt: string
    })
  | null = null

/**
 * Get the result of the last warmGeoCache() execution, if any.
 * Returns null if warmGeoCache() has never been called this session.
 */
export function getLastWarmResult(): typeof _lastWarmResult {
  return _lastWarmResult
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export function getWarmConfig(): {
  cities: number
  neighborhoods: number
  missingCapitals: number
  ceps: number
  coords: number
  totalQueries: number
} {
  const staticSearches = TOP_CITIES.length + TOP_NEIGHBORHOODS.length + MISSING_CAPITALS.length
  return {
    cities: TOP_CITIES.length,
    neighborhoods: TOP_NEIGHBORHOODS.length,
    missingCapitals: MISSING_CAPITALS.length,
    ceps: TOP_CEPS.length,
    coords: TOP_COORDS.length,
    totalQueries: staticSearches + TOP_CEPS.length + TOP_COORDS.length,
  }
}
