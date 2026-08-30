/**
 * feature-flags.ts
 *
 * Simple feature flag system backed by environment variables.
 *
 * Supports:
 *   - Static flags via env vars (FEATURE_FLAG_*)
 *   - Runtime overrides (useful for admin toggles without deploy)
 *   - Percentage rollouts (for gradual feature releases)
 *
 * Usage:
 *   import { isEnabled } from "@/lib/feature-flags"
 *
 *   if (isEnabled("circuit-breaker-evolution")) {
 *     // new behavior
 *   } else {
 *     // old behavior
 *   }
 *
 * Env format:
 *   FEATURE_FLAGS=circuit-breaker-evolution,cache-warm-v2
 *   FEATURE_FLAGS_DISABLED=legacy-search
 *   FEATURE_FLAGS_ROLLOUT=new-ui=50   (50% of requests)
 */

// ── Flag registry ──────────────────────────────────────────────────────────

export type FeatureFlag =
  | "circuit-breaker-evolution"
  | "circuit-breaker-push"
  | "circuit-breaker-email"
  | "circuit-breaker-lytex"
  | "h3-clustering"
  | "postgis-spatial-query"
  | "redis-geo-index-seed"
  | "wallet-serializable-tx"
  | "geo-cache-local"
  | "geo-metrics-async-persist"
  | "geo-alert-redis-debounce"
  | "dynamic-h3-resolution"
  | "geocode-search-layered"
  | "reverse-geocode-cache"

const DEFAULT_FLAGS: Record<FeatureFlag, boolean> = {
  "circuit-breaker-evolution": true,
  "circuit-breaker-push": true,
  "circuit-breaker-email": true,
  "circuit-breaker-lytex": true,
  "h3-clustering": true,
  "postgis-spatial-query": true,
  "redis-geo-index-seed": true,
  "wallet-serializable-tx": true,
  "geo-cache-local": true,
  "geo-metrics-async-persist": true,
  "geo-alert-redis-debounce": true,
  "dynamic-h3-resolution": true,
  "geocode-search-layered": true,
  "reverse-geocode-cache": true,
}

// ── Env parsing (cached, computed once at module init) ──────────────────────

function parseEnvFlags(): { enabled: Set<string>; disabled: Set<string>; rollouts: Map<string, number> } {
  const enabled = new Set(
    (process.env.FEATURE_FLAGS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )

  const disabled = new Set(
    (process.env.FEATURE_FLAGS_DISABLED ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )

  const rollouts = new Map<string, number>()
  for (const entry of (process.env.FEATURE_FLAGS_ROLLOUT ?? "").split(",")) {
    const [name, pct] = entry.split("=")
    if (name && pct) {
      const num = Number(pct)
      if (Number.isFinite(num) && num >= 0 && num <= 100) {
        rollouts.set(name.trim(), num)
      }
    }
  }

  return { enabled, disabled, rollouts }
}

const envFlags = parseEnvFlags()

// ── Runtime overrides (for admin toggles) ──────────────────────────────────

const runtimeOverrides = new Map<string, boolean>()

export function setFlag(flag: FeatureFlag, value: boolean): void {
  runtimeOverrides.set(flag, value)
}

export function clearFlag(flag: FeatureFlag): void {
  runtimeOverrides.delete(flag)
}

// ── Core check ─────────────────────────────────────────────────────────────

/**
 * Check if a feature flag is enabled.
 *
 * Priority order:
 *   1. Runtime override (highest)
 *   2. FEATURE_FLAGS env (explicit enable)
 *   3. FEATURE_FLAGS_DISABLED env (explicit disable)
 *   4. FEATURE_FLAGS_ROLLOUT (percentage-based)
 *   5. DEFAULT_FLAGS (default value)
 */
export function isEnabled(flag: FeatureFlag): boolean {
  // 1. Runtime override
  if (runtimeOverrides.has(flag)) {
    return runtimeOverrides.get(flag)!
  }

  // 2. Explicit enable
  if (envFlags.enabled.has(flag)) return true

  // 3. Explicit disable
  if (envFlags.disabled.has(flag)) return false

  // 4. Percentage rollout
  const rolloutPct = envFlags.rollouts.get(flag)
  if (rolloutPct !== undefined) {
    // Deterministic: hash the flag name to get a consistent decision per request
    // Using a simple hash so the same flag always gives the same result
    // within the same process (but varies between processes for true randomness)
    const hash = simpleHash(flag + process.pid)
    return hash % 100 < rolloutPct
  }

  // 5. Default
  return DEFAULT_FLAGS[flag] ?? false
}

/**
 * Get all flags and their current state (for admin dashboard).
 */
export function getAllFlags(): Record<string, { enabled: boolean; source: string }> {
  const result: Record<string, { enabled: boolean; source: string }> = {}

  for (const [flag, defaultValue] of Object.entries(DEFAULT_FLAGS)) {
    if (runtimeOverrides.has(flag)) {
      result[flag] = { enabled: runtimeOverrides.get(flag)!, source: "runtime" }
    } else if (envFlags.enabled.has(flag)) {
      result[flag] = { enabled: true, source: "env-enabled" }
    } else if (envFlags.disabled.has(flag)) {
      result[flag] = { enabled: false, source: "env-disabled" }
    } else if (envFlags.rollouts.has(flag)) {
      result[flag] = { enabled: isEnabled(flag as FeatureFlag), source: `rollout-${envFlags.rollouts.get(flag)}%` }
    } else {
      result[flag] = { enabled: defaultValue, source: "default" }
    }
  }

  return result
}

// ── Helpers ────────────────────────────────────────────────────────────────

function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}
