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
  /** Rush-hour fee surcharge multiplier (default: 1.25x during 07:30-09:30 and 17:30-19:30 weekdays) */
  rushHourMultiplier?: number
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
  isRushHour: boolean
  trafficMultiplier: number
}

const DEFAULT_POLICY: TravelFeePolicy = {
  freeKmThreshold: 5,
  pricePerKm: 2.5,
  minFee: 5,
  maxFee: 80,
  rushHourMultiplier: 1.25,
}

/**
 * Determines whether the given date/time falls within Brazilian urban rush hours:
 * - Morning peak: 07:30 to 09:30 (Monday to Friday)
 * - Evening peak: 17:30 to 19:30 (Monday to Friday)
 */
export function isRushHour(date: Date = new Date()): boolean {
  // Convert to Brasília time (UTC-3)
  const utc = date.getTime() + date.getTimezoneOffset() * 60000
  const brt = new Date(utc - 3 * 3600000)

  const day = brt.getDay() // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false

  const hour = brt.getHours()
  const min = brt.getMinutes()
  const timeInMins = hour * 60 + min

  const morningStart = 7 * 60 + 30 // 07:30
  const morningEnd = 9 * 60 + 30 // 09:30
  const eveningStart = 17 * 60 + 30 // 17:30
  const eveningEnd = 19 * 60 + 30 // 19:30

  return (
    (timeInMins >= morningStart && timeInMins <= morningEnd) ||
    (timeInMins >= eveningStart && timeInMins <= eveningEnd)
  )
}

/**
 * Calculate travel fee from a provider to a client address using real OSRM driving distance
 * and dynamic rush-hour traffic adjustments.
 *
 * Formula: max(minFee, min(maxFee, (distanceKm - freeKmThreshold) * pricePerKm * trafficMultiplier))
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
  const rushHour = isRushHour()
  const trafficMultiplier = rushHour ? (p.rushHourMultiplier ?? 1.25) : 1.0

  const billableKm = Math.max(0, route.distanceKm - p.freeKmThreshold)
  let fee = 0

  if (billableKm > 0) {
    fee = Math.round(billableKm * p.pricePerKm * trafficMultiplier * 100) / 100
    fee = Math.max(p.minFee, Math.min(p.maxFee, fee))
  }

  // If in rush hour, adjust duration estimation to reflect real-world congestion
  const durationMin = rushHour ? Math.round(route.durationMin * 1.35) : route.durationMin

  return {
    distanceKm: route.distanceKm,
    durationMin,
    freeKm: p.freeKmThreshold,
    billableKm: Math.round(billableKm * 10) / 10,
    pricePerKm: p.pricePerKm,
    travelFee: fee,
    formattedFee: fee > 0 ? formatBRL(fee) : "Grátis",
    routeSource: route.source,
    isRushHour: rushHour,
    trafficMultiplier,
  }
}
