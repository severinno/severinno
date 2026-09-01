import "server-only"

/**
 * Geolocation & formatting helpers — SERVER-SIDE ONLY.
 * (Some functions call external APIs with a real User-Agent.)
 *
 * Pure math helpers (haversineKm, formatDistance) live in geo-shared.ts
 * which is safe for both server and client.
 */

import { db } from "@/lib/db"
import { trackGeoLatency } from "./geo-metrics"
import { withCache } from "./redis"
import { rateLimitedNominatim } from "./nominatim-rate-limit"
import { rateLimitedViaCEP } from "./viacep-rate-limit"
import { nominatimBreaker, viacepBreaker } from "./geo-circuit-breakers"
import { recordSearch, recordCEP, recordReverse } from "./geo-query-log"
import { getGeoSettings } from "./geo-settings"
import { geoFetchWithRetry } from "./geo-fetch"
import logger from "./logger"
import { traceSpan } from "./tracing"

// ── Per-operation call counters ──────────────────────────────────────────
// Lightweight in-memory counters for geo debug endpoint.
// No external I/O — just increments. Safe for sub-μs overhead.

type GeoOperationType = "cep" | "search" | "reverse" | "structured"

const geoCallCounts: Record<GeoOperationType, number> = {
  cep: 0,
  search: 0,
  reverse: 0,
  structured: 0,
}
const geoFallbackCounts: Record<GeoOperationType, number> = {
  cep: 0,
  search: 0,
  reverse: 0,
  structured: 0,
}

export function getGeoCallStats(): {
  calls: Record<GeoOperationType, number>
  fallbacks: Record<GeoOperationType, number>
  fallbackRate: Record<GeoOperationType, number | null>
} {
  const fallbackRate = {} as Record<GeoOperationType, number | null>
  for (const op of Object.keys(geoCallCounts) as GeoOperationType[]) {
    const calls = geoCallCounts[op]
    fallbackRate[op] = calls > 0 ? +((geoFallbackCounts[op] / calls) * 100).toFixed(1) : null
  }
  return {
    calls: { ...geoCallCounts },
    fallbacks: { ...geoFallbackCounts },
    fallbackRate,
  }
}

export { haversineKm, formatDistance } from "./geo-shared"

// ── Cache-aside wrapper for geo functions ────────────────────────────────
// Adds Redis caching INSIDE the geo functions so any caller (API route,
// script, SSR page) gets cache hits automatically.

function normalizeCacheKey(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ")
}

/**
 * Cache-aside + rate-limited + instrumented wrapper for geo functions.
 *
 * On cache hit: returns instantly ("geo-cache" latency tracked).
 * On cache miss:
 *   1. limiter — proteção do provedor (Nominatim 1 req/s; ViaCEP 60 req/min,
 *      com filas independentes para os dois não se atrasarem)
 *   2. trackGeoLatency — métricas P50/P95/P99
 *   3. withCache — armazena no Redis + in-memory fallback
 */
function withCachedGeo<T>(
  key: string,
  fn: () => Promise<T>,
  ttl: number,
  limiter: (f: () => Promise<T>) => Promise<T> = rateLimitedNominatim,
): Promise<T> {
  // The rate limiter + latency tracker go INSIDE the cache-miss callback
  // so they only run when we actually call the external API.
  // Cache hit is nearly instant — no need for separate metrics.
  return withCache(key, () => limiter(fn), ttl)
}

// ── Instrumented + cached wrappers ───────────────────────────────────────
// Each wrapper adds BOTH latency tracking AND Redis caching.

/** Wraps geocodeCEP with Redis cache (7d TTL) + ViaCEP latency tracking + limiter 60 req/min. */
export async function geocodeCEP(cep: string): Promise<ViaCEPResult> {
  return traceSpan("geo.geocodeCEP", async (span) => {
    geoCallCounts.cep++
    const clean = cep.replace(/\D/g, "")
    span.setAttribute("geo.cep", clean)
    const result = await withCachedGeo(
      `geo:cep:${clean}`,
      () => trackGeoLatency("viacep", () => _geocodeCEP(clean)),
      86400, // 24h (was 7d — CEPs can change when streets are renamed)
      rateLimitedViaCEP,
    )
    span.setAttribute("geo.result.city", result.city)
    span.setAttribute("geo.result.state", result.state)
    recordCEP(cep)
    return result
  })
}

