import { isEnabled, type FeatureFlag } from "./feature-flags"

const VALID_FLAGS: FeatureFlag[] = [
  "circuit-breaker-evolution", "circuit-breaker-push", "circuit-breaker-email",
  "circuit-breaker-lytex", "circuit-breaker-nominatim", "circuit-breaker-viacep",
  "circuit-breaker-osrm", "h3-clustering", "postgis-spatial-query",
  "redis-geo-index-seed", "wallet-serializable-tx", "geo-cache-local",
  "geo-metrics-async-persist", "geo-alert-redis-debounce", "dynamic-h3-resolution",
  "geocode-search-layered", "reverse-geocode-cache",
]

let canaryPercentage = 0

export function setCanaryPercentage(pct: number): void {
  canaryPercentage = Math.max(0, Math.min(100, pct))
}

export function getCanaryPercentage(): number {
  return canaryPercentage
}

export function isInCanary(userId: string): boolean {
  if (canaryPercentage === 0) return false
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 100 < canaryPercentage
}

export function canaryGate(userId: string, flag: string): boolean {
  if (!VALID_FLAGS.includes(flag as FeatureFlag)) return false
  if (!isEnabled(flag as FeatureFlag)) return false
  return isInCanary(userId)
}
