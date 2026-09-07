"use client"

import * as React from "react"
import { CalendarDays, CalendarOff, CheckCircle2, Clock, Loader2, Moon, Sun } from "lucide-react"
import { ptBR } from "date-fns/locale"
import { format } from "date-fns"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { formatBRL, formatHHmm } from "@/lib/format"
import { SERVICE_UNIT_LABELS, WEEKDAYS_SHORT } from "@/lib/constants"
import { StepHeader, InfoCard } from "../step-wizard"
import type { Step1Props, TimePeriod } from "./types"

const TIME_PERIODS: TimePeriod[] = [
  { key: "morning", label: "Manhã", icon: Sun, range: [6, 12] },
  { key: "afternoon", label: "Tarde", icon: Clock, range: [12, 18] },
  { key: "evening", label: "Noite", icon: Moon, range: [18, 24] },
]

export function Step1Schedule({
  state,
  set,
  availability,
  selectedService,
  provider,
  loading,
  isDesktop,
}: Step1Props) {
  const slots = React.useMemo(() => {
    if (!state.date) return [] as { label: string; value: string }[]
    const dow = state.date.getDay()
    const dayBlocks = (availability ?? [])
      .filter((a) => a.dayOfWeek === dow)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
    if (dayBlocks.length === 0) return []
    const out: { label: string; value: string }[] = []
    for (const block of dayBlocks) {
      const [sh, sm] = block.startTime.split(":").map(Number)
      const [eh, em] = block.endTime.split(":").map(Number)
      let cur = sh * 60 + sm
      const end = eh * 60 + em
      while (cur + 60 <= end) {
        const h = Math.floor(cur / 60)
        const m = cur % 60
        const hhmm = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
        out.push({ label: formatHHmm(hhmm), value: hhmm })
        cur += 60
      }
    }
    return out
  }, [state.date, availability])

  const groupedSlots = React.useMemo(() => {
    return TIME_PERIODS.map((period) => ({
      ...period,
      slots: slots.filter((s) => {
        const h = parseInt(s.value.split(":")[0], 10)
        return h >= period.range[0] && h < period.range[1]
      }),
    })).filter((g) => g.slots.length > 0)
  }, [slots])

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-emerald-600" />
      </div>
    )
  }

  const serviceBanner = selectedService ? (
    <InfoCard variant="emerald" className="mb-4">
      <div className="flex items-center gap-3">
        <Avatar className="size-9 rounded-md">
          {provider?.avatarUrl ? (
            <AvatarImage src={provider.avatarUrl} alt={provider.name} />
          ) : null}
          <AvatarFallback className="rounded-md bg-emerald-100 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {provider?.name?.[0]?.toUpperCase() ?? "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{selectedService.title}</p>
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            {formatBRL(selectedService.basePrice)} /{" "}
            {SERVICE_UNIT_LABELS[selectedService.unit] ?? "un"}
          </p>
        </div>
        {state.date && state.time && <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />}
      </div>
    </InfoCard>
  ) : null

  const calendarSection = (
    <Calendar
      mode="single"
      locale={ptBR}
      selected={state.date}
      onSelect={(d) => {
        set("date", d)
        set("time", undefined)
      }}
      disabled={(d) => d < today}
      className="rounded-lg border shadow-sm [--cell-size:--spacing(7)]"
    />
  )

  const timeSlotsSection = (
    <div className="flex h-full flex-col">
      {!state.date ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="py-8 text-center">
            <CalendarDays className="text-muted-foreground/20 mx-auto mb-2 size-8" />
            <p className="text-muted-foreground text-xs">Selecione uma data</p>
            <p className="text-muted-foreground/50 mt-0.5 text-[11px]">
              para ver os horários disponíveis
            </p>
          </div>
        </div>
      ) : slots.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="bg-muted/20 rounded-lg border border-dashed px-6 py-5 text-center">
            <CalendarOff className="text-muted-foreground/30 mx-auto mb-1.5 size-6" />
            <p className="text-muted-foreground text-xs font-medium">Sem horários neste dia</p>
            <p className="text-muted-foreground/50 mt-0.5 text-[11px]">
              {WEEKDAYS_SHORT[state.date.getDay()]} — fora do expediente
            </p>
          </div>
        </div>
      ) : (
        <ScrollArea className="-mx-1 flex-1 px-1">
          <div className="grid gap-3">
            {groupedSlots.map((group) => {
              const PeriodIcon = group.icon
              return (
                <div key={group.key}>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <PeriodIcon className="text-muted-foreground/50 size-3" />
                    <span className="text-muted-foreground/70 text-[11px] font-medium tracking-wide uppercase">
                      {group.label}
                    </span>
                    <span className="text-muted-foreground/40 text-[10px]">
                      {group.slots.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {group.slots.map((s) => {
                      const active = state.time === s.value
                      return (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => set("time", s.value)}
                          className={cn(
                            "rounded-lg px-2 py-2 text-center text-xs font-medium transition-all duration-150",
                            "focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:outline-none",
                            active
                              ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/20"
                              : "bg-muted/60 text-muted-foreground hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300",
                          )}
                        >
                          {s.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  )

  const selectedDateSummary = state.date && (
    <div
      className={cn(
        "mt-2 rounded-lg px-3 py-2 text-center transition-colors duration-200",
        state.time
          ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
          : "bg-muted/40 text-muted-foreground",
      )}
    >
      <p className="text-xs font-semibold">
        {format(state.date, "EEEE, dd 'de' MMMM", { locale: ptBR })}
      </p>
      {state.time ? (
        <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          <Clock className="size-3" />
          {formatHHmm(state.time)}
        </p>
      ) : (
        <p className="mt-0.5 text-[11px] opacity-60">Escolha o horário →</p>
      )}
    </div>
  )

  return (
    <div>
      {!isDesktop && (
        <StepHeader
          icon={CalendarDays}
          title="Escolha a data e horário"
          description="Selecione o melhor dia e horário para o serviço."
        />
      )}

      {serviceBanner}

      {isDesktop ? (
        <div className="grid grid-cols-[auto_1fr] divide-x">
          <div className="flex flex-col pr-4">
            {calendarSection}
            {selectedDateSummary}
          </div>
          <div className="flex min-h-0 flex-col pl-4">{timeSlotsSection}</div>
        </div>
      ) : (
        <div className="grid gap-4">
          {calendarSection}
          {selectedDateSummary}
          {timeSlotsSection}
        </div>
      )}
    </div>
  )
}
