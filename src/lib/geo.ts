import "server-only"

/**
 * Geolocation & formatting helpers — SERVER-SIDE ONLY.
 *
 * Pure math helpers (haversineKm, formatDistance) live in geo-shared.ts
 * which is safe for both server and client.
 *
 * Implementation modules:
 *   geo-nominatim.ts — Nominatim geocoding (search, structured search, reverse)
 *   geo-viacep.ts    — ViaCEP Brazilian postal code lookup
 *   geo-stats.ts     — Per-operation call counters
 */

export { geocodeSearch, geocodeSearchStructured, reverseGeocode } from "./geo-nominatim"
export type { GeoSearchResult, ReverseGeocodeResult } from "./geo-nominatim"

export { geocodeCEP } from "./geo-viacep"
export type { ViaCEPResult } from "./geo-viacep"

export { getGeoCallStats } from "./geo-stats"

export { haversineKm, formatDistance } from "./geo-shared"

/**
 * Format a number as BRL currency: "R$ 1.234,56".
 */
export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0)
}
