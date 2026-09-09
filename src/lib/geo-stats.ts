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

export { geoCallCounts, geoFallbackCounts }
