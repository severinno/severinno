/**
 * Routing utilities for the Severinno Marketplace.
 *
 * Provides distance and duration estimates between coordinates
 * using Haversine formula (direct line) or optional OSRM-based routing.
 *
 * Haversine math is imported from ./geo-shared to avoid duplication.
 *
 * In tests, this module is fully mocked via vi.mock().
 */

import { haversineKm } from "./geo-shared"

export type RouteResult = {
  distanceKm: number
  durationMin: number
}

/** Supported coordinate formats (array tuple or object). */
type LatLng = { lat: number; lng: number }
type LatLngArray = [number, number]
type Coords = LatLng | LatLngArray

/** Normalize to { lat, lng } object. */
function toLatLng(c: Coords): LatLng {
  return Array.isArray(c) ? { lat: c[0], lng: c[1] } : c
}

/**
 * Estimate travel time in minutes based on distance and average speed.
 * Default assumes 30 km/h urban average.
 */
export function estimateDuration(distanceKm: number, avgSpeedKmH = 30): number {
  if (distanceKm <= 0) return 0
  return (distanceKm / avgSpeedKmH) * 60
}

/**
 * Get a single route between origin and destination coordinates.
 * Accepts both { lat, lng } objects and [lat, lng] arrays.
 *
 * In production, this could call OSRM / Mapbox / Google Maps API.
 * Currently returns straight-line (Haversine) approximation.
 */
export async function getRoute(
  origin: Coords,
  destination: Coords,
): Promise<RouteResult> {
  const o = toLatLng(origin)
  const d = toLatLng(destination)
  const distanceKm = haversineKm(o.lat, o.lng, d.lat, d.lng)
  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMin: Math.round(estimateDuration(distanceKm)),
  }
}

/**
 * Get multiple routes from a single origin to several destinations.
 * Results are returned in the same order as the destinations array.
 */
export async function getMultiRoute(
  origin: Coords,
  destinations: Coords[],
): Promise<RouteResult[]> {
  return Promise.all(
    destinations.map((dest) => getRoute(origin, dest)),
  )
}
