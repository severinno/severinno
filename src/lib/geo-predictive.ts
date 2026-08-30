/**
 * Predictive Geocoding — pre-warm cache based on time-of-day patterns.
 *
 * Analyzes query frequency by hour to predict peak periods and
 * proactively warm the cache before the surge hits.
 *
 * Pattern examples:
 *   - 7-9 AM: commute queries ("trabalho", "escritório", "empresa")
 *   - 12-2 PM: lunch queries ("restaurante", "padaria", "mercado")
 *   - 6-9 PM: home queries ("casa", "apartamento", "condomínio")
 *   - Weekend: leisure queries ("parque", "academia", "salão")
 */
import { cacheGet } from "./redis"
import { getTopSearches, getTopCEPs } from "./geo-query-log"
import logger from "./logger"

// ── Hour-based query patterns ─────────────────────────────────────────────

/** Pre-defined query patterns by time period */
const TIME_PATTERNS: Record<string, { queries: string[]; description: string }> = {
  "morning-commute": {
    queries: [
      "trabalho", "escritório", "empresa", "centro",
      "Av. Paulista", "fábrica", "indústria", "comércio",
    ],
    description: "Morning commute — queries for work locations",
  },
  "lunch-break": {
    queries: [
      "restaurante", "padaria", "mercado", "lanchonete",
      "supermercado", "feira", "acougue", "pizzaria",
    ],
    description: "Lunch break — queries for food/commerce",
  },
  "evening-home": {
    queries: [
      "casa", "apartamento", "condomínio", "residencial",
      "bairro", "vila", "jardim", "parque",
    ],
    description: "Evening — queries for home/residential",
  },
  "weekend-leisure": {
    queries: [
      "parque", "academia", "salão", "farmácia",
      "hospital", "clínica", "escola", "igreja",
    ],
    description: "Weekend — queries for leisure/services",
  },
}

// ── Time period detection ─────────────────────────────────────────────────

function getTimePeriod(): string {
  const now = new Date()
  const hour = now.getHours()
  const day = now.getDay() // 0 = Sunday
  const isWeekend = day === 0 || day === 6

  if (isWeekend) return "weekend-leisure"
  if (hour >= 7 && hour < 10) return "morning-commute"
  if (hour >= 11 && hour < 14) return "lunch-break"
  if (hour >= 17 && hour < 21) return "evening-home"
  return "off-peak"
}

// ── Predictive warming ────────────────────────────────────────────────────

export type PredictiveWarmResult = {
  period: string
  queriesWarmed: number
  fromLog: number
  fromPatterns: number
  elapsedMs: number
}

/**
 * Pre-warm the geo cache based on predicted demand.
 *
 * Combines two data sources:
 *   1. Historical query log — top queries from this time period
 *   2. Time-based patterns — pre-defined queries for the current period
 *
 * Safe to call periodically (every 15-30 min). Idempotent.
 */
export async function predictiveWarmCache(): Promise<PredictiveWarmResult> {
  const start = Date.now()
  const period = getTimePeriod()
  let fromLog = 0
  let fromPatterns = 0

  if (period === "off-peak") {
    return { period, queriesWarmed: 0, fromLog: 0, fromPatterns: 0, elapsedMs: 0 }
  }

  // 1. Warm from historical query log (top 10 searches + top 5 CEPs)
  const topSearches = getTopSearches(10)
  for (const { query } of topSearches) {
    try {
      const cacheKey = `geo:search:${query.trim().toLowerCase().replace(/\s+/g, " ")}:5`
      const cached = await cacheGet<unknown>(cacheKey)
      if (cached) continue // already warm

      // Import dynamically to avoid circular deps
      const { geocodeSearch } = await import("./geo")
      await geocodeSearch(query, 5)
      fromLog++
    } catch {
      // Best-effort
    }
  }

  const topCEPs = getTopCEPs(5)
  for (const { cep } of topCEPs) {
    try {
      const cacheKey = `geo:cep:${cep}`
      const cached = await cacheGet<unknown>(cacheKey)
      if (cached) continue

      const { geocodeCEP } = await import("./geo")
      await geocodeCEP(cep)
      fromLog++
    } catch {
      // Best-effort
    }
  }

  // 2. Warm from time-based patterns
  const pattern = TIME_PATTERNS[period]
  if (pattern) {
    for (const query of pattern.queries) {
      try {
        const cacheKey = `geo:search:${query.toLowerCase()}:5`
        const cached = await cacheGet<unknown>(cacheKey)
        if (cached) continue

        const { geocodeSearch } = await import("./geo")
        await geocodeSearch(query, 5)
        fromPatterns++
      } catch {
        // Best-effort
      }
    }
  }

  const elapsedMs = Date.now() - start
  const total = fromLog + fromPatterns

  if (total > 0) {
    logger.info(
      { period, fromLog, fromPatterns, total, elapsedMs },
      "geo-predictive: cache warmed",
    )
  }

  return { period, queriesWarmed: total, fromLog, fromPatterns, elapsedMs }
}

/**
 * Get current time period and predicted demand level.
 */
export function getPredictiveStatus(): {
  period: string
  description: string
  predictedDemand: "low" | "medium" | "high"
  patternQueries: string[]
} {
  const period = getTimePeriod()
  const pattern = TIME_PATTERNS[period]

  const demandMap: Record<string, "low" | "medium" | "high"> = {
    "morning-commute": "high",
    "lunch-break": "high",
    "evening-home": "medium",
    "weekend-leisure": "medium",
    "off-peak": "low",
  }

  return {
    period,
    description: pattern?.description ?? "Off-peak — no pre-warming needed",
    predictedDemand: demandMap[period] ?? "low",
    patternQueries: pattern?.queries ?? [],
  }
}
