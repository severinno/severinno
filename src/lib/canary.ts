import { isEnabled } from "./feature-flags"

const CANARY_PERCENTAGE_KEY = "canary:percentage"
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
  if (!isEnabled(flag as any)) return false
  return isInCanary(userId)
}
