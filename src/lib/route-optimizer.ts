import { calculateRouteAndEta, type RouteEtaResult } from "@/lib/osrm"
import logger from "@/lib/logger"

export type RouteStop = {
  id: string
  label: string
  lat: number
  lng: number
  scheduledAt?: Date | null
}

export type OptimizedRoute = {
  orderedStops: Array<{
    index: number
    stop: RouteStop
    legDistanceKm: number
    legDurationMin: number
  }>
  totalDistanceKm: number
  totalDurationMin: number
  savingsVsOriginalKm: number
  savingsPercent: number
}

/**
 * Optimize the visiting order for a list of stops using a nearest-neighbor
 * heuristic with real OSRM driving distances.
 *
 * This is a pragmatic approach for daily route optimization (typically 2–8 stops)
 * where an exact TSP solution would be overkill and the heuristic produces
 * near-optimal results.
 *
 * @param origin - Provider's starting location (home/base)
 * @param stops  - List of booking locations to visit
 */
export async function optimizeDailyRoute(
  origin: { lat: number; lng: number },
  stops: RouteStop[],
): Promise<OptimizedRoute> {
  if (stops.length === 0) {
    return {
      orderedStops: [],
      totalDistanceKm: 0,
      totalDurationMin: 0,
      savingsVsOriginalKm: 0,
      savingsPercent: 0,
    }
  }

  if (stops.length === 1) {
    const leg = await calculateRouteAndEta(origin.lat, origin.lng, stops[0].lat, stops[0].lng)
    return {
      orderedStops: [
        {
          index: 0,
          stop: stops[0],
          legDistanceKm: leg.distanceKm,
          legDurationMin: leg.durationMin,
        },
      ],
      totalDistanceKm: leg.distanceKm,
      totalDurationMin: leg.durationMin,
      savingsVsOriginalKm: 0,
      savingsPercent: 0,
    }
  }

  // 1. Calculate original (user-order) total distance
  let originalTotalKm = 0
  let prevLat = origin.lat
  let prevLng = origin.lng
  for (const s of stops) {
    const leg = await calculateRouteAndEta(prevLat, prevLng, s.lat, s.lng)
    originalTotalKm += leg.distanceKm
    prevLat = s.lat
    prevLng = s.lng
  }

  // 2. Nearest-neighbor heuristic
  const remaining = new Set(stops.map((_, i) => i))
  const ordered: Array<{
    index: number
    stop: RouteStop
    legDistanceKm: number
    legDurationMin: number
  }> = []

  let currentLat = origin.lat
  let currentLng = origin.lng
  let totalDistanceKm = 0
  let totalDurationMin = 0

  while (remaining.size > 0) {
    let bestIdx = -1
    let bestLeg: RouteEtaResult | null = null

    for (const idx of remaining) {
      const leg = await calculateRouteAndEta(currentLat, currentLng, stops[idx].lat, stops[idx].lng)
      if (!bestLeg || leg.distanceKm < bestLeg.distanceKm) {
        bestIdx = idx
        bestLeg = leg
      }
    }

    if (bestIdx === -1 || !bestLeg) break

    remaining.delete(bestIdx)
    ordered.push({
      index: ordered.length,
      stop: stops[bestIdx],
      legDistanceKm: bestLeg.distanceKm,
      legDurationMin: bestLeg.durationMin,
    })

    totalDistanceKm += bestLeg.distanceKm
    totalDurationMin += bestLeg.durationMin
    currentLat = stops[bestIdx].lat
    currentLng = stops[bestIdx].lng
  }

  const savingsKm = Math.max(0, Math.round((originalTotalKm - totalDistanceKm) * 10) / 10)
  const savingsPercent = originalTotalKm > 0 ? Math.round((savingsKm / originalTotalKm) * 100) : 0

  logger.info(
    {
      stopsCount: stops.length,
      originalKm: originalTotalKm,
      optimizedKm: totalDistanceKm,
      savingsKm,
      savingsPercent,
    },
    "Daily route optimized",
  )

  return {
    orderedStops: ordered,
    totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
    totalDurationMin,
    savingsVsOriginalKm: savingsKm,
    savingsPercent,
  }
}
