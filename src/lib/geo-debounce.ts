/**
 * Geo Debounce — prevents redundant reverse geocode calls during tracking.
 *
 * When a provider's position updates every few seconds, reverse geocoding
 * every update is wasteful (Nominatim: 1 req/s, DB queries: ~50ms each).
 *
 * This module debounces reverse geocode calls:
 *   - Same coordinates within 30s → reuse cached result
 *   - Different coordinates → debounce 30s, then geocode once
 *   - Significant move (> 100m) → immediate geocode
 */
import { cacheSet } from "./redis"
import { haversineKm } from "./geo-shared"

const DEBOUNCE_MS = 30_000 // 30s debounce
const SIGNIFICANT_MOVE_METERS = 100 // immediate geocode if moved > 100m
const CACHE_TTL_S = 300 // 5min cache for debounced results

interface DebounceEntry {
  lastGeocodeAt: number
  lastLat: number
  lastLng: number
  lastResult: string | null
}

const debounceStore = new Map<string, DebounceEntry>()

export type DebouncedGeocodeResult = {
  displayName: string | null
  cached: boolean
  source: "cache" | "debounced" | "fresh"
}

/**
 * Debounced reverse geocode for tracking updates.
 *
 * Returns cached result if:
 *   - Same coordinates (within ~110m) and last geocode was < 30s ago
 *   - Different coordinates but < 30s since last geocode (debounced)
 *
 * Returns fresh result if:
 *   - Significant move (> 100m) — immediate geocode
 *   - First call for this provider
 *   - Debounce window expired
 */
export async function debouncedReverseGeocode(
  providerId: string,
  lat: number,
  lng: number,
  geocodeFn: (lat: number, lng: number) => Promise<string>,
): Promise<DebouncedGeocodeResult> {
  const now = Date.now()
  const entry = debounceStore.get(providerId)

  if (entry) {
    const distanceMeters = Math.round(haversineKm(lat, lng, entry.lastLat, entry.lastLng) * 1000)
    const timeSinceLastGeocode = now - entry.lastGeocodeAt

    // Same location (within 110m) and recent geocode → reuse
    if (distanceMeters < 110 && timeSinceLastGeocode < DEBOUNCE_MS && entry.lastResult) {
      return { displayName: entry.lastResult, cached: true, source: "cache" }
    }

    // Different location but within debounce window → wait
    if (distanceMeters >= 110 && timeSinceLastGeocode < DEBOUNCE_MS) {
      // Significant move but within debounce — check if we can skip
      if (distanceMeters < SIGNIFICANT_MOVE_METERS) {
        return { displayName: entry.lastResult, cached: true, source: "debounced" }
      }
      // Significant move (> 100m) — geocode immediately
    }

    // Debounce expired or significant move — geocode fresh
    if (timeSinceLastGeocode >= DEBOUNCE_MS || distanceMeters >= SIGNIFICANT_MOVE_METERS) {
      try {
        const result = await geocodeFn(lat, lng)
        debounceStore.set(providerId, {
          lastGeocodeAt: now,
          lastLat: lat,
          lastLng: lng,
          lastResult: result,
        })
        // Cache in Redis for cross-restart persistence
        try {
          await cacheSet(`geo:debounce:${providerId}`, {
            lat, lng, result, at: now,
          }, CACHE_TTL_S)
        } catch { /* */ }
        return { displayName: result, cached: false, source: "fresh" }
      } catch {
        return { displayName: entry.lastResult, cached: true, source: "debounced" }
      }
    }
  }

  // First call — geocode fresh
  try {
    const result = await geocodeFn(lat, lng)
    debounceStore.set(providerId, {
      lastGeocodeAt: now,
      lastLat: lat,
      lastLng: lng,
      lastResult: result,
    })
    try {
      await cacheSet(`geo:debounce:${providerId}`, {
        lat, lng, result, at: now,
      }, CACHE_TTL_S)
    } catch { /* */ }
    return { displayName: result, cached: false, source: "fresh" }
  } catch {
    return { displayName: null, cached: false, source: "fresh" }
  }
}

/**
 * Get debounce stats for monitoring.
 */
export function getDebounceStats(): {
  activeProviders: number
  avgAgeSeconds: number
} {
  const now = Date.now()
  let totalAge = 0
  for (const entry of debounceStore.values()) {
    totalAge += now - entry.lastGeocodeAt
  }
  return {
    activeProviders: debounceStore.size,
    avgAgeSeconds: debounceStore.size > 0
      ? Math.round(totalAge / debounceStore.size / 1000)
      : 0,
  }
}
