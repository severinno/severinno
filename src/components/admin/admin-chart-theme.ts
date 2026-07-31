/**
 * admin-chart-theme.ts
 *
 * Shared chart theming constants for admin dashboards.
 *
 * Centralizes values previously duplicated across ~16 admin components/pages:
 *   - COLOR_P50 / COLOR_P95 / COLOR_P99 — latency severity palette
 *   - TOOLTIP_STYLE — Recharts tooltip contentStyle (CSS-var aware)
 *
 * Import from the leaf file directly (./admin-chart-theme) — do NOT add to
 * the barrel; these are internal theming values.
 */
import type { CSSProperties } from "react"

// ── Latency severity palette ─────────────────────────────────────────────
// Same scale used by latencyColor(): < 200ms → green, 200ms–1s → amber,
// > 1s → red.
export const COLOR_P50 = "hsl(160, 84%, 39%)"
export const COLOR_P95 = "hsl(38, 92%, 50%)"
export const COLOR_P99 = "hsl(0, 72%, 51%)"

// ── Recharts tooltip contentStyle ────────────────────────────────────────
export const TOOLTIP_STYLE: CSSProperties = {
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.1)",
  padding: "8px 10px",
}
