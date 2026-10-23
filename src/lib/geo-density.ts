/**
 * geo-density — Densidade de prestadores do marketplace por bairro/anel,
 * consumida pelo cliente para refinar a sugestão de raio além da accuracy
 * do GPS (ver src/lib/geo-radius.ts → refineRadiusWithDensity).
 *
 * Fonte: GET /api/providers/density?lat=&lng= — agregados públicos (contagens
 * por raio e por bairro), sem PII. Cache em memória por coordenada arredondada
 * (~1,1 km de célula) com TTL curto: a densidade muda devagar e o refino roda
 * logo após cada fix de GPS.
 *
 * Falha (rede/500) → null: o chamador mantém a sugestão por accuracy intacta.
 */

import { apiGet } from "@/lib/api"
import { refineRadiusWithDensity, type DensityRing } from "@/lib/geo-radius"

/** Bairro (district) agregado: contagem de prestadores ativos a ≤ 25 km. */
export type DistrictDensity = {
  district: string
  city: string | null
  count: number
  /** Distância (km) do prestador mais próximo DESTE bairro ao ponto consultado. */
  minDistanceKm: number | null
}

/** Resposta de GET /api/providers/density. */
export type ProviderDensity = {
  rings: DensityRing[]
  districts: DistrictDensity[]
}

/** Sugestão refinada pronta para a UI. */
export type RefinedSuggestion = {
  radiusKm: number
  nearbyCount: number
  /** true = área densa (raio encolheu); false = área esparsa (raio cresceu). */
  dense: boolean
  /** Bairro mais denso a ≤ 25 km (contexto para a dica), ou null. */
  district: string | null
}

const CACHE_TTL_MS = 5 * 60_000

// Módulo do cliente — o Map vive por sessão de página (SPA), não no servidor.
const densityCache = new Map<string, { at: number; data: ProviderDensity }>()

/** Chave de cache: coordenada arredondada a 2 decimais (~1,1 km de célula). */
function densityKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`
}

/** Limpa o cache de densidade (uso em testes). */
export function clearDensityCache(): void {
  densityCache.clear()
}

/**
 * Busca a densidade de prestadores no ponto. Retorna null em coordenada
 * inválida, resposta malformada ou falha de rede — nunca lança.
 */
export async function fetchProviderDensity(
  lat: number,
  lng: number,
): Promise<ProviderDensity | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const key = densityKey(lat, lng)
  const hit = densityCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data
  try {
    const data = await apiGet<ProviderDensity>("/api/providers/density", {
      lat: key.split(",")[0],
      lng: key.split(",")[1],
    })
    if (!data || !Array.isArray(data.rings) || data.rings.length === 0) return null
    densityCache.set(key, { at: Date.now(), data })
    return data
  } catch {
    return null
  }
}

/**
 * Refina a sugestão de raio (base = sugestão por accuracy) com a densidade
 * local. Retorna null quando não há densidade ou o anel escolhido não muda
 * a sugestão — o chamador mantém a base sem state extra.
 */
export async function refineSuggestedRadius(opts: {
  accuracyM: number | null | undefined
  baseRadiusKm: number
  lat: number
  lng: number
  target?: number
}): Promise<RefinedSuggestion | null> {
  const density = await fetchProviderDensity(opts.lat, opts.lng)
  if (!density) return null
  const refined = refineRadiusWithDensity({
    accuracyM: opts.accuracyM,
    baseRadiusKm: opts.baseRadiusKm,
    rings: density.rings,
    target: opts.target,
  })
  if (!refined) return null
  const district = density.districts?.[0]?.district ?? null
  return { ...refined, district }
}
