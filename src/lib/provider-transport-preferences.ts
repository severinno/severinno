/**
 * provider-transport-preferences.ts — Provider travel mode preferences
 *
 * Persists provider locomotion preference (MOTO, CAR, BICYCLE) in Redis
 * to dynamically calibrate average city speed and urban detour factors.
 * Zero database migration drift.
 */

import { cacheGet, cacheSet } from "@/lib/redis"
import {
  type TransportMode,
  type TransportProfile,
  TRANSPORT_PROFILES,
} from "@/lib/tsp-route-optimizer"
import logger from "@/lib/logger"

const log = logger.child({ module: "provider-transport-preferences" })

const DEFAULT_MODE: TransportMode = "CAR"

export async function getProviderTransportMode(providerId: string): Promise<TransportMode> {
  const cached = await cacheGet<string>(`provider:transport_mode:${providerId}`)
  if (cached && (cached === "MOTO" || cached === "CAR" || cached === "BICYCLE")) {
    return cached as TransportMode
  }
  return DEFAULT_MODE
}

export async function setProviderTransportMode(
  providerId: string,
  mode: TransportMode,
): Promise<TransportProfile> {
  const profile = TRANSPORT_PROFILES[mode] || TRANSPORT_PROFILES.CAR
  // Store with 1 year TTL
  await cacheSet(`provider:transport_mode:${providerId}`, profile.mode, 365 * 24 * 60 * 60)
  log.info({ providerId, mode: profile.mode }, "Provider transport mode updated")
  return profile
}

export async function getProviderTransportProfile(providerId: string): Promise<TransportProfile> {
  const mode = await getProviderTransportMode(providerId)
  return TRANSPORT_PROFILES[mode]
}
