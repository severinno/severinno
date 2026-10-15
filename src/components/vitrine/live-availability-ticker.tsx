"use client"

import * as React from "react"
import { Zap, AlertCircle, Calendar, ArrowRight, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRegionalContext } from "@/hooks/use-regional-context"

export type LiveAvailabilityTickerProps = {
  onActionClick?: () => void
  className?: string
}

export function LiveAvailabilityTicker({ onActionClick, className }: LiveAvailabilityTickerProps) {
  const { context: regionalContext } = useRegionalContext()
  const [currentIndex, setCurrentIndex] = React.useState(0)

  const city = regionalContext?.city || "Governador Valadares"
  const activeCount = regionalContext?.platformEvents?.activeProvidersNearby ?? 18

  const notices = React.useMemo(
    () => [
      {
        id: "profissionais-ativos",
        icon: Zap,
        color: "text-amber-500",
        badge: "Plantão Hoje",
        text: `${activeCount} profissionais com agenda livre para hoje em ${city} e região.`,
        actionLabel: "Chamar Agora",
      },
      {
        id: "social-proof-24h",
        icon: Calendar,
        color: "text-emerald-500",
        badge: "Alta Procura",
        text:
          regionalContext?.platformEvents?.recentSocialProofNotice ||
          `Agendas da semana em ${city} sendo preenchidas agora.`,
        actionLabel: "Garantir Vaga",
      },
      {
        id: "plantao-emergencia",
        icon: AlertCircle,
        color: "text-rose-500",
        badge: "Socorro 24h",
        text: `Encanadores, chaveiros e eletricistas em ${city} com chegada estimada em até 30 minutos.`,
        actionLabel: "Ver Plantão",
      },
    ],
    [activeCount, city, regionalContext?.platformEvents?.recentSocialProofNotice],
  )

  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % notices.length)
    }, 5500)
    return () => clearInterval(timer)
  }, [notices.length])

  const current = notices[currentIndex] || notices[0]
  const Icon = current.icon

  return (
    <div
      className={cn(
        "relative overflow-hidden border-y border-emerald-500/20 bg-gradient-to-r from-emerald-950 via-zinc-950 to-teal-950 px-4 py-2.5 text-white shadow-inner",
        className,
      )}
    >
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2.5 text-xs sm:flex-row">
        {/* Left Live Pulse */}
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500"></span>
          </span>
          <span className="text-[11px] font-extrabold tracking-wider text-emerald-400 uppercase">
            Agenda Ao Vivo em {city}:
          </span>
        </div>

        {/* Center Rotating Notice */}
        <div className="flex items-center gap-2 overflow-hidden text-center transition-all duration-300 sm:text-left">
          <Icon className={cn("size-3.5 shrink-0", current.color)} />
          <span className="max-w-[280px] truncate font-semibold text-white/95 sm:max-w-xl md:max-w-2xl">
            {current.text}
          </span>
        </div>

        {/* Right CTA */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-1 text-[11px] font-medium text-emerald-300/80 md:inline-flex">
            <ShieldCheck className="size-3.5 text-emerald-400" />
            Zero Adiantamento
          </span>

          <button
            type="button"
            onClick={onActionClick}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-extrabold text-zinc-950 shadow-xs transition-all hover:scale-105 hover:bg-emerald-400"
          >
            <span>{current.actionLabel}</span>
            <ArrowRight className="size-3" />
          </button>
        </div>
      </div>
    </div>
  )
}
export default LiveAvailabilityTicker
