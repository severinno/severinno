"use client"

import * as React from "react"
import { Siren, Zap, Droplets, Key, ShieldAlert, ArrowRight, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRegionalContext } from "@/hooks/use-regional-context"

interface EmergencySosBannerProps {
  onTriggerSos: (emergencyType?: string) => void
  className?: string
}

export function EmergencySosBanner({ onTriggerSos, className }: EmergencySosBannerProps) {
  const regional = useRegionalContext()
  const context = regional?.context
  const city = context?.city || "Governador Valadares"
  const solarPeriod = context?.solarPeriod || "morning"
  const tone = context?.tone
  const emergencyBadge = tone?.emergencyBadge || "🚨 Plantão Rápido na Sua Cidade"
  const isNight = solarPeriod === "night_emergency" || solarPeriod === "weekend"

  return (
    <section
      aria-label="Plantão de Emergência 24h"
      className={cn(
        "relative overflow-hidden rounded-2xl border p-5 shadow-lg transition-all sm:p-6",
        isNight
          ? "via-background text-foreground border-rose-500/40 bg-gradient-to-br from-rose-950/80 to-rose-900/30"
          : "via-background text-foreground dark:to-background border-rose-200/80 bg-gradient-to-br from-rose-50/90 to-amber-50/50 dark:border-rose-900/50 dark:from-rose-950/40",
        className,
      )}
    >
      {/* Background glow animation */}
      <div className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-rose-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-12 -left-12 size-40 rounded-full bg-amber-500/10 blur-3xl" />

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        {/* Left header & context */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-bold text-rose-600 dark:text-rose-400">
              <Siren className="size-3.5 animate-pulse text-rose-500" />
              <span>{isNight ? "Plantão Noturno Ativo 24h" : "Plantão Rápido de Emergência"}</span>
            </span>

            <span className="text-muted-foreground flex items-center gap-1 text-xs font-semibold">
              <Clock className="size-3 text-rose-500" />
              <span>Chegada média de 15 a 30 min em {city}</span>
            </span>
          </div>

          <h3 className="text-lg font-black tracking-tight sm:text-xl">
            Cano estourou, luz apagou ou chave travou?
          </h3>
          <p className="text-muted-foreground max-w-2xl text-xs sm:text-sm">
            {emergencyBadge}: Técnicos credenciados de prontidão agora em{" "}
            <strong className="text-foreground">{city}</strong> com ferramentas prontas para
            socorrer você sem burocracia.
          </p>
        </div>

        {/* Right action pills & primary button */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onTriggerSos("eletrica")}
              className="border-border/80 bg-background/90 flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold shadow-xs transition-all hover:border-amber-500/50 hover:bg-amber-500/10 active:scale-95"
            >
              <Zap className="size-3.5 text-amber-500" />
              <span>Curto / Luz</span>
            </button>

            <button
              type="button"
              onClick={() => onTriggerSos("hidraulica")}
              className="border-border/80 bg-background/90 flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold shadow-xs transition-all hover:border-blue-500/50 hover:bg-blue-500/10 active:scale-95"
            >
              <Droplets className="size-3.5 text-blue-500" />
              <span>Vazamento</span>
            </button>

            <button
              type="button"
              onClick={() => onTriggerSos("chaveiro")}
              className="border-border/80 bg-background/90 flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold shadow-xs transition-all hover:border-rose-500/50 hover:bg-rose-500/10 active:scale-95"
            >
              <Key className="size-3.5 text-rose-500" />
              <span>Chaveiro</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onTriggerSos()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-600 via-rose-500 to-red-600 px-5 py-2.5 text-xs font-extrabold text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-rose-500/25 active:scale-95 sm:text-sm"
          >
            <ShieldAlert className="size-4" />
            <span>Pedir Socorro Agora</span>
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      </div>
    </section>
  )
}
