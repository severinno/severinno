import { withCache } from "@/lib/redis"
import { haversineKm } from "@/lib/geo"
import logger from "@/lib/logger"

const osrmLogger = logger.child({ module: "osrm" })

export type RouteEtaResult = {
  distanceKm: number
  durationMin: number
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  geometry?: [number, number][]
  source: "osrm" | "haversine-estimate"
}

type OsrmApiResponse = {
  code: string
  routes: Array<{
    distance: number // meters
    duration: number // seconds
    geometry?: {
      coordinates: [number, number][]
    }
  }>
}

function getOsrmUrl(): string {
  return process.env.OSRM_URL || "https://router.project-osrm.org"
}

/**
 * Calculate driving distance (km), estimated time of arrival (min), and route geometry
 * between two coordinates using the 100% open-source OSRM routing engine.
 *
 * Includes 1h Redis caching and instant urban-coefficient fallback.
 */
export async function calculateRouteAndEta(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<RouteEtaResult> {
  const cacheKey = `geo:route:${originLat.toFixed(3)},${originLng.toFixed(3)}:${destLat.toFixed(3)},${destLng.toFixed(3)}`

  return withCache(
    cacheKey,
    async () => {
      // 1. Try real OSRM driving route
      try {
        const url = `${getOsrmUrl()}/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=simplified&geometries=geojson`
        const res = await fetch(url, {
          headers: { "User-Agent": "SeverinnoMarketplace/1.0" },
          signal: AbortSignal.timeout(3500),
        })

        if (res.ok) {
          const data = (await res.json()) as OsrmApiResponse
          if (data.code === "Ok" && data.routes?.length > 0) {
            const route = data.routes[0]
            const distanceKm = Math.round((route.distance / 1000) * 10) / 10
            const durationMin = Math.max(1, Math.round(route.duration / 60))

            return {
              distanceKm,
              durationMin,
              origin: { lat: originLat, lng: originLng },
              destination: { lat: destLat, lng: destLng },
              geometry: route.geometry?.coordinates,
              source: "osrm" as const,
            }
          }
        }
      } catch (err) {
        osrmLogger.warn(
          { err: (err as Error).message },
          "OSRM routing unavailable, using urban fallback",
        )
      }

      // 2. High-precision Urban Road Network Fallback
      // Direct haversine line multiplied by standard Brazilian urban road factor (~1.35x)
      const straightLineKm = haversineKm(originLat, originLng, destLat, destLng)
      const drivingDistanceKm = Math.round(straightLineKm * 1.35 * 10) / 10
      // Urban average speed: 25 km/h + 3 min departure buffer
      const drivingDurationMin = Math.max(3, Math.round((drivingDistanceKm / 25) * 60 + 3))

      return {
        distanceKm: drivingDistanceKm,
        durationMin: drivingDurationMin,
        origin: { lat: originLat, lng: originLng },
        destination: { lat: destLat, lng: destLng },
        source: "haversine-estimate" as const,
      }
    },
    3600, // 1 hour TTL
  )
}
