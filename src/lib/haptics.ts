/**
 * Severinno Marketplace SaaS — Mobile Haptic Feedback Helper
 *
 * Provides safe, non-intrusive tactile feedback on supported mobile devices
 * using the Web Vibration API (navigator.vibrate).
 *
 * Fully SSR-safe and gracefully degrades to a no-op on desktop or unsupported devices.
 */

export type HapticFeedbackType =
  "light" | "medium" | "heavy" | "success" | "warning" | "error" | "selection"

const HAPTIC_PATTERNS: Record<HapticFeedbackType, number | number[]> = {
  light: 10,
  medium: 25,
  heavy: 50,
  selection: 8,
  success: [15, 40, 15],
  warning: [30, 50, 30],
  error: [50, 50, 50, 50, 100],
}

/**
 * Checks whether the Web Vibration API is supported in the current environment.
 */
export function isHapticSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false
  }
  return typeof navigator.vibrate === "function"
}

/**
 * Triggers a haptic feedback pattern on the user device if supported.
 * Returns true if the vibration was successfully initiated, false otherwise.
 */
export function triggerHaptic(type: HapticFeedbackType = "light"): boolean {
  if (!isHapticSupported()) {
    return false
  }

  try {
    const pattern = HAPTIC_PATTERNS[type] ?? 10
    return navigator.vibrate(pattern)
  } catch {
    // Graceful swallow of permission / hardware errors
    return false
  }
}

/**
 * Cancels any ongoing haptic vibration.
 */
export function cancelHaptic(): boolean {
  if (!isHapticSupported()) {
    return false
  }

  try {
    return navigator.vibrate(0)
  } catch {
    return false
  }
}