/** Wraps geocodeSearch with Redis cache (24h TTL) + Nominatim latency tracking. */
export async function geocodeSearch(query: string, limit: number = 5): Promise<GeoSearchResult[]> {
  return traceSpan("geo.geocodeSearch", async (span) => {
    geoCallCounts.search++
    span.setAttribute("geo.query", query)
    span.setAttribute("geo.limit", limit)
    const key = `geo:search:${normalizeCacheKey(query)}:${Math.max(1, Math.min(10, limit))}`
    const result = await withCachedGeo(
      key,
      () => trackGeoLatency("nominatim", () => _geocodeSearch(query, limit)),
      86400, // 24h
    )
    span.setAttribute("geo.result.count", result.length)
    recordSearch(query)
    return result
  })
}

/** Wraps geocodeSearchStructured with Redis cache (24h TTL) + Nominatim tracking. */
export async function geocodeSearchStructured(
  opts: Parameters<typeof _geocodeSearchStructured>[0],
): Promise<GeoSearchResult[]> {
  return traceSpan("geo.geocodeSearchStructured", async (span) => {
    geoCallCounts.structured++
    const { street, city, state, country, postcode, limit = 5 } = opts
    span.setAttribute("geo.street", street ?? "")
    span.setAttribute("geo.city", city ?? "")
    span.setAttribute("geo.state", state ?? "")
    const parts = [
      street?.trim().toLowerCase() ?? "",
      city?.trim().toLowerCase() ?? "",
      state?.trim().toLowerCase() ?? "",
      country?.trim().toLowerCase() ?? "",
      postcode?.trim() ?? "",
      String(Math.max(1, Math.min(10, limit))),
    ].join(":")
    const result = await withCachedGeo(
      `geo:search:structured:${parts}`,
      () => trackGeoLatency("nominatim", () => _geocodeSearchStructured(opts)),
      86400, // 24h
    )
    span.setAttribute("geo.result.count", result.length)
    const combined = [street, city, state, postcode].filter(Boolean).join(", ")
    if (combined) recordSearch(combined)
    return result
  })
}

/** Wraps reverseGeocode with Redis cache (24h TTL) + Nominatim latency tracking. */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  return traceSpan("geo.reverseGeocode", async (span) => {
    geoCallCounts.reverse++
    span.setAttribute("geo.lat", lat)
    span.setAttribute("geo.lng", lng)
    const result = await withCachedGeo(
      `geo:reverse:${lat.toFixed(4)},${lng.toFixed(4)}`,
      () => trackGeoLatency("nominatim", () => _reverseGeocode(lat, lng)),
      86400, // 24h (coordenadas fixas — não mudam)
    )
    span.setAttribute("geo.result.displayName", result.displayName.slice(0, 100))
    recordReverse(lat, lng)
    return result
  })
}

// ── Original (private) implementations ────────────────────────────────────

export type ViaCEPResult = {
  cep: string
  street: string
  district: string
  city: string
  state: string
}

/** @internal renamed to _geocodeCEP — use geocodeCEPWithMetrics for latency tracking. */
async function _geocodeCEP(cep: string): Promise<ViaCEPResult> {
  const clean = cep.replace(/\D/g, "")
  if (clean.length !== 8) {
    throw new Error("CEP inválido (deve ter 8 dígitos)")
  }

  try {
    const settings = await getGeoSettings()
    // Kill-switch: ViaCEP desligado → fallback local direto (sem rede)
    if (!settings.viacepEnabled) return geocodeCEPLocal(clean)

    const res = await viacepBreaker.execute(async () => {
      const url = `${settings.viacepBaseUrl}/ws/${clean}/json/`
      const r = await geoFetchWithRetry(url, {
        headers: { Accept: "application/json" },
        next: { revalidate: 86400 },
        timeoutMs: 5000,
        maxRetries: 1,
        label: "viacep",
      })
      if (!r.ok) throw new Error(`ViaCEP HTTP ${r.status}`)
      return r
    })

    const data = (await res.json()) as {
      cep?: string
      logradouro?: string
      bairro?: string
      localidade?: string
      uf?: string
      erro?: boolean
    }
    if (data.erro) throw new Error("CEP não encontrado")

    return {
      cep: data.cep ?? clean,
      street: data.logradouro ?? "",
      district: data.bairro ?? "",
      city: data.localidade ?? "",
      state: data.uf ?? "",
    }
  } catch {
    // ViaCEP unavailable — fall back to local DB CEP search
    geoFallbackCounts.cep++
    return geocodeCEPLocal(clean)
  }
}

