import { calculateRouteAndEta, type RouteEtaResult } from "@/lib/osrm"
import { formatBRL } from "@/lib/format"

/**
 * Provider travel fee policy — configurable per-provider.
 * Defaults match Brazilian market standards.
 */
export type TravelFeePolicy = {
  /** Km threshold before charging (default: 5) */
  freeKmThreshold: number
  /** Price per additional km (default: R$ 2.50) */
  pricePerKm: number
  /** Minimum fee once threshold is crossed (default: R$ 5.00) */
  minFee: number
  /** Maximum fee cap (default: R$ 80.00) */
  maxFee: number
}

export type TravelFeeBreakdown = {
  distanceKm: number
  durationMin: number
  freeKm: number
  billableKm: number
  pricePerKm: number
  travelFee: number
  formattedFee: string
  routeSource: RouteEtaResult["source"]
}

const DEFAULT_POLICY: TravelFeePolicy = {
  freeKmThreshold: 5,
  pricePerKm: 2.5,
  minFee: 5,
  maxFee: 80,
}

/**
 * Calculate travel fee from a provider to a client address using real OSRM driving distance.
 *
 * Formula: max(minFee, min(maxFee, (distanceKm - freeKmThreshold) * pricePerKm))
 */
export async function calculateTravelFee(
  providerLat: number,
  providerLng: number,
  clientLat: number,
  clientLng: number,
  policy: Partial<TravelFeePolicy> = {},
): Promise<TravelFeeBreakdown> {
  const p: TravelFeePolicy = { ...DEFAULT_POLICY, ...policy }

  const route = await calculateRouteAndEta(providerLat, providerLng, clientLat, clientLng)

  const billableKm = Math.max(0, route.distanceKm - p.freeKmThreshold)
  let fee = 0

  if (billableKm > 0) {
    fee = Math.round(billableKm * p.pricePerKm * 100) / 100
    fee = Math.max(p.minFee, Math.min(p.maxFee, fee))
  }

  return {
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
    freeKm: p.freeKmThreshold,
    billableKm: Math.round(billableKm * 10) / 10,
    pricePerKm: p.pricePerKm,
    travelFee: fee,
    formattedFee: fee > 0 ? formatBRL(fee) : "Grátis",
    routeSource: route.source,
  }
}
