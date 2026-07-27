import "server-only"

/**
 * Geolocation & formatting helpers — SERVER-SIDE ONLY.
 * (Some functions call external APIs with a real User-Agent.)
 *
 * Pure math helpers (haversineKm, formatDistance) live in geo-shared.ts
 * which is safe for both server and client.
 */

export { haversineKm, formatDistance } from "./geo-shared"

export type ViaCEPResult = {
  cep: string
  street: string
  district: string
  city: string
  state: string
}

/**
 * Geocode a Brazilian CEP using the ViaCEP API.
 * Throws on network errors or invalid CEP.
 */
export async function geocodeCEP(cep: string): Promise<ViaCEPResult> {
  const clean = cep.replace(/\D/g, "")
  if (clean.length !== 8) {
    throw new Error("CEP inválido (deve ter 8 dígitos)")
  }
  const url = `https://viacep.com.br/ws/${clean}/json/`
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    // ViaCEP cache-friendly: short cache is fine
    next: { revalidate: 86400 },
  })
  if (!res.ok) {
    throw new Error(`ViaCEP HTTP ${res.status}`)
  }
  const data = (await res.json()) as {
    cep?: string
    logradouro?: string
    bairro?: string
    localidade?: string
    uf?: string
    erro?: boolean
  }
  if (data.erro) {
    throw new Error("CEP não encontrado")
  }
  return {
    cep: data.cep ?? clean,
    street: data.logradouro ?? "",
    district: data.bairro ?? "",
    city: data.localidade ?? "",
    state: data.uf ?? "",
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

/**
 * Reverse geocode lat/lng using Nominatim (OpenStreetMap).
 * Calls server-side only — must include a real User-Agent per OSM policy.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<ReverseGeocodeResult> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=pt-BR`
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "SeverinnoMarketplace/1.0 (admin@severinno.com)",
    },
    next: { revalidate: 3600 },
  })
  if (!res.ok) {
    throw new Error(`Nominatim HTTP ${res.status}`)
  }
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

/**
 * Forward-geocode a free-form text address using Nominatim Search.
 *
 * Accepts a query like "Rua Augusta, São Paulo" and returns up to `limit`
 * results sorted by importance.
 *
 * @see https://nominatim.org/release-docs/develop/api/Search/
 */
export async function geocodeSearch(
  query: string,
  limit: number = 5,
): Promise<GeoSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const clampedLimit = Math.max(1, Math.min(10, limit))
  const url =
    `https://nominatim.openstreetmap.org/search?` +
    `format=jsonv2&q=${encodeURIComponent(trimmed)}` +
    `&addressdetails=1&limit=${clampedLimit}&accept-language=pt-BR`

  const res = await fetch(url, { headers: NOMINATIM_HEADERS, next: { revalidate: 86400 } })
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`)

  return parseNominatimSearchResponse(await res.json())
}

/**
 * Forward-geocode a structured address using Nominatim Search.
 *
 * Instead of a free-form `q`, this uses Nominatim's `structured=1` mode
 * with dedicated fields for street, city, state, country, and postcode.
 * The structured mode is significantly more precise for well-known
 * addresses because each component is interpreted in its proper context.
 *
 * At least one of `street`, `city`, or `state` must be provided,
 * otherwise an empty array is returned.
 *
 * @param opts.street  - Street name (optionally with housenumber), e.g. "Av. Paulista, 1000"
 * @param opts.city    - City or locality name, e.g. "São Paulo"
 * @param opts.state   - State code or name, e.g. "SP" or "São Paulo"
 * @param opts.country - Country name (default "Brazil")
 * @param opts.postcode- Postal code / CEP
 * @param opts.limit   - Max results (default 5, max 10)
 *
 * @see https://nominatim.org/release-docs/develop/api/Search/#structured-query
 */
export async function geocodeSearchStructured(opts: {
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

  const res = await fetch(url, { headers: NOMINATIM_HEADERS, next: { revalidate: 86400 } })
  if (!res.ok) throw new Error(`Nominatim structured HTTP ${res.status}`)

  return parseNominatimSearchResponse(await res.json())
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
