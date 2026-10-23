"use client"

import * as React from "react"
import { Calendar, Clock, Zap, Sun, CalendarCheck, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRegionalContext } from "@/hooks/use-regional-context"

interface FastBookingFilterProps {
  activeSlot?: string | null
  onSelectSlot?: (slot: string) => void
  className?: string
}

export interface BookingSlotOption {
  id: string
  label: string
  sublabel: string
  icon: typeof Zap
  badge?: string
}

export const FAST_BOOKING_SLOTS: BookingSlotOption[] = [
  {
    id: "hoje-tarde",
    label: "Hoje à Tarde",
    sublabel: "13:00 às 18:00",
    icon: Zap,
    badge: "⚡ Mais Rápido",
  },
  {
    id: "amanha-manha",
    label: "Amanhã de Manhã",
    sublabel: "08:00 às 12:00",
    icon: Sun,
  },
  {
    id: "sabado",
    label: "Este Sábado",
    sublabel: "08:00 às 17:00",
    icon: CalendarCheck,
    badge: "Fim de Semana",
  },
  {
    id: "segunda",
    label: "Próxima Segunda",
    sublabel: "Horário Comercial",
    icon: Calendar,
  },
]

export function FastBookingFilter({ activeSlot, onSelectSlot, className }: FastBookingFilterProps) {
  const regional = useRegionalContext()
  const context = regional?.context
  const city = context?.city || "Governador Valadares"

  const [selected, setSelected] = React.useState<string>(activeSlot || "hoje-tarde")

  const handleSelect = (id: string) => {
    setSelected(id)
    onSelectSlot?.(id)
  }

  const currentSlot = FAST_BOOKING_SLOTS.find((s) => s.id === selected) || FAST_BOOKING_SLOTS[0]

  return (
    <div
      aria-label="Filtro Rápido por Data e Horário"
      className={cn(
        "border-border/80 bg-card rounded-2xl border p-4 shadow-xs transition-all sm:p-5",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <div className="text-primary flex items-center gap-1.5 text-xs font-bold">
            <Clock className="size-3.5" />
            <span>Precisa de atendimento para quando?</span>
          </div>
          <p className="text-muted-foreground text-xs">
            Mostrando prestadores com agenda livre confirmada em{" "}
            <strong className="text-foreground">{city}</strong> para{" "}
            <span className="text-primary font-bold">{currentSlot.label}</span>.
          </p>
        </div>

        {/* Slot Selection Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {FAST_BOOKING_SLOTS.map((slot) => {
            const Icon = slot.icon
            const isSelected = selected === slot.id
            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => handleSelect(slot.id)}
                className={cn(
                  "relative flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all active:scale-95",
                  isSelected
                    ? "bg-primary text-primary-foreground ring-primary/30 shadow-sm ring-2"
                    : "border-border/80 bg-background text-foreground hover:border-primary/40 hover:bg-muted/40 border",
                )}
              >
                <Icon
                  className={cn(
                    "size-3.5",
                    isSelected ? "text-primary-foreground" : "text-primary",
                  )}
                />
                <div className="text-left">
                  <span className="block leading-tight">{slot.label}</span>
                  <span
                    className={cn(
                      "block text-[10px] leading-tight font-medium",
                      isSelected ? "text-primary-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {slot.sublabel}
                  </span>
                </div>
                {isSelected && <Check className="size-3.5 shrink-0 stroke-[3]" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
