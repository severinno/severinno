/**
 * geo-startup-warm.ts
 *
 * Server-startup cache warmer — rehydrates Redis with the most popular
 * geo queries from the persistent query log, eliminating the cold period
 * after a restart.
 *
 * How it works:
 *   1. Reads the persistent query log (geo-query-log.ts) which records
 *      every user geo query with frequency.
 *   2. Picks the top 20 search queries + top 20 CEPs by frequency.
 *   3. Falls back to the curated list from geo-cache-warm.ts when the
 *      query log is empty (first deploy ever).
 *   4. For each query, calls the geo function (which goes through
 *      withCachedGeo → cacheSet, storing in Redis).
 *   5. Multiple warm cycles are allowed — subsequent runs are near-instant
 *      since most entries will be cache hits.
 *
 * Triggered by:
 *   - Next.js instrumentation.ts (register()) on server startup
 *   - Optionally: post-deploy script / cron as a safety net
 *
 * Concurrency:
 *   - Runs in the background — does NOT block server startup.
 *   - If the server receives requests during warming, they experience the
 *     normal 5s Nominatim/ViaCEP latency for uncached queries. Subsequent
 *     requests benefit from the warmed cache.
 *   - Rate-limited by rateLimitedNominatim (1 req/s).
 *
 * Duration:
 *   - ~40 seconds for the full warm (40 queries × 1 req/s).
 *   - If the query log is empty and falls back to the curated list: ~48s.
 */

import "server-only"
import { getTopSearches, getTopCEPs, getTopReverses, getQueryLogDiagnostics } from "./geo-query-log"
import { warmGeoCache, getWarmConfig } from "./geo-cache-warm"
import { geocodeSearch, geocodeCEP, reverseGeocode } from "./geo"
import { cacheGet } from "./redis"
import logger from "./logger"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a cache key already exists in Redis (avoids redundant warming). */
async function isKeyCached(key: string): Promise<boolean> {
  try {
    const cached = await cacheGet<unknown>(key)
    return cached !== null
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Number of top queries to warm from the log. */
const TOP_SEARCHES = 20
const TOP_CEPS = 20
const TOP_REVERSES = 5

// ---------------------------------------------------------------------------
// Startup warming
// ---------------------------------------------------------------------------

export type StartupWarmResult = {
  source: "query_log" | "curated_fallback" | "nothing_to_warm"
  searches: number
  ceps: number
  reverses: number
  total: number
  skipped: number
  errors: number
  elapsedMs: number
  diagnostics: {
    totalSearches: number
    uniqueSearches: number
    totalCEPs: number
    uniqueCEPs: number
  }
}

/**
 * Warm the Redis cache using the most popular queries from the persistent
 * query log.
 *
 * Safe to call:
 *   - On every server startup (idempotent — already-cached queries are skipped)
 *   - Multiple times (second run is near-instant)
 *   - From instrumentation.ts (runs in background, doesn't block startup)
 *
 * Falls back to the curated list from geo-cache-warm.ts when the query log
 * has fewer than 3 unique queries (first deploy / empty log).
 */
export async function warmGeoCacheFromLog(): Promise<StartupWarmResult> {
  const start = Date.now()
  const diagnostics = getQueryLogDiagnostics()

  // ── Decide source: query log or curated fallback ─────────────────────
  const topSearches = getTopSearches(TOP_SEARCHES)
  const topCEPs = getTopCEPs(TOP_CEPS)
  const topReverses = getTopReverses(TOP_REVERSES)

  const hasSufficientData = diagnostics.uniqueSearches >= 3 || diagnostics.uniqueCEPs >= 3

  if (!hasSufficientData) {
    // Query log is too sparse — use the curated list from geo-cache-warm.ts
    logger.info(
      {
        uniqueSearches: diagnostics.uniqueSearches,
        uniqueCEPs: diagnostics.uniqueCEPs,
      },
      "geo-startup-warm: query log too sparse — falling back to curated list",
    )

    const config = getWarmConfig()
    logger.info({ totalQueries: config.totalQueries }, "geo-startup-warm: starting curated warm")

    const result = await warmGeoCache()

    return {
      source: "curated_fallback",
      searches: result.searches,
      ceps: result.ceps,
      reverses: result.reverses,
      total: result.total,
      skipped: result.skipped,
      errors: result.errors,
      elapsedMs: result.elapsedMs,
      diagnostics: {
        totalSearches: diagnostics.totalSearches,
        uniqueSearches: diagnostics.uniqueSearches,
        totalCEPs: diagnostics.totalCEPs,
        uniqueCEPs: diagnostics.uniqueCEPs,
      },
    }
  }

  // ── Warm from query log ─────────────────────────────────────────────
  logger.info(
    {
      topSearches: topSearches.length,
      topCEPs: topCEPs.length,
      topReverses: topReverses.length,
    },
    "geo-startup-warm: starting log-based warm",
  )

  let searches = 0
  let ceps = 0
  let reverses = 0
  let skipped = 0
  let errors = 0

  // Warm top search queries
  for (const { query } of topSearches) {
    try {
      const key = `geo:search:${query.trim().toLowerCase().replace(/\s+/g, " ")}:5`
      if (await isKeyCached(key)) {
        skipped++
        continue
      }
      await geocodeSearch(query, 5)
      searches++
    } catch {
      errors++
    }
  }

  // Warm top CEPs
  for (const { cep } of topCEPs) {
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

  // Warm top reverse geocodes (useful for "perto de você" queries)
  for (const { coords } of topReverses) {
    try {
      const [lat, lng] = coords.split(",").map(Number)
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const key = `geo:reverse:${lat.toFixed(4)},${lng.toFixed(4)}`
        if (await isKeyCached(key)) {
          skipped++
          continue
        }
        await reverseGeocode(lat, lng)
        reverses++
      }
    } catch {
      errors++
    }
  }

  const elapsedMs = Date.now() - start
  const total = searches + ceps + reverses

  logger.info(
    {
      source: "query_log",
      searches,
      ceps,
      reverses,
      total,
      skipped,
      errors,
      elapsedMs,
      uniqueSearches: diagnostics.uniqueSearches,
      uniqueCEPs: diagnostics.uniqueCEPs,
    },
    "geo-startup-warm: complete",
  )

  return {
    source: "query_log",
    searches,
    ceps,
    reverses,
    total,
    skipped,
    errors,
    elapsedMs,
    diagnostics: {
      totalSearches: diagnostics.totalSearches,
      uniqueSearches: diagnostics.uniqueSearches,
      totalCEPs: diagnostics.totalCEPs,
      uniqueCEPs: diagnostics.uniqueCEPs,
    },
  }
}
