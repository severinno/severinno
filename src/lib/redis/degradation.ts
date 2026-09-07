/**
 * Degradation state — extracted to avoid circular deps.
 */

export let degradationCount = 0

export function setDegradationCount(v: number) {
  degradationCount = v
}

export function incrementDegradationCount() {
  degradationCount++
}
