/**
 * emergency-matchmaking.ts — Real-Time Emergency Broadcast Matchmaking Engine
 *
 * Uber-style instant dispatch system for urgent services (plumbing leaks,
 * electrical outages, lockouts). Broadcasts to the nearest providers via
 * H3 spatial index + OSRM matrix, with a 45-second acceptance timer.
 *
 * Cost: $0 — Uses native WebSocket (already in project) + H3 + OSRM
 */

import { latLngToH3, h3GetKRing } from "@/lib/h3-grid"
import { calculate1xNDistanceMatrix, TargetDestination } from "@/lib/osrm-table"

export interface EmergencyRequest {
  id: string
  clientId: string
  clientName: string
  lat: number
  lng: number
  category: string
  description: string
  severity: "HIGH" | "EMERGENCY"
  maxRadiusKm: number
  surgeMultiplier?: number
}

export interface MatchCandidate {
  providerId: string
  providerName: string
  distanceKm: number
  etaMinutes: number
  rating: number
  matchScore: number
}

export interface EmergencyDispatchResult {
  requestId: string
  h3Cell: string
  h3KRingCells: string[]
  candidates: MatchCandidate[]
  broadcastCount: number
  acceptanceWindowSeconds: number
  surgeRate: number
  estimatedBaseFee: number
}

const ACCEPTANCE_WINDOW_SECONDS = 45
const SURGE_BASE_RATE = 1.15 // 15% urgency take rate
const MAX_BROADCAST_PROVIDERS = 5

/**
 * Finds the nearest available providers and prepares a broadcast dispatch
 */
export async function createEmergencyDispatch(
  request: EmergencyRequest,
  availableProviders: Array<{
    id: string
    name: string
    lat: number
    lng: number
    rating: number
    activeBookings: number
  }>,
): Promise<EmergencyDispatchResult> {
  // 1. Compute H3 cell and k-ring neighbors for spatial filtering
  const h3Cell = latLngToH3(request.lat, request.lng, 7)
  const h3KRingCells = h3GetKRing(h3Cell, 2) // ~3.6km radius coverage

  // 2. Pre-filter providers within max radius using Haversine
  const nearbyProviders = availableProviders.filter((p) => {
    const dlat = Math.abs(p.lat - request.lat)
    const dlng = Math.abs(p.lng - request.lng)
    // Quick degree-based pre-filter (~1 degree ≈ 111km)
    return dlat < request.maxRadiusKm / 111 && dlng < request.maxRadiusKm / 80
  })

  // 3. Calculate real ETA matrix via OSRM (single batch call)
  const destinations: TargetDestination[] = nearbyProviders.map((p) => ({
    id: p.id,
    lat: p.lat,
    lng: p.lng,
    name: p.name,
  }))

  const etaMatrix = await calculate1xNDistanceMatrix(
    { lat: request.lat, lng: request.lng },
    destinations,
  )

  // 4. Score and rank candidates
  const candidates: MatchCandidate[] = etaMatrix
    .map((eta) => {
      const provider = nearbyProviders.find((p) => p.id === eta.id)
      if (!provider || eta.distanceKm > request.maxRadiusKm) return null

      // Scoring: 40% proximity + 30% rating + 30% availability
      const proximityScore = Math.max(0, 1 - eta.distanceKm / request.maxRadiusKm) * 40
      const ratingScore = (provider.rating / 5) * 30
      const availabilityScore =
        provider.activeBookings === 0 ? 30 : Math.max(0, 30 - provider.activeBookings * 10)

      return {
        providerId: provider.id,
        providerName: provider.name,
        distanceKm: eta.distanceKm,
        etaMinutes: eta.durationMinutes,
        rating: provider.rating,
        matchScore: Number((proximityScore + ratingScore + availabilityScore).toFixed(1)),
      }
    })
    .filter((c): c is MatchCandidate => c !== null)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, MAX_BROADCAST_PROVIDERS)

  // 5. Calculate surge pricing
  const surgeRate = request.surgeMultiplier || SURGE_BASE_RATE
  const estimatedBaseFee = request.severity === "EMERGENCY" ? 80 : 50

  return {
    requestId: request.id,
    h3Cell,
    h3KRingCells,
    candidates,
    broadcastCount: candidates.length,
    acceptanceWindowSeconds: ACCEPTANCE_WINDOW_SECONDS,
    surgeRate,
    estimatedBaseFee: Number((estimatedBaseFee * surgeRate).toFixed(2)),
  }
}
