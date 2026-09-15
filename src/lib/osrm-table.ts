/**
 * osrm-table.ts — OSRM Table Service (1xN / MxN Distance Matrix Batch Engine)
 *
 * Replaces N individual route calls or paid Google Maps Distance Matrix API calls
 * with a single sub-15ms OSRM Table call for batch ETA calculations.
 */

import { haversineKm } from "@/lib/geo"
import { osrmTableBreaker } from "./geo-circuit-breakers"

export interface TargetDestination {
  id: string
  lat: number
  lng: number
  name?: string
}

export interface MatrixETAResult {
  id: string
  distanceKm: number
  durationMinutes: number
  source: "osrm-table" | "haversine-urban-fallback"
  trafficLevel: "LOW" | "MODERATE" | "HEAVY"
}

const URBAN_ROAD_FACTOR = 1.38 // Brazilian urban street geometry multiplier
const AVG_CITY_SPEED_KMH = 28.0 // Average urban traffic speed

/**
 * Calculates real-time distance and driving duration from 1 origin to N destinations in a single batch
 */
export async function calculate1xNDistanceMatrix(
  origin: { lat: number; lng: number },
  destinations: TargetDestination[],
): Promise<MatrixETAResult[]> {
  if (!origin || destinations.length === 0) {
    return []
  }

  const osrmBaseUrl = process.env.OSRM_URL || "http://router.project-osrm.org"

  try {
    // 1. Format coordinates: origin is index 0, destinations are indices 1..N
    // Format: lng,lat;lng,lat;...
    const coords = [`${origin.lng},${origin.lat}`]
    for (const d of destinations) {
      coords.push(`${d.lng},${d.lat}`)
    }

    const coordString = coords.join(";")
    const destIndices = Array.from({ length: destinations.length }, (_, i) => i + 1).join(";")

    const data = await osrmTableBreaker.execute(async () => {
      const url = `${osrmBaseUrl}/table/v1/driving/${coordString}?sources=0&destinations=${destIndices}&annotations=distance,duration`
      const res = await fetch(url, {
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) throw new Error(`OSRM Table HTTP ${res.status}`)
      return res.json()
    })

    if (data.code === "Ok" && data.durations?.[0] && data.distances?.[0]) {
      const durations = data.durations[0] // in seconds
      const distances = data.distances[0] // in meters

      return destinations.map((dest, idx) => {
        const distMeters = distances[idx] ?? 0
        const durSec = durations[idx] ?? 0

        const distanceKm = Number((distMeters / 1000).toFixed(2))
        const durationMinutes = Math.max(1, Math.round(durSec / 60))

        // Traffic level estimation based on effective speed
        const effectiveSpeed = distanceKm / (durationMinutes / 60)
        const trafficLevel =
          effectiveSpeed < 18 ? "HEAVY" : effectiveSpeed < 32 ? "MODERATE" : "LOW"

        return {
          id: dest.id,
          distanceKm,
          durationMinutes,
          source: "osrm-table" as const,
          trafficLevel,
        }
      })
    }
  } catch {
    // Fallback gracefully on timeout or offline mode
  }

  // 2. High-fidelity Urban Fallback
  return destinations.map((dest) => {
    const rawDist = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng)
    const distanceKm = Number((rawDist * URBAN_ROAD_FACTOR).toFixed(2))
    const durationMinutes = Math.max(1, Math.round((distanceKm / AVG_CITY_SPEED_KMH) * 60))

    return {
      id: dest.id,
      distanceKm,
      durationMinutes,
      source: "haversine-urban-fallback" as const,
      trafficLevel: "MODERATE" as const,
    }
  })
}
