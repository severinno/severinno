/**
 * geo-observability.ts — Lightweight production metrics for geofencing & timezone.
 *
 * Tracks counters and rates without external dependencies.
 * Exposes a snapshot API for admin dashboard consumption.
 */

import logger from "@/lib/logger"

// ── Geofencing metrics ─────────────────────────────────────────────────────

type GeofenceMetrics = {
  enterEvents: number
  exitEvents: number
  whatsappSent: number
  whatsappFailed: number
  lockContentions: number
  engineErrors: number
  osrmFallbackTriggers: number
}

const geofenceMetrics: GeofenceMetrics = {
  enterEvents: 0,
  exitEvents: 0,
  whatsappSent: 0,
  whatsappFailed: 0,
  lockContentions: 0,
  engineErrors: 0,
  osrmFallbackTriggers: 0,
}

// ── Timezone metrics ───────────────────────────────────────────────────────

type TimezoneMetrics = {
  lookups: number
  fallbackToBrasilia: number
  byTimezone: Record<string, number>
}

const timezoneMetrics: TimezoneMetrics = {
  lookups: 0,
  fallbackToBrasilia: 0,
  byTimezone: {},
}

// ── API ────────────────────────────────────────────────────────────────────

export function recordGeofenceEnter(): void {
  geofenceMetrics.enterEvents++
}

export function recordGeofenceExit(): void {
  geofenceMetrics.exitEvents++
}

export function recordGeofenceWhatsApp(sent: boolean): void {
  if (sent) {
    geofenceMetrics.whatsappSent++
  } else {
    geofenceMetrics.whatsappFailed++
  }
}

export function recordGeofenceLockContention(): void {
  geofenceMetrics.lockContentions++
}

export function recordGeofenceError(): void {
  geofenceMetrics.engineErrors++
}

export function recordOsrmFallback(): void {
  geofenceMetrics.osrmFallbackTriggers++
}

export function recordTimezoneLookup(timezone: string, isFallback: boolean): void {
  timezoneMetrics.lookups++
  if (isFallback) {
    timezoneMetrics.fallbackToBrasilia++
  }
  timezoneMetrics.byTimezone[timezone] = (timezoneMetrics.byTimezone[timezone] ?? 0) + 1
}

/**
 * Get a snapshot of all metrics (for admin dashboard / health endpoint).
 * Returns a frozen copy so callers can't mutate internal state.
 */
export function getGeoMetricsSnapshot(): {
  geofencing: GeofenceMetrics
  timezone: TimezoneMetrics
  uptime: number
} {
  return {
    geofencing: { ...geofenceMetrics },
    timezone: {
      ...timezoneMetrics,
      byTimezone: { ...timezoneMetrics.byTimezone },
    },
    uptime: process.uptime(),
  }
}

/**
 * Log metrics summary (called periodically or on shutdown).
 */
export function logGeoMetricsSummary(): void {
  logger.info(
    {
      geofencing: geofenceMetrics,
      timezone: {
        lookups: timezoneMetrics.lookups,
        fallbackRate:
          timezoneMetrics.lookups > 0
            ? `${((timezoneMetrics.fallbackToBrasilia / timezoneMetrics.lookups) * 100).toFixed(1)}%`
            : "0%",
        topTimezones: Object.entries(timezoneMetrics.byTimezone)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5),
      },
    },
    "geo-observability: metrics snapshot",
  )
}
