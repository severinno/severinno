"use client"

/**
 * PreferenceToggles — shared sound & vibration preference toggles.
 *
 * Variants:
 *   "card"    → wrapped in <Card> with Separator between toggles
 *              (used in client/provider/admin dashboards)
 *   "compact" → individual rounded-lg border items without Separator,
 *               intended to be placed inside an existing section
 *              (used in onboarding flows)
 */

import * as React from "react"
import { Play, Smartphone, Volume2 } from "lucide-react"

import { apiPatch } from "@/lib/api"
import { playCoinSound, tryVibrate } from "@/lib/sounds"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export interface PreferenceTogglesProps {
  /** Initial value for soundEnabled (default: true) */
  soundEnabled?: boolean
  /** Initial value for vibrateEnabled (default: true) */
  vibrateEnabled?: boolean
  /** Layout variant */
  variant?: "card" | "compact"
  /** Called when soundEnabled changes (fires in addition to auto-save) */
  onSoundChange?: (v: boolean) => void
  /** Called when vibrateEnabled changes (fires in addition to auto-save) */
  onVibrateChange?: (v: boolean) => void
}

export function PreferenceToggles({
  soundEnabled: initialSound = true,
  vibrateEnabled: initialVibrate = true,
  variant = "card",
  onSoundChange,
  onVibrateChange,
}: PreferenceTogglesProps) {
  const [soundEnabled, setSoundEnabled] = React.useState(initialSound)
  const [vibrateEnabled, setVibrateEnabled] = React.useState(initialVibrate)

  // Sync internal state when props change from outside (e.g., async auth
  // store hydration).  Each prop has its own effect so they don't interfere.
  // This handles the case where the auth store loads after the first render
  // and provides a different initial value.
  React.useEffect(() => {
    setSoundEnabled(initialSound)
  }, [initialSound])

  React.useEffect(() => {
    setVibrateEnabled(initialVibrate)
  }, [initialVibrate])

  const handleSoundChange = (v: boolean) => {
    setSoundEnabled(v)
    apiPatch("/api/users/me", { soundEnabled: v }).catch((err) => {
      console.warn("[prefs] failed to save sound preference:", err)
    })
    onSoundChange?.(v)
  }

  const handleVibrateChange = (v: boolean) => {
    setVibrateEnabled(v)
    apiPatch("/api/users/me", { vibrateEnabled: v }).catch((err) => {
      console.warn("[prefs] failed to save vibration preference:", err)
    })
    onVibrateChange?.(v)
  }

  const soundToggle = (
    <div className="flex items-center justify-between">
      <div className="flex items-start gap-3">
        <Volume2 className="mt-0.5 size-5 text-primary" />
        <div>
          <p className="text-sm font-medium">Sons do painel</p>
          <p className="text-xs text-muted-foreground">
            Toque um som quando novas notificações chegarem.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => playCoinSound()}
          className="inline-flex size-8 items-center justify-center rounded-full border text-muted-foreground transition hover:bg-accent hover:text-foreground"
          title="Prévia do som"
          aria-label="Ouvir prévia do som"
        >
          <Play className="size-3.5" />
        </button>
        <Switch
          checked={soundEnabled}
          onCheckedChange={handleSoundChange}
          aria-label="Ativar sons do painel"
        />
      </div>
    </div>
  )

  const vibrationToggle = (
    <div className="flex items-center justify-between">
      <div className="flex items-start gap-3">
        <Smartphone className="mt-0.5 size-5 text-primary" />
        <div>
          <p className="text-sm font-medium">Vibração</p>
          <p className="text-xs text-muted-foreground">
            Vibração sutil em dispositivos móveis.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => tryVibrate([30, 50, 30, 50, 30])}
          className="inline-flex size-8 items-center justify-center rounded-full border text-muted-foreground transition hover:bg-accent hover:text-foreground"
          title="Prévia da vibração"
          aria-label="Ouvir prévia da vibração"
        >
          <Play className="size-3.5" />
        </button>
        <Switch
          checked={vibrateEnabled}
          onCheckedChange={handleVibrateChange}
          aria-label="Ativar vibração"
        />
      </div>
    </div>
  )

  if (variant === "compact") {
    return (
      <>
        <div className="rounded-lg border p-3">{soundToggle}</div>
        <div className="rounded-lg border p-3">{vibrationToggle}</div>
      </>
    )
  }

  return (
    <Card className="rounded-xl shadow-sm">
      <CardContent className="p-4">
        {soundToggle}
        <Separator className="my-3" />
        {vibrationToggle}
      </CardContent>
    </Card>
  )
}
