"use client"

/**
 * GeoLatencyBar — colored latency percentile bar
 *
 * Displays a horizontal bar showing a percentile value (P50/P95/P99)
 * relative to the maximum, with color-coded severity.
 *
 * Extracted from admin-geo-metrics-dashboard.tsx for reusability.
 */

import { COLOR_P50, COLOR_P95, COLOR_P99 } from "./admin-chart-theme"

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Color for a latency value (ms).
 *   < 200ms  → green  (P50)
 *   200-1s   → amber  (P95)
 *   > 1s     → red    (P99)
 */
export function latencyColor(ms: number): string {
  if (ms > 1000) return COLOR_P99
  if (ms > 200) return COLOR_P95
  return COLOR_P50
}

/**
 * Format a millisecond value for display.
 */
export function formatMs(ms: number): string {
  return ms < 1 ? "<1ms" : `${Math.round(ms)}ms`
}

// ── Props ────────────────────────────────────────────────────────────────

export type LatencyBarProps = {
  label: string
  value: number
  max: number
}

// ── Component ────────────────────────────────────────────────────────────

export function LatencyBar({ label, value, max }: LatencyBarProps) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground w-8 text-right text-xs font-medium">{label}</span>
      <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            backgroundColor: latencyColor(value),
          }}
        />
      </div>
      <span
        className="w-14 text-right text-xs font-medium tabular-nums"
        style={{ color: latencyColor(value) }}
      >
        {formatMs(value)}
      </span>
    </div>
  )
}
