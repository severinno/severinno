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
 *      stores the result in Redis (24h TTL for search, 7d for CEP).
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
import { cacheGet } from "./redis"
import logger from "./logger"

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

// ---------------------------------------------------------------------------
// Cache warm implementation
// ---------------------------------------------------------------------------

export type WarmResult = {
  searches: number // geocodeSearch calls made (cache misses)
  ceps: number // geocodeCEP calls made
  reverses: number // reverseGeocode calls made
  total: number
  skipped: number // already in cache
  errors: number
  elapsedMs: number
}

/**
 * Check if a geo cache key is already populated (avoids unnecessary warming).
 * Returns true if the key exists in cache (Redis or in-memory).
 */
async function isKeyCached(key: string): Promise<boolean> {
  try {
    const cached = await cacheGet<unknown>(key)
    return cached !== null
  } catch {
    return false
  }
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

  // ── Warm city searches ────────────────────────────────────────────
  for (const city of TOP_CITIES) {
    try {
      // Cache key pattern from geo.ts: geo:search:{normalized}:{limit}
      const key = `geo:search:${city.toLowerCase()}:5`
      if (await isKeyCached(key)) {
        skipped++
        continue
      }
      // geocodeSearch goes through withCachedGeo → withCache → rateLimitedNominatim
      await geocodeSearch(city, 5)
      searches++
    } catch {
      errors++
    }
  }

  // ── Warm CEP lookups ──────────────────────────────────────────────
  for (const cep of TOP_CEPS) {
    try {
      const key = `geo:cep:${cep}`
      if (await isKeyCached(key)) {
        skipped++
        continue
      }
      await geocodeCEP(cep)
      ceps++
    } catch {
      errors++
    }
  }

  // ── Warm reverse geocodes ─────────────────────────────────────────
  for (const coord of TOP_COORDS) {
    try {
      const key = `geo:reverse:${coord.lat.toFixed(4)},${coord.lng.toFixed(4)}`
      if (await isKeyCached(key)) {
        skipped++
        continue
      }
      await reverseGeocode(coord.lat, coord.lng)
      reverses++
    } catch {
      errors++
    }
  }

  const elapsedMs = Date.now() - start
  const total = searches + ceps + reverses

  logger.info(
    {
      searches,
      ceps,
      reverses,
      total,
      skipped,
      errors,
      elapsedMs,
      warmedCities: TOP_CITIES.length,
      warmedCeps: TOP_CEPS.length,
      warmedCoords: TOP_COORDS.length,
    },
    "geo-cache-warm: complete",
  )

  return { searches, ceps, reverses, total, skipped, errors, elapsedMs }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export function getWarmConfig(): {
  cities: number
  ceps: number
  coords: number
  totalQueries: number
} {
  return {
    cities: TOP_CITIES.length,
    ceps: TOP_CEPS.length,
    coords: TOP_COORDS.length,
    totalQueries: TOP_CITIES.length + TOP_CEPS.length + TOP_COORDS.length,
  }
}
