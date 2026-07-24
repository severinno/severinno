"use client"

/**
 * MuteIndicator — displays the current sound-enabled state as a small icon.
 *
 * Uses `useSoundEnabledPreference()` to read the effective value
 * (SoundContext override → auth store → undefined = enabled by default).
 *
 * Props:
 *  - `className` — optional Tailwind classes forwarded to the icon wrapper.
 *  - `showLabel` — when true, renders a text label next to the icon.
 *
 * @example
 * ```tsx
 * // In a topbar or settings area:
 * <MuteIndicator className="text-muted-foreground" />
 *
 * // With label:
 * <MuteIndicator showLabel className="gap-2" />
 * ```
 */

import { Volume2, VolumeX } from "lucide-react"

import { cn } from "@/lib/utils"
import { useSoundEnabledPreference } from "@/lib/sound-context"

export function MuteIndicator({
  className,
  showLabel = false,
}: {
  className?: string
  showLabel?: boolean
}) {
  const soundEnabled = useSoundEnabledPreference()
  // undefined = no user / no context override → enabled by default
  const muted = soundEnabled === false

  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        muted ? "text-muted-foreground/60" : "text-muted-foreground",
        className,
      )}
      title={muted ? "Som desativado" : "Som ativado"}
      aria-label={muted ? "Som desativado" : "Som ativado"}
      aria-live="polite"
    >
      {muted ? (
        <VolumeX className="size-4" aria-hidden />
      ) : (
        <Volume2 className="size-4" aria-hidden />
      )}
      {showLabel ? (
        <span>{muted ? "Som desativado" : "Som ativado"}</span>
      ) : null}
    </span>
  )
}
