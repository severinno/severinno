import "server-only"

/**
 * Geolocation & formatting helpers — SERVER-SIDE ONLY.
 * (Some functions call external APIs with a real User-Agent.)
 *
 * Pure math helpers (haversineKm, formatDistance) live in geo-shared.ts
 * which is safe for both server and client.
 */

import { trackGeoLatency } from "./geo-metrics"
import { withCache } from "./redis"
import { rateLimitedNominatim } from "./nominatim-rate-limit"
import { recordSearch, recordCEP, recordReverse } from "./geo-query-log"

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
 *   1. rateLimitedNominatim — respeita política OSM (1 req/s)
 *   2. trackGeoLatency — métricas P50/P95/P99
 *   3. withCache — armazena no Redis + in-memory fallback
 */
function withCachedGeo<T>(key: string, fn: () => Promise<T>, ttl: number): Promise<T> {
  // The rate limiter + latency tracker go INSIDE the cache-miss callback
  // so they only run when we actually call the external API.
  // Cache hit is nearly instant — no need for separate metrics.
  return withCache(key, () => rateLimitedNominatim(fn), ttl)
}

// ── Instrumented + cached wrappers ───────────────────────────────────────
// Each wrapper adds BOTH latency tracking AND Redis caching.

/** Wraps geocodeCEP with Redis cache (7d TTL) + ViaCEP latency tracking. */
export async function geocodeCEP(cep: string): Promise<ViaCEPResult> {
  const clean = cep.replace(/\D/g, "")
  const result = await withCachedGeo(
    `geo:cep:${clean}`,
    () => trackGeoLatency("viacep", () => _geocodeCEP(clean)),
    604800, // 7d
  )
  // Record in query log so we can warm the most popular CEPs after restart
  recordCEP(cep)
  return result
}

/** Wraps geocodeSearch with Redis cache (24h TTL) + Nominatim latency tracking. */
export async function geocodeSearch(query: string, limit: number = 5): Promise<GeoSearchResult[]> {
  const key = `geo:search:${normalizeCacheKey(query)}:${Math.max(1, Math.min(10, limit))}`
  const result = await withCachedGeo(
    key,
    () => trackGeoLatency("nominatim", () => _geocodeSearch(query, limit)),
    86400, // 24h
  )
  // Record in query log so we can warm the most popular search queries after restart
  recordSearch(query)
  return result
}

/** Wraps geocodeSearchStructured with Redis cache (24h TTL) + Nominatim tracking. */
export async function geocodeSearchStructured(
  opts: Parameters<typeof _geocodeSearchStructured>[0],
): Promise<GeoSearchResult[]> {
  const { street, city, state, country, postcode, limit = 5 } = opts
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
  // Record structured search as a combined query for warming purposes
  const combined = [street, city, state, postcode].filter(Boolean).join(", ")
  if (combined) recordSearch(combined)
  return result
}

/** Wraps reverseGeocode with Redis cache (24h TTL) + Nominatim latency tracking. */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  const result = await withCachedGeo(
    `geo:reverse:${lat.toFixed(4)},${lng.toFixed(4)}`,
    () => trackGeoLatency("nominatim", () => _reverseGeocode(lat, lng)),
    86400, // 24h (coordenadas fixas — não mudam)
  )
  // Record in query log so we can warm the most popular reverse geocodes after restart
  recordReverse(lat, lng)
  return result
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
    const url = `https://viacep.com.br/ws/${clean}/json/`
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(5000), // 5s timeout
    })
    if (!res.ok) throw new Error(`ViaCEP HTTP ${res.status}`)

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
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=pt-BR`
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "SeverinnoMarketplace/1.0 (admin@severinno.com)",
      },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000), // 5s timeout
    })
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`)

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
async function reverseGeocodeLocal(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  try {
    const { db } = await import("@/lib/db")
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
      take: 5,
      orderBy: { avgRating: "desc" as const },
    })

    // Find the nearest provider by Haversine distance
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

    if (!nearest || minDist > 100) {
      // No provider within 100km — return minimal result with raw coords
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
    // DB query also failed — return minimal result
    return {
      displayName: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      road: undefined,
      neighbourhood: undefined,
      city: undefined,
      state: undefined,
      postcode: undefined,
    }
  }
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

/** Shared headers for Nominatim API calls. */
const NOMINATIM_HEADERS = {
  Accept: "application/json",
  "User-Agent": "SeverinnoMarketplace/1.0 (admin@severinno.com)",
} as const

/** @internal renamed to _geocodeSearch — use geocodeSearchWithMetrics for latency tracking. */
async function _geocodeSearch(query: string, limit: number = 5): Promise<GeoSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const clampedLimit = Math.max(1, Math.min(10, limit))

  try {
    const url =
      `https://nominatim.openstreetmap.org/search?` +
      `format=jsonv2&q=${encodeURIComponent(trimmed)}` +
      `&addressdetails=1&limit=${clampedLimit}&accept-language=pt-BR`

    const res = await fetch(url, {
      headers: NOMINATIM_HEADERS,
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(5000), // 5s timeout
    })
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`)

    return parseNominatimSearchResponse(await res.json())
  } catch {
    // Nominatim unavailable — fall back to local DB address search
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
async function geocodeSearchLocal(query: string, limit: number): Promise<GeoSearchResult[]> {
  try {
    const { db } = await import("@/lib/db")

    // Search for providers whose city, street, or state contains the query
    const users = await db.user.findMany({
      where: {
        role: "PROVIDER",
        active: true,
        lat: { not: null },
        lng: { not: null },
        OR: [
          { city: { contains: query, mode: "insensitive" } },
          { street: { contains: query, mode: "insensitive" } },
          { state: { contains: query, mode: "insensitive" } },
          { district: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        lat: true,
        lng: true,
        city: true,
        state: true,
        district: true,
        street: true,
        cep: true,
      },
      take: limit,
      orderBy: { avgRating: "desc" },
    })

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
  } catch {
    // If DB query also fails, return empty array
    console.warn("[geo] Local DB fallback also failed")
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

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`

  try {
    const res = await fetch(url, { headers: NOMINATIM_HEADERS, next: { revalidate: 86400 } })
    if (!res.ok) throw new Error(`Nominatim structured HTTP ${res.status}`)

    return parseNominatimSearchResponse(await res.json())
  } catch {
    // Nominatim unavailable — fall back to local DB address search
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
