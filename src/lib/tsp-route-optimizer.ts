/**
 * tsp-route-optimizer.ts — 2-Opt Travelling Salesperson Problem (TSP) Daily Route Optimizer
 *
 * Reorganizes provider daily appointments to minimize total travel distance, fuel consumption,
 * and transit time using 2-Opt local search heuristic.
 *
 * 100% Pure algorithmic Open Source (0 paid routing API dependencies).
 */

import { haversineKm } from "@/lib/geo"

export interface RouteStop {
  id: string
  title: string
  address: string
  lat: number
  lng: number
  clientName?: string
  scheduledTime?: string
}

export interface OptimizedRoutePlan {
  originalOrder: string[]
  optimizedOrder: string[]
  orderedStops: RouteStop[]
  initialDistanceKm: number
  optimizedDistanceKm: number
  savedDistanceKm: number
  savedPercent: number
  estimatedTimeSavedMinutes: number
  googleMapsUrl: string
  wazeUrl: string
  transportMode?: TransportMode
}

export type TransportMode = "MOTO" | "CAR" | "BICYCLE"

export interface TransportProfile {
  mode: TransportMode
  urbanRoadFactor: number
  avgSpeedKmh: number
  label: string
}

export const TRANSPORT_PROFILES: Record<TransportMode, TransportProfile> = {
  MOTO: {
    mode: "MOTO",
    urbanRoadFactor: 1.25,
    avgSpeedKmh: 36.0,
    label: "Motocicleta / Scooter",
  },
  CAR: {
    mode: "CAR",
    urbanRoadFactor: 1.38,
    avgSpeedKmh: 28.0,
    label: "Carro / Veículo",
  },
  BICYCLE: {
    mode: "BICYCLE",
    urbanRoadFactor: 1.15,
    avgSpeedKmh: 16.0,
    label: "Bicicleta / E-bike",
  },
}

const DEFAULT_ROAD_FACTOR = 1.38

/**
 * Computes total tour distance given a sequence of stops starting from base
 */
function computeTourDistance(
  base: { lat: number; lng: number },
  stops: RouteStop[],
  roadFactor: number = DEFAULT_ROAD_FACTOR,
): number {
  if (stops.length === 0) return 0

  let total = haversineKm(base.lat, base.lng, stops[0].lat, stops[0].lng) * roadFactor

  for (let i = 0; i < stops.length - 1; i++) {
    total +=
      haversineKm(stops[i].lat, stops[i].lng, stops[i + 1].lat, stops[i + 1].lng) * roadFactor
  }

  return Number(total.toFixed(2))
}

/**
 * 2-Opt Edge Swap Step: reverses the segment between index i and k
 */
function twoOptSwap(route: RouteStop[], i: number, k: number): RouteStop[] {
  const newRoute = route.slice(0, i)
  const middle = route.slice(i, k + 1).reverse()
  const tail = route.slice(k + 1)
  return newRoute.concat(middle).concat(tail)
}

/**
 * Optimizes a list of daily stops starting from provider base location using 2-Opt Heuristic
 */
export function optimizeDailyRoute2Opt(
  baseLocation: { lat: number; lng: number },
  stops: RouteStop[],
  transportMode: TransportMode = "CAR",
): OptimizedRoutePlan {
  const profile = TRANSPORT_PROFILES[transportMode] ?? TRANSPORT_PROFILES.CAR
  const roadFactor = profile.urbanRoadFactor
  const avgSpeed = profile.avgSpeedKmh

  if (stops.length <= 1) {
    const dist = computeTourDistance(baseLocation, stops, roadFactor)
    return {
      originalOrder: stops.map((s) => s.id),
      optimizedOrder: stops.map((s) => s.id),
      orderedStops: stops,
      initialDistanceKm: dist,
      optimizedDistanceKm: dist,
      savedDistanceKm: 0,
      savedPercent: 0,
      estimatedTimeSavedMinutes: 0,
      googleMapsUrl: generateGoogleMapsMultiStopUrl(baseLocation, stops),
      wazeUrl: generateWazeUrl(stops[0] || baseLocation),
      transportMode: profile.mode,
    }
  }

  const initialDistanceKm = computeTourDistance(baseLocation, stops, roadFactor)
  const originalOrder = stops.map((s) => s.id)

  // 1. Initial Greedy Nearest Neighbor tour
  const unvisited = [...stops]
  let currentLoc = baseLocation
  let bestRoute: RouteStop[] = []

  while (unvisited.length > 0) {
    let nearestIdx = 0
    let minD = Infinity

    for (let i = 0; i < unvisited.length; i++) {
      const d = haversineKm(currentLoc.lat, currentLoc.lng, unvisited[i].lat, unvisited[i].lng)
      if (d < minD) {
        minD = d
        nearestIdx = i
      }
    }

    const nextStop = unvisited.splice(nearestIdx, 1)[0]
    bestRoute.push(nextStop)
    currentLoc = nextStop
  }

  // 2. Iterative 2-Opt Local Search Improvement
  let bestDistance = computeTourDistance(baseLocation, bestRoute, roadFactor)
  let improved = true
  let iterations = 0
  const maxIterations = 100 // Prevent infinite loop in dense graphs

  while (improved && iterations < maxIterations) {
    improved = false
    iterations++

    for (let i = 0; i < bestRoute.length - 1; i++) {
      for (let k = i + 1; k < bestRoute.length; k++) {
        const candidateRoute = twoOptSwap(bestRoute, i, k)
        const candidateDistance = computeTourDistance(baseLocation, candidateRoute, roadFactor)

        if (candidateDistance < bestDistance - 0.01) {
          bestRoute = candidateRoute
          bestDistance = candidateDistance
          improved = true
          break
        }
      }
      if (improved) break
    }
  }

  const optimizedDistanceKm = Number(bestDistance.toFixed(2))
  const savedDistanceKm = Number(Math.max(0, initialDistanceKm - optimizedDistanceKm).toFixed(2))
  const savedPercent =
    initialDistanceKm > 0 ? Number(((savedDistanceKm / initialDistanceKm) * 100).toFixed(1)) : 0
  const estimatedTimeSavedMinutes = Math.round((savedDistanceKm / avgSpeed) * 60)

  return {
    originalOrder,
    optimizedOrder: bestRoute.map((s) => s.id),
    orderedStops: bestRoute,
    initialDistanceKm,
    optimizedDistanceKm,
    savedDistanceKm,
    savedPercent,
    estimatedTimeSavedMinutes,
    googleMapsUrl: generateGoogleMapsMultiStopUrl(baseLocation, bestRoute),
    wazeUrl: generateWazeUrl(bestRoute[0] || baseLocation),
    transportMode: profile.mode,
  }
}

/**
 * Generates direct Google Maps multi-stop navigation URL
 */
function generateGoogleMapsMultiStopUrl(
  origin: { lat: number; lng: number },
  stops: RouteStop[],
): string {
  if (stops.length === 0) {
    return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}`
  }

  const destination = stops[stops.length - 1]
  const waypoints = stops
    .slice(0, stops.length - 1)
    .map((s) => `${s.lat},${s.lng}`)
    .join("|")

  const waypointParam = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}${waypointParam}&travelmode=driving`
}

/**
 * Generates Waze navigation URL to the first upcoming stop
 */
function generateWazeUrl(target: { lat: number; lng: number }): string {
  return `https://waze.com/ul?ll=${target.lat},${target.lng}&navigate=yes`
}
