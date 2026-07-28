"use client"

/**
 * Reusable hooks for the coin sound effect.
 *
 * - `useCoinSound()` — returns a `play()` function that respects the user's
 *   `soundEnabled` preference from the auth store.
 * - `useTransactionNotificationSound(items, role)` — watches a notification
 *   list and auto-plays the coin sound when a new transaction-related
 *   notification (BOOKING_CONFIRMED, BOOKING_COMPLETED, QUOTE_APPROVED)
 *   appears for non-ADMIN users.
 */

import * as React from "react"

import {
  playCoinSound,
  playCompletionSound,
  playReviewSound,
  playErrorSound,
  playWelcomeSound,
} from "@/lib/sounds"
import {
  useSoundEnabledPreference,
  useVibrateEnabledPreference,
} from "@/lib/sound-context"

// ---------------------------------------------------------------------------
// Notification types that can trigger sounds
// ---------------------------------------------------------------------------

/** Transaction-related — signal new revenue / booking. */
const TX_NOTIF_TYPES = new Set([
  "BOOKING_CONFIRMED",
  "BOOKING_COMPLETED",
  "QUOTE_APPROVED",
] as const)

/** Review-related — new rating received. */
const REVIEW_NOTIF_TYPES = new Set([
  "REVIEW_RECEIVED",
] as const)

/** Error-related — transaction cancelled / rejected / failed. */
const ERROR_NOTIF_TYPES = new Set([
  "BOOKING_CANCELLED",
] as const)

// ---------------------------------------------------------------------------
// useCoinSound — preference-aware sound player
// ---------------------------------------------------------------------------

/**
 * Returns four play functions that respect the user's `soundEnabled`
 * preference:
 *
 * - `playCoin()`       — standard ascending two-tone (C5 → E5) coin sound.
 * - `playCompletion()` — softer single-tone chime for completion events.
 * - `playReview()`     — bright ascending arpeggio (C5 → E5 → G5) for reviews.
 * - `playError()`      — descending minor two-tone (E5 → C5) for failures.
 */
export function useCoinSound() {
  const soundEnabled = useSoundEnabledPreference()
  const vibrateEnabled = useVibrateEnabledPreference()

  const vibrate = vibrateEnabled !== false // default to true if undefined

  const playCoin = React.useCallback(() => {
    if (soundEnabled === false) return
    playCoinSound({ vibrate })
  }, [soundEnabled, vibrate])

  const playCompletion = React.useCallback(() => {
    if (soundEnabled === false) return
    playCompletionSound({ vibrate })
  }, [soundEnabled, vibrate])

  const playReview = React.useCallback(() => {
    if (soundEnabled === false) return
    playReviewSound({ vibrate })
  }, [soundEnabled, vibrate])

  const playError = React.useCallback(() => {
    if (soundEnabled === false) return
    playErrorSound({ vibrate })
  }, [soundEnabled, vibrate])

  return { playCoin, playCompletion, playReview, playError, soundEnabled }
}

// ---------------------------------------------------------------------------
// useTransactionNotificationSound — automatic detection
// ---------------------------------------------------------------------------

/**
 * Pick the appropriate sound for a notification type + user role.
 *
 * - `BOOKING_COMPLETED` + CLIENT → gentle completion chime
 * - `REVIEW_RECEIVED`             → star sparkle (provider only)
 * - All other transaction notifs  → coin sound
 */
function pickSound(
  notifType: string,
  userRole: string | null | undefined,
  playCoin: () => void,
  playCompletion: () => void,
  playReview: () => void,
  playError: () => void,
): void {
  if (ERROR_NOTIF_TYPES.has(notifType as typeof ERROR_NOTIF_TYPES extends Set<infer T> ? T : string)) {
    playError()
  } else if (notifType === "BOOKING_COMPLETED" && userRole === "CLIENT") {
    playCompletion()
  } else if (notifType === "REVIEW_RECEIVED") {
    playReview()
  } else {
    playCoin()
  }
}

