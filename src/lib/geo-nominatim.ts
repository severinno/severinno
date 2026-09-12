import "server-only"

import { db } from "@/lib/db"
import { trackGeoLatency } from "./geo-metrics"
import { withCache } from "./redis"
import { rateLimitedNominatim } from "./nominatim-rate-limit"
import { nominatimBreaker } from "./geo-circuit-breakers"
import { recordSearch, recordReverse } from "./geo-query-log"
import { getGeoSettings } from "./geo-settings"
import { geoFetchWithRetry } from "./geo-fetch"
import logger from "./logger"
import { traceSpan } from "./tracing"
import { geoCallCounts, geoFallbackCounts } from "./geo-stats"

// ── Cache-aside wrapper ───────────────────────────────────────────────────

function normalizeCacheKey(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ")
}

function withCachedGeo<T>(
  key: string,
  fn: () => Promise<T>,
  ttl: number,
  limiter: (f: () => Promise<T>) => Promise<T> = rateLimitedNominatim,
): Promise<T> {
  return withCache(key, () => limiter(fn), ttl, {
    staleGraceSeconds: Math.round(ttl * 0.1),
  })
}

// ── Types ─────────────────────────────────────────────────────────────────

/** Result from forward geocoding — query text to coordinates + address. */
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

/** Result from reverse geocoding — coordinates to human-readable address. */
export type ReverseGeocodeResult = {
  displayName: string
  road?: string
  neighbourhood?: string
  city?: string
  state?: string
  postcode?: string
}

// ── Shared helpers ────────────────────────────────────────────────────────

function nominatimHeaders(userAgent: string): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": userAgent,
  }
}

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

// ── Local fallback helpers ────────────────────────────────────────────────

const LOCAL_GEO_SELECT = {
  lat: true,
  lng: true,
  city: true,
  state: true,
  district: true,
  street: true,
  cep: true,
} as const

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

const LOCAL_NEIGHBORHOOD_CATALOG: Array<{
  name: string
  city: string
  state: string
  lat: number
  lng: number
}> = [
  { name: "Moema", city: "São Paulo", state: "SP", lat: -23.6042, lng: -46.6669 },
  { name: "Pinheiros", city: "São Paulo", state: "SP", lat: -23.5671, lng: -46.6993 },
  { name: "Itaim Bibi", city: "São Paulo", state: "SP", lat: -23.5843, lng: -46.6791 },
  { name: "Vila Mariana", city: "São Paulo", state: "SP", lat: -23.5898, lng: -46.6347 },
  { name: "Bela Vista", city: "São Paulo", state: "SP", lat: -23.5606, lng: -46.6493 },
  { name: "Perdizes", city: "São Paulo", state: "SP", lat: -23.5358, lng: -46.6749 },
  { name: "Santana", city: "São Paulo", state: "SP", lat: -23.5042, lng: -46.6264 },
  { name: "Tatuapé", city: "São Paulo", state: "SP", lat: -23.5407, lng: -46.5765 },
  { name: "Copacabana", city: "Rio de Janeiro", state: "RJ", lat: -22.9694, lng: -43.1868 },
  { name: "Ipanema", city: "Rio de Janeiro", state: "RJ", lat: -22.9868, lng: -43.2003 },
  { name: "Leblon", city: "Rio de Janeiro", state: "RJ", lat: -22.9839, lng: -43.2238 },
  { name: "Barra da Tijuca", city: "Rio de Janeiro", state: "RJ", lat: -23.0003, lng: -43.3658 },
  { name: "Botafogo", city: "Rio de Janeiro", state: "RJ", lat: -22.9519, lng: -43.1843 },
  { name: "Tijuca", city: "Rio de Janeiro", state: "RJ", lat: -22.9304, lng: -43.2366 },
  { name: "Savassi", city: "Belo Horizonte", state: "MG", lat: -19.9386, lng: -43.9338 },
  { name: "Lourdes", city: "Belo Horizonte", state: "MG", lat: -19.9298, lng: -43.9439 },
  { name: "Funcionários", city: "Belo Horizonte", state: "MG", lat: -19.9329, lng: -43.9292 },
  { name: "Buritis", city: "Belo Horizonte", state: "MG", lat: -19.9723, lng: -43.9667 },
  { name: "Batel", city: "Curitiba", state: "PR", lat: -25.4419, lng: -49.2897 },
  { name: "Bigorrilho", city: "Curitiba", state: "PR", lat: -25.4336, lng: -49.2974 },
  { name: "Pituba", city: "Salvador", state: "BA", lat: -13.0038, lng: -38.4619 },
  { name: "Barra", city: "Salvador", state: "BA", lat: -13.0102, lng: -38.5324 },
  { name: "Meireles", city: "Fortaleza", state: "CE", lat: -3.7297, lng: -38.4975 },
  { name: "Aldeota", city: "Fortaleza", state: "CE", lat: -3.7388, lng: -38.5028 },
  {
    name: "Ilha dos Araújos",
    city: "Governador Valadares",
    state: "MG",
    lat: -18.8475,
    lng: -41.9392,
  },
  { name: "Esplanada", city: "Governador Valadares", state: "MG", lat: -18.8542, lng: -41.9567 },
  {
    name: "Morada do Acampamento",
    city: "Governador Valadares",
    state: "MG",
    lat: -18.8681,
    lng: -41.9612,
  },
]

