"use client"

import * as React from "react"
import { Clock, Zap, AlertCircle, Calendar, ArrowRight, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"

export type LiveAvailabilityTickerProps = {
  onActionClick?: () => void
  className?: string
}

type LiveNotice = {
  id: string
  icon: typeof Zap
  color: string
  badge: string
  text: string
  actionLabel: string
}

const LIVE_NOTICES: LiveNotice[] = [
  {
    id: "eletricista-tarde",
    icon: Zap,
    color: "text-amber-500",
    badge: "Plantão Hoje",
    text: "3 eletricistas com horário livre para hoje à tarde no Centro e Ilha dos Araújos.",
    actionLabel: "Chamar Agora",
  },
  {
    id: "faxina-sabado",
    icon: Calendar,
    color: "text-emerald-500",
    badge: "Alta Procura",
    text: "85% das agendas de diaristas para este sábado em GV já estão preenchidas.",
    actionLabel: "Garantir Vaga",
  },
  {
    id: "plantao-emergencia",
    icon: AlertCircle,
    color: "text-rose-500",
    badge: "Socorro 24h",
    text: "Encanadores e chaveiros de plantão em GV com chegada estimada em até 20 minutos.",
    actionLabel: "Ver Plantão",
  },
  {
    id: "clima-ar",
    icon: Clock,
    color: "text-blue-500",
    badge: "Encaixe Rápido",
    text: "Técnico de Ar-Condicionado disponível para higienização e conserto hoje.",
    actionLabel: "Agendar",
  },
]

export function LiveAvailabilityTicker({ onActionClick, className }: LiveAvailabilityTickerProps) {
  const [currentIndex, setCurrentIndex] = React.useState(0)

  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % LIVE_NOTICES.length)
    }, 5500)
    return () => clearInterval(timer)
  }, [])

  const current = LIVE_NOTICES[currentIndex]
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
            Agenda Ao Vivo em GV:
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
