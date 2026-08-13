/**
 * use-auto-cache-sweep.ts
 *
 * React hook that runs a background sweep of expired localStorage cache
 * entries (CEP + geo search) so stale data doesn't accumulate silently.
 *
 * Triggers:
 *   1. setInterval every SWEEP_INTERVAL_MS (10 minutes)
 *   2. document.visibilitychange — sweeps immediately when the tab becomes
 *      visible again (the user may have been away for hours)
 *
 * The sweep is idempotent and runs safely even in private browsing mode
 * (localStorage may throw, both sweep functions handle that internally).
 *
 * Usage:
 *   // In the AddressAutocomplete component or a top-level layout:
 *   useAutoCacheSweep()
 *
 * Returns the last sweep result for debugging / admin panels:
 *   const { cepRemoved, geoRemoved } = useAutoCacheSweep()
 */

import * as React from "react"
import { sweepCepCache } from "@/lib/client-cep-cache"
import { sweepGeoCache } from "@/lib/client-geo-cache"
import { attemptCacheWarming } from "@/lib/client-geo-cache-warm"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sweep interval: 10 minutes */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000

/** Minimum time between sweeps to prevent thrashing (e.g., rapid tab switches) */
const MIN_SWEEP_INTERVAL_MS = 5_000

// ---------------------------------------------------------------------------
// State tracking
// ---------------------------------------------------------------------------

/**
 * Tracks when the last sweep happened so we can debounce rapid visibility
 * changes (e.g., user toggling tabs repeatedly).
 */
let lastSweepAt = 0

// ---------------------------------------------------------------------------
// Core sweep runner
// ---------------------------------------------------------------------------

export type SweepResult = {
  cepRemoved: number
  geoRemoved: number
  geoRenewed?: number
  cepRenewed?: number
  warmingSkipped?: boolean
  timestamp: number
}

function runSweep(): SweepResult {
  const now = Date.now()
  if (now - lastSweepAt < MIN_SWEEP_INTERVAL_MS) {
    return { cepRemoved: 0, geoRemoved: 0, timestamp: lastSweepAt }
  }

  lastSweepAt = now

  // 1. Sweep expired entries
  const cepRemoved = sweepCepCache()
  const geoRemoved = sweepGeoCache()

  // 2. Attempt cache warming (only runs during 3-5 AM, once daily)
  const warmResult = attemptCacheWarming()

  return {
    cepRemoved,
    geoRemoved,
    geoRenewed: warmResult.geoRenewed,
    cepRenewed: warmResult.cepRenewed,
    warmingSkipped: warmResult.skipped,
    timestamp: now,
  }
}

// ---------------------------------------------------------------------------
// Singleton interval management
// ---------------------------------------------------------------------------

let _intervalId: ReturnType<typeof setInterval> | null = null
let _hookCount = 0

function startInterval(onSweep: (result: SweepResult) => void): void {
  if (_intervalId != null) return // already running from another mount
  _intervalId = setInterval(() => {
    const result = runSweep()
    onSweep(result)
  }, SWEEP_INTERVAL_MS)
}

function stopInterval(): void {
  if (_intervalId != null) {
    clearInterval(_intervalId)
    _intervalId = null
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Registers an automatic cache sweep that fires every 10 minutes and on
 * visibility change. The interval is shared across all callers (singleton
 * pattern) to avoid multiple timers when the hook is used in several
 * components.
 *
 * @returns The last sweep result — can be used for debugging or admin panels.
 */
export function useAutoCacheSweep(): SweepResult | null {
  const [lastResult, setLastResult] = React.useState<SweepResult | null>(null)

  React.useEffect(() => {
    _hookCount++

    // Run an initial sweep on mount (catches stale entries from previous sessions)
    // Note: we don't setState here to avoid cascading renders per react-hooks rule.
    // The first interval tick (10min) will report the result.
    runSweep()

    // Start the shared interval
    startInterval(setLastResult)

    // Listen for visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const result = runSweep()
        setLastResult(result)
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      _hookCount--
      document.removeEventListener("visibilitychange", handleVisibilityChange)

      if (_hookCount <= 0) {
        stopInterval()
        _hookCount = 0
      }
    }
  }, [])

  return lastResult
}

// ---------------------------------------------------------------------------
// Imperative API (for non-React contexts or admin panels)
// ---------------------------------------------------------------------------

/**
 * Manually trigger an immediate sweep of both caches.
 * Guards against re-entry within MIN_SWEEP_INTERVAL_MS (5s).
 */
export function triggerSweep(): SweepResult {
  return runSweep()
}

/**
 * Get the singleton timer's remaining MS until the next automatic sweep,
 * or null if the timer is not running.
 */
export function getTimeToNextSweep(): number | null {
  if (_intervalId == null) return null
  // Approximate: we don't track the exact start, but the interval fires
  // every SWEEP_INTERVAL_MS, so remaining is at most SWEEP_INTERVAL_MS.
  return SWEEP_INTERVAL_MS - ((Date.now() - lastSweepAt) % SWEEP_INTERVAL_MS)
}