/**
 * Fallback local CEP lookup when ViaCEP is unavailable.
 *
 * Searches the User table for a provider whose `cep` matches the given CEP.
 * Returns a ViaCEPResult-compatible object so the caller receives the same
 * shape regardless of whether ViaCEP or the fallback was used.
 */
async function geocodeCEPLocal(cep: string): Promise<ViaCEPResult> {
  try {
    const { db } = await import("@/lib/db")

    // Try matching both with and without hyphen (DB may store either format)
    const withHyphen = `${cep.slice(0, 5)}-${cep.slice(5)}`
    const user = await db.user.findFirst({
      where: {
        role: "PROVIDER",
        active: true,
        OR: [{ cep: cep }, { cep: withHyphen }],
      },
      select: { cep: true, street: true, district: true, city: true, state: true },
      orderBy: { avgRating: "desc" as const },
    })

    if (!user) {
      // No match found in DB either
      throw new Error("CEP não encontrado")
    }

    return {
      cep: user.cep ?? cep,
      street: user.street ?? "",
      district: user.district ?? "",
      city: user.city ?? "",
      state: user.state ?? "",
    }
  } catch {
    // DB query also failed
    throw new Error("CEP não encontrado")
  }
}

export type ReverseGeocodeResult = {
  displayName: string
  road?: string
  neighbourhood?: string
  city?: string
  state?: string
  postcode?: string
}