/**
 * Fallback local address search when Nominatim is unavailable.
 *
 * Uses a layered strategy to maximize index usage:
 *   1. Exact city match — uses @@index([city, active, verified]) → O(log N)
 *   2. City prefix (ILIKE 'query%') — still uses B-tree index → O(log N)
 *   3. Broad search on city only (ILIKE '%query%') — single column seq scan
 *   4. Full fallback on all 4 columns (city, street, state, district)
 *   5. In-memory popular Brazilian neighborhoods catalog
 */
async function geocodeSearchLocal(query: string, limit: number): Promise<GeoSearchResult[]> {
  try {
    const q = query.trim()
    if (!q) return []

    const baseWhere = {
      role: "PROVIDER" as const,
      active: true,
      lat: { not: null },
      lng: { not: null },
    }

    // ── Layers 1-2: Parallel B-tree index queries (both ~O(log N)) ──────
    const [exact, prefix] = await Promise.all([
      db.user.findMany({
        where: { ...baseWhere, city: { equals: q, mode: "insensitive" } },
        select: LOCAL_GEO_SELECT,
        take: limit,
        orderBy: { avgRating: "desc" },
      }),
      db.user.findMany({
        where: { ...baseWhere, city: { startsWith: q, mode: "insensitive" } },
        select: LOCAL_GEO_SELECT,
        take: limit,
        orderBy: { avgRating: "desc" },
      }),
    ])
    if (exact.length > 0) return usersToGeoResults(exact)
    if (prefix.length > 0) return usersToGeoResults(prefix)

    // ── Layer 3: City contains (single column seq scan — cheaper than 4) ─
    const cityMatch = await db.user.findMany({
      where: { ...baseWhere, city: { contains: q, mode: "insensitive" } },
      select: LOCAL_GEO_SELECT,
      take: limit,
      orderBy: { avgRating: "desc" },
    })
    if (cityMatch.length > 0) return usersToGeoResults(cityMatch)

    // ── Layer 4: Broad search on all 4 columns (most expensive) ───────
    const broad = await db.user.findMany({
      where: {
        ...baseWhere,
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
    if (broad.length > 0) return usersToGeoResults(broad)

    // ── Layer 5: In-memory Popular Brazilian Neighborhoods Catalog ────
    const normalizedQ = q.toLowerCase()
    const matched = LOCAL_NEIGHBORHOOD_CATALOG.filter(
      (n) =>
        n.name.toLowerCase().includes(normalizedQ) || normalizedQ.includes(n.name.toLowerCase()),
    )
    if (matched.length > 0) {
      return matched.slice(0, limit).map((n) => ({
        lat: n.lat,
        lng: n.lng,
        displayName: `${n.name}, ${n.city} - ${n.state}, Brasil`,
        city: n.city,
        state: n.state,
        district: n.name,
        country: "Brasil",
        importance: 0.6,
      }))
    }

    return []
  } catch (err) {
    logger.warn({ err }, "geo: local DB fallback also failed")
    return []
  }
}

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
  const cacheKey = `geo:reverse-local:${lat.toFixed(4)},${lng.toFixed(4)}`
  return withCache<ReverseGeocodeResult>(
    cacheKey,
    async () => {
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
      } catch (err) {
        // PostGIS unavailable or extension not installed — fall through to Haversine
        logger.debug({ err }, "geo: PostGIS unavailable, falling back to Haversine")
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
          take: 100,
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
      } catch (err) {
        logger.debug({ err }, "geo: Haversine fallback failed")
        return {
          displayName: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          road: undefined,
          neighbourhood: undefined,
          city: undefined,
          state: undefined,
          postcode: undefined,
        }
      }
    },
    60,
  )
}

// ── Internal implementations ──────────────────────────────────────────────

async function _geocodeSearch(query: string, limit: number = 5): Promise<GeoSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const clampedLimit = Math.max(1, Math.min(10, limit))

  try {
    const settings = await getGeoSettings()
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
  } catch (err) {
    logger.debug({ err }, "geo: search fallback to local")
    geoFallbackCounts.search++
    return geocodeSearchLocal(trimmed, clampedLimit)
  }
}

async function _geocodeSearchStructured(opts: {
  street?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  postcode?: string | null
  limit?: number
}): Promise<GeoSearchResult[]> {
  const { street, city, state, country, postcode, limit = 5 } = opts

  if (!street?.trim() && !city?.trim() && !state?.trim() && !country?.trim() && !postcode?.trim()) {
    return []
  }

  const clampedLimit = Math.max(1, Math.min(10, limit))

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
  } catch (err) {
    logger.debug({ err }, "geo: structured search fallback to local")
    geoFallbackCounts.structured++
    const combined = [street, city, state].filter(Boolean).join(", ")
    return geocodeSearchLocal(combined, clampedLimit)
  }
}

async function _reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  try {
    const settings = await getGeoSettings()
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
  } catch (err) {
    logger.debug({ err }, "geo: reverse fallback to local")
    geoFallbackCounts.reverse++
    return reverseGeocodeLocal(lat, lng)
  }
}

// ── Public instrumented + cached wrappers ─────────────────────────────────

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
      86400,
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
      86400,
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
      86400,
    )
    span.setAttribute("geo.result.displayName", result.displayName.slice(0, 100))
    recordReverse(lat, lng)
    return result
  })
}
