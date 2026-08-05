"use client"

/**
 * SoundContext — React Context to provide `soundEnabled` and `vibrateEnabled`
 * overrides anywhere in the component tree.
 *
 * The Context acts as an **override**: if a parent `<SoundProvider>` wraps a
 * subtree with explicit values, hooks inside that subtree will use those
 * overrides regardless of the auth store preference.
 *
 * Usage:
 *
 * ```tsx
 * // Sound off + vibrate on (override sound, keep vibrate from auth store)
 * <SoundProvider soundEnabled={false}>
 *   <MySection />
 * </SoundProvider>
 *
 * // Both off (legacy prop shorthand)
 * <SoundProvider enabled={false}>
 *   <VitrineSection />
 * </SoundProvider>
 *
 * // Vibrate off globally
 * <SoundProvider vibrateEnabled={false}>
 *   <App />
 * </SoundProvider>
 * ```
 */

import * as React from "react"

import { useAuthStore } from "@/store/auth"

type SoundContextValue = {
  /** Override for sound playback. `undefined` = use auth store default. */
  soundEnabled?: boolean
  /** Override for vibration. `undefined` = use auth store default. */
  vibrateEnabled?: boolean
}

const SoundContext = React.createContext<SoundContextValue | undefined>(undefined)

/**
 * Get the current `soundEnabled` override from the nearest SoundProvider.
 *
 * Returns:
 * - `true` / `false` if explicitly set by a parent `<SoundProvider>`
 * - `undefined` if no SoundProvider is found (caller should fall back to
 *   the auth store preference)
 */
export function useSoundEnabled(): boolean | undefined {
  return React.useContext(SoundContext)?.soundEnabled
}

/**
 * Get the current `vibrateEnabled` override from the nearest SoundProvider.
 *
 * Returns:
 * - `true` / `false` if explicitly set
 * - `undefined` if no SoundProvider is found (caller should fall back to
 *   the auth store preference)
 */
export function useVibrateEnabled(): boolean | undefined {
  return React.useContext(SoundContext)?.vibrateEnabled
}

/**
 * SoundProvider — sets `soundEnabled` and/or `vibrateEnabled` overrides
 * for all descendant components. When a prop is omitted (default `undefined`),
 * descendants that call the respective hook will fall back to the auth store
 * preference.
 *
 * **Legacy `enabled` prop:** sets both `soundEnabled` and `vibrateEnabled`
 * at once (backwards-compatible with `<SoundProvider enabled={false}>`).
 *
 * Nesting multiple providers works as expected: the nearest ancestor wins.
 */
export function SoundProvider({
  soundEnabled,
  vibrateEnabled,
  enabled,
  children,
}: {
  /** Override sound for this subtree (modern). */
  soundEnabled?: boolean
  /** Override vibration for this subtree (modern). */
  vibrateEnabled?: boolean
  /** Legacy shorthand — sets both `soundEnabled` and `vibrateEnabled`. */
  enabled?: boolean
  children: React.ReactNode
}) {
  const value = React.useMemo<SoundContextValue>(
    () => ({
      soundEnabled: enabled !== undefined ? enabled : soundEnabled,
      vibrateEnabled: enabled !== undefined ? enabled : vibrateEnabled,
    }),
    [soundEnabled, vibrateEnabled, enabled],
  )

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>
}

/**
 * `useSoundEnabledPreference` — resolves the effective `soundEnabled` value
 * by combining `SoundContext` override with the auth store preference.
 *
 * Resolution order:
 * 1. `SoundContext` override (if explicitly set by a parent `<SoundProvider>`)
 * 2. Auth store `user.soundEnabled` (preference saved on the backend)
 * 3. `undefined` (caller should treat as "enabled by default")
 *
 * @example
 * ```tsx
 * const soundEnabled = useSoundEnabledPreference()
 *
 * if (soundEnabled === false) {
 *   return <MutedIcon />
 * }
 * ```
 */
export function useSoundEnabledPreference(): boolean | undefined {
  const ctx = React.useContext(SoundContext)
  const contextOverride = ctx?.soundEnabled
  const authPref = useAuthStore((s) => s.user?.soundEnabled)
  return contextOverride !== undefined ? contextOverride : authPref
}

/**
 * `useVibrateEnabledPreference` — resolves the effective `vibrateEnabled`
 * value by combining `SoundContext` override with the auth store preference.
 *
 * Resolution order:
 * 1. `SoundContext` override (if explicitly set via `<SoundProvider>`)
 * 2. Auth store `user.vibrateEnabled` (preference saved on the backend)
 * 3. `undefined` (caller should treat as "enabled by default")
 *
 * @example
 * ```tsx
 * const vibrateEnabled = useVibrateEnabledPreference()
 *
 * if (vibrateEnabled === false) {
 *   // Don't vibrate
 * }
 * ```
 */
export function useVibrateEnabledPreference(): boolean | undefined {
  const ctx = React.useContext(SoundContext)
  const contextOverride = ctx?.vibrateEnabled
  const authPref = useAuthStore((s) => s.user?.vibrateEnabled)
  return contextOverride !== undefined ? contextOverride : authPref
}