/** @internal renamed to _reverseGeocode — use reverseGeocodeWithMetrics for latency tracking. */
async function _reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  try {
    const settings = await getGeoSettings()
    // Kill-switch: Nominatim desligado → fallback local direto (sem rede)
    if (!settings.nominatimEnabled) return reverseGeocodeLocal(lat, lng)

    const res = await nominatimBreaker.execute(async () => {
      const url = `${settings.nominatimBaseUrl}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=pt-BR`
      const r = await geoFetchWithRetry(url, {
        headers: nominatimHeaders(settings.userAgent),
        next: { revalidate: 3600 },
        timeoutMs: 5000,
        maxRetries: 1,
        label: "nominatim-reverse",
      })
      if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`)
      return r
    })

    const data = (await res.json()) as {
      display_name?: string
      address?: {
        road?: string
        neighbourhood?: string
        city?: string
        town?: string
        village?: string
        state?: string
        postcode?: string
      }
    }
    const a = data.address ?? {}
    return {
      displayName: data.display_name ?? "",
      road: a.road,
      neighbourhood: a.neighbourhood,
      city: a.city ?? a.town ?? a.village,
      state: a.state,
      postcode: a.postcode,
    }
  } catch {
    // Nominatim unavailable — fall back to nearest provider in DB
    geoFallbackCounts.reverse++
    return reverseGeocodeLocal(lat, lng)
  }
}


// ---------------------------------------------------------------------------
// Nominatim Search (forward geocoding)
// ---------------------------------------------------------------------------

export type GeoSearchResult = {
  lat: number
  lng: number
  displayName: string
  street?: string | null
  district?: string | null
  city?: string | null
  state?: string | null
  cep?: string | null
  category?: string
  type?: string
  importance: number
}

/**
 * Fallback local reverse geocode when Nominatim is unavailable.
 *
 * Finds the nearest provider in the DB (by Haversine distance to the given
 * coordinates) and returns their address. Limited to ~100km radius to avoid
 * returning irrelevant results.
 */
/** Maximum radius for local reverse geocode fallback (km). */
const REVERSE_LOCAL_RADIUS_KM = 100

/**
 * Fallback local reverse geocode when Nominatim is unavailable.
 *
 * Uses PostGIS ST_DWithin (index-assisted) to find the nearest provider
 * within 100km. Falls back to Haversine in JS only when PostGIS is
 * unavailable or the spatial query fails.
 */
async function reverseGeocodeLocal(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  // Short-term cache (60s) keyed by rounded coordinates.
  // Same coordinate queried multiple times (check-in + check-out) hits cache.
  const cacheKey = `geo:reverse-local:${lat.toFixed(4)},${lng.toFixed(4)}`
  return withCache<ReverseGeocodeResult>(cacheKey, async () => {
    // ── Step 1: Try PostGIS spatial query (O(log N) via GiST index) ──
    try {
      const rows = await db.$queryRaw<
        Array<{
          street: string | null
          district: string | null
          city: string | null
          state: string | null
          cep: string | null
          distance_km: number
        }>
      >`
        SELECT
          "street",
          "district",
          "city",
          "state",
          "cep",
          ST_Distance(
            location,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
          ) / 1000 AS distance_km
        FROM "User"
        WHERE
          role = 'PROVIDER'
          AND active = true
          AND "deletedAt" IS NULL
          AND location IS NOT NULL
          AND ST_DWithin(
            location,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
            ${REVERSE_LOCAL_RADIUS_KM * 1000}
          )
        ORDER BY distance_km ASC
        LIMIT 1
      `

      if (rows.length > 0 && rows[0]!.distance_km <= REVERSE_LOCAL_RADIUS_KM) {
        const nearest = rows[0]!
        return {
          displayName: [nearest.street, nearest.district, nearest.city, nearest.state]
            .filter(Boolean)
            .join(", "),
          road: nearest.street ?? undefined,
          neighbourhood: nearest.district ?? undefined,
          city: nearest.city ?? undefined,
          state: nearest.state ?? undefined,
          postcode: nearest.cep ?? undefined,
        }
      }
    } catch {
      // PostGIS unavailable or extension not installed — fall through to Haversine
    }

    // ── Step 2: Haversine fallback ──
    try {
      const { haversineKm } = await import("@/lib/geo-server")

      const users = await db.user.findMany({
        where: {
          role: "PROVIDER",
          active: true,
          lat: { not: null },
          lng: { not: null },
        },
        select: {
          lat: true,
          lng: true,
          street: true,
          district: true,
          city: true,
          state: true,
          cep: true,
        },
        take: 20,
        orderBy: { avgRating: "desc" as const },
      })

      let nearest: (typeof users)[number] | null = null
      let minDist = Infinity
      for (const u of users) {
        if (u.lat == null || u.lng == null) continue
        const d = haversineKm(lat, lng, u.lat, u.lng)
        if (d < minDist) {
          minDist = d
          nearest = u
        }
      }

      if (!nearest || minDist > REVERSE_LOCAL_RADIUS_KM) {
        return {
          displayName: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          road: undefined,
          neighbourhood: undefined,
          city: undefined,
          state: undefined,
          postcode: undefined,
        }
      }

      return {
        displayName: [nearest.street, nearest.district, nearest.city, nearest.state]
          .filter(Boolean)
          .join(", "),
        road: nearest.street ?? undefined,
        neighbourhood: nearest.district ?? undefined,
        city: nearest.city ?? undefined,
        state: nearest.state ?? undefined,
        postcode: nearest.cep ?? undefined,
      }
    } catch {
      return {
        displayName: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        road: undefined,
        neighbourhood: undefined,
        city: undefined,
        state: undefined,
        postcode: undefined,
      }
    }
  }, 60) // 60s cache TTL for local reverse geocode
}

/**
 * Shared response parser for Nominatim Search results.
 */
function parseNominatimSearchResponse(
  data: Array<{
    lat: string
    lon: string
    display_name?: string
    category?: string
    type?: string
    importance?: string
    address?: {
      road?: string
      neighbourhood?: string
      suburb?: string
      city?: string
      town?: string
      village?: string
      state?: string
      postcode?: string
    }
  }>,
): GeoSearchResult[] {
  if (!Array.isArray(data)) return []
  return data.map((item) => {
    const a = item.address ?? {}
    return {
      lat: Number.parseFloat(item.lat),
      lng: Number.parseFloat(item.lon),
      displayName: item.display_name ?? "",
      street: a.road ?? null,
      district: a.neighbourhood ?? a.suburb ?? null,
      city: a.city ?? a.town ?? a.village ?? null,
      state: a.state ?? null,
      cep: a.postcode ?? null,
      category: item.category,
      type: item.type,
      importance: Number.parseFloat(item.importance ?? "0"),
    }
  })
}

/** Shared headers for Nominatim API calls (User-Agent vindo das settings). */
function nominatimHeaders(userAgent: string): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": userAgent,
  }
}

/** @internal renamed to _geocodeSearch — use geocodeSearchWithMetrics for latency tracking. */
async function _geocodeSearch(query: string, limit: number = 5): Promise<GeoSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const clampedLimit = Math.max(1, Math.min(10, limit))

  try {
    const settings = await getGeoSettings()
    // Kill-switch: Nominatim desligado → fallback local direto (sem rede)
    if (!settings.nominatimEnabled) return geocodeSearchLocal(trimmed, clampedLimit)

    const res = await nominatimBreaker.execute(async () => {
      const url =
        `${settings.nominatimBaseUrl}/search?` +
        `format=jsonv2&q=${encodeURIComponent(trimmed)}` +
        `&addressdetails=1&limit=${clampedLimit}&accept-language=pt-BR`
      const r = await geoFetchWithRetry(url, {
        headers: nominatimHeaders(settings.userAgent),
        next: { revalidate: 86400 },
        timeoutMs: 5000,
        maxRetries: 1,
        label: "nominatim-search",
      })
      if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`)
      return r
    })

    return parseNominatimSearchResponse(await res.json())
  } catch {
    // Nominatim unavailable — fall back to local DB address search
    geoFallbackCounts.search++
    return geocodeSearchLocal(trimmed, clampedLimit)
  }
}

