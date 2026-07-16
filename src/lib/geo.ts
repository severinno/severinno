import "server-only"

/**
 * Geolocation & formatting helpers — SERVER-SIDE ONLY.
 * (Some functions call external APIs with a real User-Agent.)
 */

const EARTH_RADIUS_KM = 6371

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Haversine distance in kilometers between two lat/lng points.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}

/**
 * Format a distance (km) as a pt-BR string.
 * < 1 km  → "850 m"
 * >= 1 km → "1,2 km"
 */
export function formatDistance(km: number): string {
  if (!Number.isFinite(km)) return "—"
  if (km < 1) {
    const meters = Math.round(km * 1000)
    return `${meters} m`
  }
  if (km < 10) {
    return `${km.toFixed(1).replace(".", ",")} km`
  }
  return `${Math.round(km)} km`
}

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

/**
 * Format a number as BRL currency: "R$ 1.234,56".
 */
export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0)
}
