"use client"

import * as React from "react"
import { Calendar, Clock } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { WEEKDAYS, WEEKDAYS_SHORT } from "@/lib/constants"
import { type ProviderDetail } from "@/lib/api"
import { cn } from "@/lib/utils"
import { getQuickSlotsForProvider } from "./shared"

export function HoursTab({
  providerId,
  availability,
  loading,
  onBooking,
  onQuote,
}: {
  providerId?: string
  availability: ProviderDetail["availability"]
  loading: boolean
  onBooking: () => void
  onQuote?: () => void
}) {
  const quickSlots = React.useMemo(() => getQuickSlotsForProvider(providerId), [providerId])

  if (loading) return <Skeleton className="h-44 w-full rounded-2xl" />

  const byDay = new Map<number, { start: string; end: string }[]>()
  for (const a of availability ?? []) {
    const arr = byDay.get(a.dayOfWeek) ?? []
    arr.push({ start: a.startTime, end: a.endTime })
    byDay.set(a.dayOfWeek, arr)
  }

  const today = new Date().getDay()

  // Currently open?
  const now = new Date()
  const todaySlots = byDay.get(today) ?? []
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const currentlyOpen = todaySlots.some((s) => {
    const [sh, sm] = s.start.split(":").map(Number)
    const [eh, em] = s.end.split(":").map(Number)
    return currentMinutes >= sh * 60 + sm && currentMinutes <= eh * 60 + em
  })

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Status banner + Quick slots */}
      <div className="bg-card border-border/50 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 shadow-xs">
        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold",
            currentlyOpen
              ? "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300"
              : "bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300",
          )}
        >
          <span
            className={cn(
              "size-2 rounded-full",
              currentlyOpen ? "animate-pulse bg-emerald-500" : "bg-amber-500",
            )}
          />
          {currentlyOpen ? "Aberto agora para atendimento" : "Fechado agora"}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium">Próximas vagas livres:</span>
          {quickSlots.map((slot) => (
            <button
              key={slot.label}
              type="button"
              onClick={onBooking}
              className="bg-muted/40 border-border/70 hover:bg-muted text-foreground inline-flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-1 text-xs font-bold shadow-2xs transition-all hover:scale-[1.02] active:scale-98"
            >
              <Calendar className="size-3 text-emerald-600" />
              {slot.label}
            </button>
          ))}
        </div>
      </div>

      {/* 7-day schedule cards */}
      <div className="bg-card border-border/60 divide-border/40 divide-y overflow-hidden rounded-2xl border shadow-xs">
        {WEEKDAYS.map((day, i) => {
          const slots = byDay.get(i) ?? []
          const open = slots.length > 0
          const isToday = i === today
          return (
            <div
              key={day}
              className={cn(
                "flex items-center justify-between gap-3 px-5 py-3 text-xs transition-colors sm:text-sm",
                isToday
                  ? "bg-emerald-500/10 font-bold dark:bg-emerald-950/30"
                  : "hover:bg-muted/30",
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={cn(
                    "truncate font-semibold",
                    isToday
                      ? "font-extrabold text-emerald-800 dark:text-emerald-200"
                      : "text-foreground",
                  )}
                >
                  <span className="hidden sm:inline">{day}</span>
                  <span className="sm:hidden">{WEEKDAYS_SHORT[i]}</span>
                </span>
                {isToday && (
                  <Badge className="rounded-full bg-emerald-600 px-2 py-0 text-[10px] font-extrabold text-white">
                    hoje
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {slots.length === 0 ? (
                  <span className="text-muted-foreground text-xs font-medium">— Fechado</span>
                ) : (
                  <span className="text-foreground font-mono text-xs font-semibold tabular-nums">
                    {slots.map((s) => `${s.start}–${s.end}`).join(", ")}
                  </span>
                )}
                <Badge
                  variant={open ? "default" : "outline"}
                  className={cn(
                    "min-w-16 justify-center rounded-lg px-2.5 py-0.5 text-[10px] font-bold",
                    open
                      ? "border-0 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
                      : "text-muted-foreground bg-muted/30 border-border/40",
                  )}
                >
                  {open ? "Aberto" : "Fechado"}
                </Badge>
              </div>
            </div>
          )
        })}
      </div>

      {/* Special Out-of-hours Callout */}
      <div className="border-border/50 bg-muted/20 flex flex-col items-center justify-between gap-3 rounded-2xl border p-4 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Clock className="size-3.5" />
          </span>
          <div>
            <p className="text-foreground text-xs font-bold">
              Precisa de atendimento em horário especial ou emergência?
            </p>
            <p className="text-muted-foreground text-[11px]">
              O prestador pode analisar orçamentos fora do expediente comum.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onQuote ?? onBooking}
          className="border-border/70 hover:bg-muted h-8 shrink-0 rounded-xl px-3 text-xs font-semibold active:scale-95"
        >
          Pedir Orçamento Especial
        </Button>
      </div>
    </div>
  )
}