/**
 * Fallback local address search when Nominatim is unavailable.
 *
 * Searches the User table for providers whose city/street/address match the
 * query. This won't find every address (it only covers registered providers)
 * but ensures the user never sees an error — they get partial results instead.
 */
/**
 * Shared select fields for local geocoding queries.
 */
const LOCAL_GEO_SELECT = {
  lat: true,
  lng: true,
  city: true,
  state: true,
  district: true,
  street: true,
  cep: true,
} as const

/**
 * Convert Prisma user results to GeoSearchResult[] (local fallback shape).
 */
function usersToGeoResults(
  users: Array<{
    lat: number | null
    lng: number | null
    city: string | null
    state: string | null
    district: string | null
    street: string | null
    cep: string | null
  }>,
): GeoSearchResult[] {
  return users.map((u) => ({
    lat: u.lat!,
    lng: u.lng!,
    displayName: [u.street, u.district, u.city, u.state].filter(Boolean).join(", "),
    street: u.street,
    district: u.district,
    city: u.city,
    state: u.state,
    cep: u.cep,
    category: "place",
    type: "local_fallback",
    importance: 0.5,
  }))
}

/**
 * Fallback local address search when Nominatim is unavailable.
 *
 * Uses a layered strategy to maximize index usage:
 *   1. Exact city match — uses @@index([city, active, verified]) → O(log N)
 *   2. City prefix (ILIKE 'query%') — still uses B-tree index → O(log N)
 *   3. Broad search on city only (ILIKE '%query%') — single column seq scan
 *   4. Full fallback on all 4 columns (city, street, state, district)
 *
 * Most queries hit layer 1-2 and never reach the expensive paths.
 */
