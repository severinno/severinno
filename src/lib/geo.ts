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

/**
 * Format a number as BRL currency: "R$ 1.234,56".
 */
export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0)
}
