/**
 * geo-radius — Sugestão de raio de atendimento a partir da precisão do GPS.
 *
 * `GeolocationCoordinates.accuracy` é o raio de 68% de confiança da fix em
 * METROS. A sugestão garante que o círculo de atendimento cubra folgadamente
 * a incerteza da fix (raio ≥ ~3× a incerteza em km nos tiers mais grossos) e
 * parte de uma base útil para matching de prestadores próximos.
 */

/** Raio padrão (km) usado hoje no onboarding/perfil — fallback sem accuracy. */
export const DEFAULT_RADIUS_KM = 15

/** Limites do slider de raio no produto (km). */
export const MIN_RADIUS_KM = 1
export const MAX_RADIUS_KM = 100

/**
 * Sugere um raio inicial (km) a partir da precisão do GPS em metros.
 *
 * Tiers:
 *   - ≤ 30 m   (GPS excelente, fix de satélite)  → 5 km
 *   - ≤ 100 m  (GPS bom)                         → 8 km
 *   - ≤ 1 km   (Wi-Fi / triangulação urbana)     → 15 km
 *   - ≤ 5 km   (torre celular)                   → 30 km
 *   - > 5 km   (fix muito grosseiro)             → 50 km
 *   - sem accuracy válida                        → 15 km (default)
 */
export function suggestRadiusFromAccuracy(accuracyM: number | null | undefined): number {
  if (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM <= 0) {
    return DEFAULT_RADIUS_KM
  }
  if (accuracyM <= 30) return 5
  if (accuracyM <= 100) return 8
  if (accuracyM <= 1_000) return 15
  if (accuracyM <= 5_000) return 30
  return 50
}

/** Kilometros por grau de latitude (aproximação equiretangular). */
const KM_PER_DEG_LAT = 111.32

// ---------------------------------------------------------------------------
// Refino da sugestão pela densidade do marketplace
// ---------------------------------------------------------------------------

/**
 * Refino da sugestão de raio usando as métricas de busca do marketplace —
 * a densidade de prestadores ativos por bairro/anel em torno do ponto.
 *
 * A sugestão por accuracy (acima) cobre a QUALIDADE da fix; a densidade cobre
 * a OFERTA real: num bairro denso um raio curto já encontra prestadores
 * suficientes (menos ruído na busca); numa área esparsa o raio cresce até
 * atingir um número saudável de resultados (busca não nasce vazia).
 *
 * Contrato:
 *   - `rings` são contagens agregadas (sem PII) em raios canônicos crescentes;
 *   - o raio refinado é o MENOR anel com `count ≥ target`, nunca abaixo do
 *     piso da accuracy (3× a incerteza da fix, máx. 10 km — a fix grosseira
 *     não pode virar sugestão de raio minúsculo) nem acima de MAX_RADIUS_KM;
 *   - sem anéis válidos (API indisponível) ou sem mudança real → null
 *     (o chamador mantém a sugestão por accuracy — degradação suave).
 */

/** Anel de densidade: prestadores ativos dentro de `radiusKm` do ponto. */
export type DensityRing = { radiusKm: number; count: number }

/** Resultado saudável de busca: nº de prestadores que o raio sugerido deve alcançar. */
export const DENSITY_TARGET_PROVIDERS = 12

/** O raio sugerido absorve a incerteza da fix: raio ≥ 3× a accuracy (em km). */
export const DENSITY_ACCURACY_SAFETY_FACTOR = 3

/** Piso máximo do floor de accuracy — fixes grosseiras não travam o refino denso acima disso. */
export const DENSITY_MAX_ACCURACY_FLOOR_KM = 10

export type RadiusRefinement = {
  /** Raio refinado (km) — já clamped em [MIN_RADIUS_KM, MAX_RADIUS_KM]. */
  radiusKm: number
  /** Nº de prestadores no anel escolhido (para a dica na UI). */
  nearbyCount: number
  /** true = área densa (raio encolheu); false = área esparsa (raio cresceu). */
  dense: boolean
}

/**
 * Refina a sugestão de raio (por accuracy) com os anéis de densidade.
 *
 * @returns o refinamento, ou null quando não há dados válidos ou o anel
 * escolhido coincide com a sugestão base (nada a mudar).
 */
export function refineRadiusWithDensity(params: {
  accuracyM: number | null | undefined
  baseRadiusKm: number
  rings: DensityRing[]
  target?: number
}): RadiusRefinement | null {
  const baseRadiusKm = params.baseRadiusKm
  const rings = (params.rings ?? [])
    .filter(
      (r) =>
        r != null &&
        Number.isFinite(r.radiusKm) &&
        r.radiusKm > 0 &&
        Number.isFinite(r.count) &&
        r.count >= 0,
    )
    .sort((a, b) => a.radiusKm - b.radiusKm)
  if (rings.length === 0 || !Number.isFinite(baseRadiusKm) || baseRadiusKm <= 0) return null

  const target = params.target ?? DENSITY_TARGET_PROVIDERS

  // Piso pela qualidade da fix: o círculo sugerido precisa conter a incerteza.
  let floorKm = MIN_RADIUS_KM
  if (params.accuracyM != null && Number.isFinite(params.accuracyM) && params.accuracyM > 0) {
    floorKm = Math.min(
      DENSITY_MAX_ACCURACY_FLOOR_KM,
      Math.max(
        MIN_RADIUS_KM,
        Math.ceil((params.accuracyM * DENSITY_ACCURACY_SAFETY_FACTOR) / 1000),
      ),
    )
  }

  // Menor anel com oferta saudável; sem nenhum → anel mais largo (área esparsa).
  const hit = rings.find((r) => r.count >= target) ?? rings[rings.length - 1]
  const radiusKm = Math.min(MAX_RADIUS_KM, Math.max(floorKm, hit.radiusKm))
  if (!Number.isFinite(radiusKm) || radiusKm === baseRadiusKm) return null

  return { radiusKm, nearbyCount: hit.count, dense: radiusKm < baseRadiusKm }
}

/** Frase pt-BR com o nº de prestadores por perto (para dicas/toasts). */
export function nearbyPhrase(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "nenhum prestador por perto"
  return `${count} ${count === 1 ? "prestador" : "prestadores"} por perto`
}

/**
 * Bounds (oeste/sul, leste/norte) do círculo de raio — usado para
 * `map.fitBounds` centralizar e dar zoom no círculo automaticamente.
 */
export function radiusBounds(
  lat: number,
  lng: number,
  radiusKm: number,
): [[number, number], [number, number]] {
  const safeRadius = Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : MIN_RADIUS_KM
  const latRad = (lat * Math.PI) / 180
  const kmPerDegLng = Math.max(KM_PER_DEG_LAT * Math.cos(latRad), 1e-6)
  const dLat = safeRadius / KM_PER_DEG_LAT
  const dLng = safeRadius / kmPerDegLng
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat + dLat],
  ]
}
