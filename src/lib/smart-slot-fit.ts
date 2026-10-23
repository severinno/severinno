/**
 * smart-slot-fit.ts — Intelligent Route Insertion & Schedule Slot Fitting
 *
 * Evaluates candidate appointments against a provider's daily schedule and route.
 * Calculates detour distance (in km and transit time) to recommend the "Encaixe Perfeito"
 * that minimizes travel cost and avoids tight scheduling conflicts.
 */

import { haversineKm } from "@/lib/geo"
import {
  optimizeDailyRoute2Opt,
  type RouteStop,
  type OptimizedRoutePlan,
  type TransportMode,
  type TransportProfile,
  TRANSPORT_PROFILES,
} from "@/lib/tsp-route-optimizer"

export type { RouteStop, OptimizedRoutePlan, TransportMode, TransportProfile }
export { TRANSPORT_PROFILES }

export interface CandidateStop {
  id?: string
  title: string
  address?: string
  lat: number
  lng: number
  durationMinutes?: number
}

export interface SlotEvaluation {
  slotIndex: number
  previousStopTitle?: string
  nextStopTitle?: string
  addedDetourKm: number
  addedTravelMinutes: number
  fitQuality: "PERFECT" | "GOOD" | "TIGHT"
}

export interface BestSlotFitResult {
  bestSlot: SlotEvaluation
  allEvaluations: SlotEvaluation[]
  optimizedRoute: OptimizedRoutePlan
}

/**
 * Evaluates the optimal slot to fit a new candidate appointment into existing stops
 */
export function evaluateBestSlotFit(
  baseLocation: { lat: number; lng: number },
  existingStops: RouteStop[],
  candidate: CandidateStop,
  transportMode: TransportMode = "CAR",
): BestSlotFitResult {
  const profile = TRANSPORT_PROFILES[transportMode] ?? TRANSPORT_PROFILES.CAR
  const roadFactor = profile.urbanRoadFactor
  const avgSpeed = profile.avgSpeedKmh

  const candidateStop: RouteStop = {
    id: candidate.id || `candidate-${Date.now()}`,
    title: candidate.title,
    address: candidate.address || "Local a confirmar",
    lat: candidate.lat,
    lng: candidate.lng,
  }

  // If no existing stops, inserting at index 0 is trivial
  if (existingStops.length === 0) {
    const directKm = Number(
      (
        haversineKm(baseLocation.lat, baseLocation.lng, candidate.lat, candidate.lng) * roadFactor
      ).toFixed(2),
    )
    const minutes = Math.round((directKm / avgSpeed) * 60)
    const singleSlot: SlotEvaluation = {
      slotIndex: 0,
      addedDetourKm: directKm,
      addedTravelMinutes: minutes,
      fitQuality: "PERFECT",
    }
    const plan = optimizeDailyRoute2Opt(baseLocation, [candidateStop], transportMode)
    return {
      bestSlot: singleSlot,
      allEvaluations: [singleSlot],
      optimizedRoute: plan,
    }
  }

  const allEvaluations: SlotEvaluation[] = []

  // Test inserting candidate at every position: 0 <= pos <= existingStops.length
  for (let pos = 0; pos <= existingStops.length; pos++) {
    let detourKm = 0

    if (pos === 0) {
      // Between base and stop 0
      const d1 = haversineKm(baseLocation.lat, baseLocation.lng, candidate.lat, candidate.lng)
      const d2 = haversineKm(
        candidate.lat,
        candidate.lng,
        existingStops[0].lat,
        existingStops[0].lng,
      )
      const original = haversineKm(
        baseLocation.lat,
        baseLocation.lng,
        existingStops[0].lat,
        existingStops[0].lng,
      )
      detourKm = (d1 + d2 - original) * roadFactor
    } else if (pos === existingStops.length) {
      // After last stop
      const last = existingStops[existingStops.length - 1]
      const extra = haversineKm(last.lat, last.lng, candidate.lat, candidate.lng)
      detourKm = extra * roadFactor
    } else {
      // Between stop pos-1 and stop pos
      const prev = existingStops[pos - 1]
      const next = existingStops[pos]
      const d1 = haversineKm(prev.lat, prev.lng, candidate.lat, candidate.lng)
      const d2 = haversineKm(candidate.lat, candidate.lng, next.lat, next.lng)
      const original = haversineKm(prev.lat, prev.lng, next.lat, next.lng)
      detourKm = (d1 + d2 - original) * roadFactor
    }

    const addedKm = Number(Math.max(0, detourKm).toFixed(2))
    const addedMinutes = Math.round((addedKm / avgSpeed) * 60)

    let fitQuality: "PERFECT" | "GOOD" | "TIGHT" = "GOOD"
    if (addedKm <= 3.0) {
      fitQuality = "PERFECT"
    } else if (addedKm > 7.0) {
      fitQuality = "TIGHT"
    }

    allEvaluations.push({
      slotIndex: pos,
      previousStopTitle: pos > 0 ? existingStops[pos - 1].title : "Ponto de Partida",
      nextStopTitle: pos < existingStops.length ? existingStops[pos].title : "Fim do Expediente",
      addedDetourKm: addedKm,
      addedTravelMinutes: addedMinutes,
      fitQuality,
    })
  }

  // Sort by lowest detour distance
  allEvaluations.sort((a, b) => a.addedDetourKm - b.addedDetourKm)
  const bestSlot = allEvaluations[0]

  // Complete optimized route with candidate included
  const allStops = [...existingStops, candidateStop]
  const optimizedRoute = optimizeDailyRoute2Opt(baseLocation, allStops, transportMode)

  return {
    bestSlot,
    allEvaluations,
    optimizedRoute,
  }
}
