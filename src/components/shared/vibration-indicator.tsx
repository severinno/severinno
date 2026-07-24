"use client"

/**
 * VibrationIndicator — displays the current vibration-enabled state as a
 * small icon.
 *
 * Uses `useVibrateEnabledPreference()` to read the effective value
 * (SoundContext override → auth store → undefined = enabled by default).
 *
 * Props:
 *  - `className` — optional Tailwind classes forwarded to the icon wrapper.
 *  - `showLabel` — when true, renders a text label next to the icon.
 *
 * @example
 * ```tsx
 * // In a topbar or settings area:
 * <VibrationIndicator className="text-muted-foreground" />
 *
 * // With label:
 * <VibrationIndicator showLabel className="gap-2" />
 * ```
 */

import { Smartphone } from "lucide-react"

import { cn } from "@/lib/utils"
import { useVibrateEnabledPreference } from "@/lib/sound-context"

export function VibrationIndicator({
  className,
  showLabel = false,
}: {
  className?: string
  showLabel?: boolean
}) {
  const vibrateEnabled = useVibrateEnabledPreference()
  // undefined = no user / no context override → enabled by default
  const disabled = vibrateEnabled === false

  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        disabled ? "text-muted-foreground/60" : "text-muted-foreground",
        className,
      )}
      title={disabled ? "Vibração desativada" : "Vibração ativada"}
      aria-label={disabled ? "Vibração desativada" : "Vibração ativada"}
      aria-live="polite"
    >
      <Smartphone
        className={cn(
          "size-4 transition-opacity",
          disabled && "opacity-50",
        )}
        aria-hidden
      />
      {showLabel ? (
        <span>{disabled ? "Vibração desativada" : "Vibração ativada"}</span>
      ) : null}
    </span>
  )
}
