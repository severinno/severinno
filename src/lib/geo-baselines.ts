/**
 * geo-baselines.ts
 *
 * P95 Baseline thresholds for geo services, configurable via environment
 * variables with fallback to hardcoded defaults.
 *
 * Usage:
 *   import { P95_BASELINE_MS } from "@/lib/geo-baselines"
 *   const baseline = P95_BASELINE_MS["nominatim"] // 400ms by default
 *
 * Environment variables (set in .env or .env.local):
 *   GEO_P95_BASELINE_NOMINATIM  — Nominatim P95 threshold in ms (default: 400)
 *   GEO_P95_BASELINE_VIACEP     — ViaCEP P95 threshold in ms   (default: 250)
 *   GEO_P95_BASELINE_POSTGIS    — PostGIS P95 threshold in ms  (default: 30)
 *
 * The 2× baseline value is used as the visual alert threshold on the
 * geo-metrics admin dashboard.
 */

export const P95_BASELINE_MS: Record<string, number> = {
  nominatim: Number(process.env.GEO_P95_BASELINE_NOMINATIM) || 400,
  viacep: Number(process.env.GEO_P95_BASELINE_VIACEP) || 250,
  postgis: Number(process.env.GEO_P95_BASELINE_POSTGIS) || 30,
}

/**
 * Returns a serializable copy of the baseline config for inclusion in
 * API responses, so client components can access the values without
 * needing NEXT_PUBLIC_ env vars.
 */
export function getP95Baselines(): Record<string, number> {
  return { ...P95_BASELINE_MS }
}