/**
 * Walk a notification list and fire the appropriate sound when a genuinely
 * new notification of a recognised type arrives.
 *
 * @param items    Current list of notifications (from useQuery).
 * @param userRole Current user's role (e.g. "CLIENT" | "PROVIDER" | "ADMIN").
 *                 ADMIN is always silenced (too many notifications).
 *
 * The hook tracks previously-seen notification IDs via a ref.  On the very
 * first call it populates the ref silently — no false sound.  On subsequent
 * calls it compares IDs and fires `pickSound` once per batch.
 */
export function useTransactionNotificationSound(
  items: Array<{ id: string; type: string }>,
  userRole?: string | null,
): void {
  const { playCoin, playCompletion, playReview, playError } = useCoinSound()
  const prevIdsRef = React.useRef<Set<string> | null>(null)

  React.useEffect(() => {
    if (userRole === "ADMIN") {
      prevIdsRef.current = null
      return
    }
    if (items.length === 0) return

    // First load after mount or role switch: seed silently, no sound.
    if (prevIdsRef.current === null) {
      prevIdsRef.current = new Set(items.map((n) => n.id))
      return
    }

    const allTypes = new Set([...TX_NOTIF_TYPES, ...REVIEW_NOTIF_TYPES, ...ERROR_NOTIF_TYPES])
    const prevIds = prevIdsRef.current
    for (const n of items) {
      if (!prevIds.has(n.id) && allTypes.has(n.type as unknown as typeof TX_NOTIF_TYPES extends Set<infer T> ? T : never)) {
        pickSound(n.type, userRole, playCoin, playCompletion, playReview, playError)
        break // one sound per batch is enough
      }
    }

    prevIdsRef.current = new Set(items.map((n) => n.id))
  }, [items, userRole, playCoin, playCompletion, playReview, playError])
}

// ---------------------------------------------------------------------------
// useWelcomeSound — one-time welcome sound on first panel entry
// ---------------------------------------------------------------------------

const WELCOME_LS_KEY = "severinno_welcome_played"

/**
 * Check if the welcome sound has been played before (stored in localStorage).
 */
function hasWelcomeBeenPlayed(): boolean {
  try {
    return localStorage.getItem(WELCOME_LS_KEY) === "true"
  } catch {
    // localStorage may be blocked in some environments
    return true // treat as played to avoid infinite retries
  }
}

/**
 * Mark the welcome sound as played in localStorage.
 */
function markWelcomePlayed(): void {
  try {
    localStorage.setItem(WELCOME_LS_KEY, "true")
  } catch {
    // Silently ignore
  }
}

/**
 * `useWelcomeSound` — plays a cheerful welcome sound exactly once, the first
 * time the user visits their dashboard panel.
 *
 * Uses `localStorage` to persist the "already played" flag, so it won't
 * replay on subsequent visits, page refreshes, or in new tabs.
 *
 * The sound respects the user's `soundEnabled` preference.
 *
 * @example
 * ```tsx
 * // In DashboardShell or any panel wrapper:
 * useWelcomeSound()
 * ```
 */
export function useWelcomeSound(): void {
  const soundEnabled = useSoundEnabledPreference()
  const vibrateEnabled = useVibrateEnabledPreference()
  const playedRef = React.useRef(false)

  const vibrate = vibrateEnabled !== false

  React.useEffect(() => {
    // Guard: already played this session or in a previous visit
    if (playedRef.current) return
    if (hasWelcomeBeenPlayed()) return

    // Mark as played immediately to prevent double-play in StrictMode
    playedRef.current = true
    markWelcomePlayed()

    // Small delay so the sound doesn't clash with initial page render
    const timer = setTimeout(() => {
      if (soundEnabled === false) return
      playWelcomeSound({ vibrate })
    }, 600)

    return () => clearTimeout(timer)
  }, [soundEnabled, vibrate])
}

/**
 * `resetWelcomeSound` — clears the localStorage flag so the welcome sound
 * will play again. Useful for testing.
 */
export function resetWelcomeSound(): void {
  try {
    localStorage.removeItem(WELCOME_LS_KEY)
  } catch {
    // Silently ignore
  }
}
