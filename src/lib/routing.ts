/**
 * Routing utilities for the Severinno Marketplace.
 *
 * Provides distance, duration, and polyline estimates between coordinates
 * using OSRM (Open Source Routing Machine) with Haversine fallback when
 * OSRM is unavailable.
 *
 * Architecture:
 *   1. Primary: Call OSRM HTTP API (running at OSRM_BASE_URL)
 *   2. Fallback: Haversine straight-line distance + estimated duration at 30 km/h
 *
 * OSRM setup:
 *   docker compose -f docker-compose.dev.yml --profile routing up -d osrm
 */

import { haversineKm } from "./geo-shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RouteResult = {
  /** Distance in kilometers (rounded to 1 decimal). */
  distanceKm: number
  /** Estimated travel time in minutes. */
  durationMin: number
  /**
   * Polyline as an array of [lng, lat] coordinates for map rendering.
   * null when OSRM is unavailable or the route can't be computed.
   */
  polyline: [number, number][] | null
}

/** Supported coordinate formats (array tuple or object). */
type LatLng = { lat: number; lng: number }
type LatLngArray = [number, number]
type Coords = LatLng | LatLngArray

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toLatLng(c: Coords): LatLng {
  return Array.isArray(c) ? { lat: c[0], lng: c[1] } : c
}

function formatCoord(lat: number, lng: number): string {
  return `${lng.toFixed(6)},${lat.toFixed(6)}`
}

// ---------------------------------------------------------------------------
// OSRM client
// ---------------------------------------------------------------------------

const OSRM_BASE_URL = process.env.OSRM_BASE_URL ?? "http://localhost:5000"

// Route cache with bounded size and TTL
const CACHE_MAX_SIZE = 1_000
const CACHE_TTL_MS = 5 * 60 * 1_000 // 5 minutes

type CacheEntry = {
  result: RouteResult
  cachedAt: number
}

const routeCache = new Map<string, CacheEntry>()

function cacheKey(origin: LatLng, dest: LatLng): string {
  return `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}-${dest.lat.toFixed(4)},${dest.lng.toFixed(4)}`
}

function getFromCache(key: string): RouteResult | null {
  const entry = routeCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    routeCache.delete(key)
    return null
  }
  return entry.result
}

function setCache(key: string, result: RouteResult): void {
  // Evict oldest entry if at capacity
  if (routeCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = routeCache.keys().next().value
    if (oldestKey) routeCache.delete(oldestKey)
  }
  routeCache.set(key, { result, cachedAt: Date.now() })
}

/**
 * Calculate a route using the OSRM API (driving profile).
 * Returns the route result or null if OSRM is unavailable.
 */
async function osrmRoute(
  origin: LatLng,
  destination: LatLng,
): Promise<RouteResult | null> {
  const key = cacheKey(origin, destination)

  const cached = getFromCache(key)
  if (cached) return cached

  try {
    const url =
      `${OSRM_BASE_URL}/route/v1/driving/` +
      `${formatCoord(origin.lat, origin.lng)};${formatCoord(destination.lat, destination.lng)}` +
      `?overview=full&geometries=geojson&steps=false&alternatives=false`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5_000)

    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (!res.ok) return null

    const data = (await res.json()) as {
      code: string
      routes?: Array<{
        distance: number
        duration: number
        geometry: {
          coordinates: [number, number][]
          type: string
        }
      }>
    }

    if (data.code !== "Ok" || !data.routes?.length) return null

    const route = data.routes[0]
    const result: RouteResult = {
      distanceKm: Math.round((route.distance / 1000) * 10) / 10,
      durationMin: Math.round(route.duration / 60),
      polyline: route.geometry.coordinates,
    }

    setCache(key, result)
    return result
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Haversine fallback
// ---------------------------------------------------------------------------

/**
 * Estimate travel time in minutes based on distance and average speed.
 * Default assumes 30 km/h urban average.
 */
export function estimateDuration(distanceKm: number, avgSpeedKmH = 30): number {
  if (distanceKm <= 0) return 0
  return (distanceKm / avgSpeedKmH) * 60
}

/**
 * Calculate a fallback route using Haversine straight-line distance.
 * Synchronous — no I/O needed.
 */
function haversineRoute(
  origin: LatLng,
  destination: LatLng,
): RouteResult {
  const distanceKm = haversineKm(origin.lat, origin.lng, destination.lat, destination.lng)
  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMin: Math.round(estimateDuration(distanceKm)),
    polyline: null,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a single route between origin and destination coordinates.
 *
 * Strategy:
 *   1. Try OSRM for real road-distance, duration, and polyline
 *   2. Fallback to Haversine straight-line (no polyline) if OSRM is down
 *
 * Accepts both `{ lat, lng }` objects and `[lat, lng]` arrays.
 */
export async function getRoute(
  origin: Coords,
  destination: Coords,
): Promise<RouteResult> {
  const o = toLatLng(origin)
  const d = toLatLng(destination)

  const osrmResult = await osrmRoute(o, d)
  if (osrmResult) return osrmResult

  return haversineRoute(o, d)
}

/**
 * Get multiple routes from a single origin to several destinations.
 * Results are returned in the same order as the destinations array.
 *
 * All OSRM requests are fired in parallel. Each destination that fails
 * falls back individually to Haversine, so a failure on one doesn't
 * affect the others.
 */
export async function getMultiRoute(
  origin: Coords,
  destinations: Coords[],
): Promise<RouteResult[]> {
  const o = toLatLng(origin)
  const dests = destinations.map((d) => toLatLng(d))

  // Fire all OSRM requests in parallel
  const osrmResults = await Promise.allSettled(
    dests.map((d) => osrmRoute(o, d)),
  )

  // Mix OSRM results with Haversine fallbacks, preserving order
  return osrmResults.map((result, idx) => {
    if (result.status === "fulfilled" && result.value) {
      return result.value
    }
    return haversineRoute(o, dests[idx])
  })
}

/**
 * Clear the in-memory OSRM route cache.
 * Useful after OSRM data is reloaded or for testing.
 */
export function clearRouteCache(): void {
  routeCache.clear()
}