async function geocodeSearchLocal(query: string, limit: number): Promise<GeoSearchResult[]> {
  try {
    const { db } = await import("@/lib/db")
    const q = query.trim()
    if (!q) return []

    // ── Layer 1: Exact city match (B-tree index) ──────────────────────
    const exact = await db.user.findMany({
      where: {
        role: "PROVIDER",
        active: true,
        lat: { not: null },
        lng: { not: null },
        city: { equals: q, mode: "insensitive" },
      },
      select: LOCAL_GEO_SELECT,
      take: limit,
      orderBy: { avgRating: "desc" },
    })
    if (exact.length > 0) return usersToGeoResults(exact)

    // ── Layer 2: City prefix match (B-tree index: 'query%') ───────────
    const prefix = await db.user.findMany({
      where: {
        role: "PROVIDER",
        active: true,
        lat: { not: null },
        lng: { not: null },
        city: { startsWith: q, mode: "insensitive" },
      },
      select: LOCAL_GEO_SELECT,
      take: limit,
      orderBy: { avgRating: "desc" },
    })
    if (prefix.length > 0) return usersToGeoResults(prefix)

    // ── Layer 3: City contains (single column seq scan — cheaper than 4) ─
    const cityMatch = await db.user.findMany({
      where: {
        role: "PROVIDER",
        active: true,
        lat: { not: null },
        lng: { not: null },
        city: { contains: q, mode: "insensitive" },
      },
      select: LOCAL_GEO_SELECT,
      take: limit,
      orderBy: { avgRating: "desc" },
    })
    if (cityMatch.length > 0) return usersToGeoResults(cityMatch)

    // ── Layer 4: Broad search on all 4 columns (most expensive) ───────
    const broad = await db.user.findMany({
      where: {
        role: "PROVIDER",
        active: true,
        lat: { not: null },
        lng: { not: null },
        OR: [
          { street: { contains: q, mode: "insensitive" } },
          { state: { contains: q, mode: "insensitive" } },
          { district: { contains: q, mode: "insensitive" } },
        ],
      },
      select: LOCAL_GEO_SELECT,
      take: limit,
      orderBy: { avgRating: "desc" },
    })
    return usersToGeoResults(broad)
  } catch {
    logger.warn("[geo] Local DB fallback also failed")
    return []
  }
}

/** @internal renamed to _geocodeSearchStructured — use geocodeSearchStructuredWithMetrics for latency tracking. */
async function _geocodeSearchStructured(opts: {
  street?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  postcode?: string | null
  limit?: number
}): Promise<GeoSearchResult[]> {
  const { street, city, state, country, postcode, limit = 5 } = opts

  // Require at least one field
  if (!street?.trim() && !city?.trim() && !state?.trim() && !country?.trim() && !postcode?.trim()) {
    return []
  }

  const clampedLimit = Math.max(1, Math.min(10, limit))

  // Build query params — only include non-empty fields
  const params = new URLSearchParams()
  params.set("format", "jsonv2")
  params.set("structured", "1")
  params.set("addressdetails", "1")
  params.set("limit", String(clampedLimit))
  params.set("accept-language", "pt-BR")

  if (street?.trim()) params.set("street", street.trim())
  if (city?.trim()) params.set("city", city.trim())
  if (state?.trim()) params.set("state", state.trim())
  if (country?.trim()) params.set("country", country.trim())
  if (postcode?.trim()) params.set("postcode", postcode.trim())

  try {
    const settings = await getGeoSettings()
    // Kill-switch: Nominatim desligado → fallback local direto (sem rede)
    if (!settings.nominatimEnabled) {
      const combined = [street, city, state].filter(Boolean).join(", ")
      return geocodeSearchLocal(combined, clampedLimit)
    }

    const res = await nominatimBreaker.execute(async () => {
      const url = `${settings.nominatimBaseUrl}/search?${params.toString()}`
      const r = await geoFetchWithRetry(url, {
        headers: nominatimHeaders(settings.userAgent),
        next: { revalidate: 86400 },
        timeoutMs: 5000,
        maxRetries: 1,
        label: "nominatim-structured",
      })
      if (!r.ok) throw new Error(`Nominatim structured HTTP ${r.status}`)
      return r
    })

    return parseNominatimSearchResponse(await res.json())
  } catch {
    // Nominatim unavailable — fall back to local DB address search
    geoFallbackCounts.structured++
    // Build a combined query from the structured fields for the local search
    const combined = [street, city, state].filter(Boolean).join(", ")
    return geocodeSearchLocal(combined, clampedLimit)
  }
}

// ---------------------------------------------------------------------------
// Currency formatter
// ---------------------------------------------------------------------------

/**
 * Format a number as BRL currency: "R$ 1.234,56".
 */
export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0)
}
