"use client"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Clock, Loader2, Plus, Save, Trash2, Copy, AlertCircle } from "lucide-react"
import { apiGet, apiPost } from "@/lib/api"
import { WEEKDAYS, WEEKDAYS_SHORT } from "@/lib/constants"
import { cn } from "@/lib/utils"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Slot = {
  /** Local-only id (uuid) — used as React key. */
  localId: string
  /** Server-side id (only set after a fetch). */
  id?: string
  dayOfWeek: number
  startTime: string
  endTime: string
  active: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLocalId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function overlaps(a: Slot, b: Slot): boolean {
  if (a.dayOfWeek !== b.dayOfWeek) return false
  return a.startTime < b.endTime && b.startTime < a.endTime
}

/** Returns 0-6 for the current weekday (0 = Sunday). */
function todayDayOfWeek(): number {
  return new Date().getDay()
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function ProviderExpediente() {
  const qc = useQueryClient()
  const [slots, setSlots] = React.useState<Slot[]>([])
  const [saving, setSaving] = React.useState(false)
  const [hydrated, setHydrated] = React.useState(false)

  const availQuery = useQuery<{
    items: Array<{
      id: string
      dayOfWeek: number
      startTime: string
      endTime: string
      active: boolean
    }>
  }>({
    queryKey: ["provider", "availability"],
    queryFn: async () => apiGet("/api/availability"),
  })

  // Hydrate state from server (adjust state during render)
  const [prevAvailData, setPrevAvailData] = React.useState(availQuery.data)
  if (availQuery.data && !hydrated && prevAvailData !== availQuery.data) {
    setPrevAvailData(availQuery.data)
    const next = (availQuery.data.items ?? []).map((it) => ({
      localId: it.id,
      id: it.id,
      dayOfWeek: it.dayOfWeek,
      startTime: it.startTime,
      endTime: it.endTime,
      active: it.active,
    }))
    setSlots(next)
    setHydrated(true)
  }

  // Detect overlapping slots within same day
  const overlapWarning = React.useMemo(() => {
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[i].active && slots[j].active && overlaps(slots[i], slots[j])) {
          return true
        }
      }
    }
    return false
  }, [slots])

  const addSlot = (dayOfWeek: number) => {
    const existing = slots.filter((s) => s.dayOfWeek === dayOfWeek)
    let startTime = "08:00"
    let endTime = "18:00"
    if (existing.length > 0) {
      const lastSlot = existing[existing.length - 1]
      if (lastSlot.endTime <= "12:00") {
        startTime = "13:00"
        endTime = "18:00"
      } else {
        startTime = "18:30"
        endTime = "21:00"
      }
    }
    setSlots((prev) => [
      ...prev,
      {
        localId: makeLocalId(),
        dayOfWeek,
        startTime,
        endTime,
        active: true,
      },
    ])
  }

  const toggleDay = (dayOfWeek: number, active: boolean) => {
    const daySlots = slots.filter((s) => s.dayOfWeek === dayOfWeek)
    if (!active) {
      if (daySlots.length === 0) return
      setSlots((prev) => prev.map((s) => (s.dayOfWeek === dayOfWeek ? { ...s, active: false } : s)))
    } else {
      if (daySlots.length === 0) {
        setSlots((prev) => [
          ...prev,
          {
            localId: makeLocalId(),
            dayOfWeek,
            startTime: "08:00",
            endTime: "18:00",
            active: true,
          },
        ])
      } else {
        setSlots((prev) =>
          prev.map((s) => (s.dayOfWeek === dayOfWeek ? { ...s, active: true } : s)),
        )
      }
    }
  }

  const copyDayToOtherDays = (sourceDayIdx: number) => {
    const sourceSlots = slots.filter((s) => s.dayOfWeek === sourceDayIdx && s.active)
    if (sourceSlots.length === 0) {
      toast.info(`Não há horários ativos em ${WEEKDAYS[sourceDayIdx]} para copiar.`)
      return
    }
    const targetDays = [1, 2, 3, 4, 5].filter((d) => d !== sourceDayIdx)
    const next = slots.filter((s) => !targetDays.includes(s.dayOfWeek))
    for (const day of targetDays) {
      for (const src of sourceSlots) {
        next.push({
          localId: makeLocalId(),
          dayOfWeek: day,
          startTime: src.startTime,
          endTime: src.endTime,
          active: true,
        })
      }
    }
    setSlots(next)
    toast.success(`Horários de ${WEEKDAYS_SHORT[sourceDayIdx]} copiados para Segunda a Sexta.`)
  }

  const updateSlot = (localId: string, patch: Partial<Slot>) => {
    setSlots((prev) => prev.map((s) => (s.localId === localId ? { ...s, ...patch } : s)))
  }

  const removeSlot = (localId: string) => {
    setSlots((prev) => prev.filter((s) => s.localId !== localId))
  }

  const activeDaysCount = React.useMemo(() => {
    const daysWithActiveSlots = new Set(
      slots.filter((s) => s.active && s.startTime < s.endTime).map((s) => s.dayOfWeek),
    )
    return daysWithActiveSlots.size
  }, [slots])

  const applyPresetCommercial = () => {
    const weekdays = [1, 2, 3, 4, 5]
    const next: Slot[] = slots.filter((s) => !weekdays.includes(s.dayOfWeek))
    for (const d of weekdays) {
      next.push({
        localId: makeLocalId(),
        dayOfWeek: d,
        startTime: "08:00",
        endTime: "18:00",
        active: true,
      })
    }
    setSlots(next)
    toast.success("Horário comercial (Seg-Sex, 08h-18h) aplicado. Clique em Salvar.")
  }

  const applyPresetHalfSaturday = () => {
    const days = [1, 2, 3, 4, 5, 6]
    const next: Slot[] = slots.filter((s) => !days.includes(s.dayOfWeek))
    for (const d of [1, 2, 3, 4, 5]) {
      next.push({
        localId: makeLocalId(),
        dayOfWeek: d,
        startTime: "08:00",
        endTime: "18:00",
        active: true,
      })
    }
    next.push({
      localId: makeLocalId(),
      dayOfWeek: 6,
      startTime: "08:00",
      endTime: "12:00",
      active: true,
    })
    setSlots(next)
    toast.success("Horário Seg a Sáb aplicado. Clique em Salvar.")
  }

  const clearAllSlots = () => {
    setSlots([])
    toast.info("Todos os horários foram removidos. Clique em Salvar para atualizar.")
  }

  const copyToWeekdays = () => {
    const segSex = [1, 2, 3, 4, 5]
    const existingByDay = new Map<number, Slot[]>()
    for (const s of slots) {
      const arr = existingByDay.get(s.dayOfWeek) ?? []
      arr.push(s)
      existingByDay.set(s.dayOfWeek, arr)
    }
    // Use Monday's slots as the template (or first weekday found)
    const template =
      existingByDay.get(1) ??
      existingByDay.get(2) ??
      existingByDay.get(3) ??
      existingByDay.get(4) ??
      existingByDay.get(5) ??
      []
    if (template.length === 0) {
      toast.info("Adicione horários em um dia útil para usar como modelo.")
      return
    }
    const next: Slot[] = [...slots]
    for (const day of segSex) {
      // Skip if day already has slots
      if ((existingByDay.get(day) ?? []).length > 0) continue
      for (const t of template) {
        next.push({
          localId: makeLocalId(),
          dayOfWeek: day,
          startTime: t.startTime,
          endTime: t.endTime,
          active: t.active,
        })
      }
    }
    setSlots(next)
    toast.success("Horários copiados para os dias úteis sem expediente.")
  }

  const save = async () => {
    setSaving(true)
    try {
      // Basic validation: startTime < endTime
      for (const s of slots) {
        if (s.startTime >= s.endTime) {
          toast.error(
            `Horário inválido em ${WEEKDAYS[s.dayOfWeek]}: início deve ser anterior ao fim.`,
          )
          setSaving(false)
          return
        }
      }
      await apiPost("/api/availability", {
        items: slots.map(({ id: _id, localId: _localId, ...rest }) => rest),
      })
      toast.success("Expediente salvo com sucesso.")
      qc.invalidateQueries({ queryKey: ["provider", "availability"] })
      qc.invalidateQueries({ queryKey: ["provider", "dashboard"] })
    } catch (e) {
      const err = e as { message?: string }
      toast.error(err?.message ?? "Erro ao salvar expediente.")
    } finally {
      setSaving(false)
    }
  }

  const todayIdx = todayDayOfWeek()

  return (
    <div className="grid gap-6">
      {/* Resumo Semanal & Mini-Pills de Status (Nielsen Heuristics #1, #8) */}
      <div className="bg-card flex flex-col gap-3 rounded-xl border p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full",
              activeDaysCount > 0
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400",
            )}
          >
            <Clock className="size-5" />
          </div>
          <div>
            <p className="text-foreground text-sm font-semibold">
              {activeDaysCount === 0
                ? "Agenda Fechada (Nenhum dia ativo)"
                : `${activeDaysCount} de 7 dias com atendimento ativo`}
            </p>
            <p className="text-muted-foreground text-xs">
              {activeDaysCount === 0
                ? "Ative ao menos um dia para que clientes possam agendar na vitrine."
                : "Os clientes da vitrine verão apenas os dias e horários marcados como abertos."}
            </p>
          </div>
        </div>

        {/* Mini-pills visuais da semana (Dom a Sáb) */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          {WEEKDAYS_SHORT.map((shortName, idx) => {
            const isDayActive = slots.some(
              (s) => s.dayOfWeek === idx && s.active && s.startTime < s.endTime,
            )
            const isToday = idx === todayIdx
            return (
              <button
                key={idx}
                type="button"
                onClick={() => toggleDay(idx, !isDayActive)}
                className={cn(
                  "flex size-8 flex-col items-center justify-center rounded-lg text-[10px] font-semibold transition-all",
                  isDayActive
                    ? "bg-emerald-600 text-white shadow-xs hover:bg-emerald-700 dark:bg-emerald-700"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                  isToday && "ring-primary ring-2 ring-offset-1",
                )}
                title={`${WEEKDAYS[idx]}: clique para ${isDayActive ? "fechar" : "abrir"}`}
              >
                {shortName[0]}
                <span
                  className={cn(
                    "size-1 rounded-full",
                    isDayActive ? "bg-white" : "bg-zinc-400 dark:bg-zinc-600",
                  )}
                />
              </button>
            )
          })}
        </div>
      </div>

      {/* Barra de Ações e Atalhos Rápidos (Nielsen Heuristics #3, #7) */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground mr-1 text-xs font-medium">Atalhos rápidos:</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={applyPresetCommercial}
            className="h-7 text-xs"
          >
            Seg a Sex (08h-18h)
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={applyPresetHalfSaturday}
            className="h-7 text-xs"
          >
            Seg a Sáb
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyToWeekdays}
            className="h-7 gap-1 text-xs"
          >
            <Copy className="size-3" />
            Copiar p/ dias úteis
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAllSlots}
            className="text-muted-foreground hover:text-destructive h-7 text-xs"
          >
            Limpar tudo
          </Button>
        </div>

        <Button
          onClick={save}
          disabled={saving || !hydrated}
          className="h-8 gap-1.5 text-xs font-semibold shadow-xs"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Salvar expediente
        </Button>
      </div>

      {overlapWarning && (
        <Alert>
          <AlertCircle className="size-4" />
          <AlertTitle>Horários sobrepostos</AlertTitle>
          <AlertDescription>
            Há janelas de horário ativas sobrepostas no mesmo dia. Os clientes podem agendar em
            qualquer horário dentro dessas janelas — considere ajustar para evitar conflitos.
          </AlertDescription>
        </Alert>
      )}

      {/* Lista de Dias com Espaço Amplo - ZERO campos cortados (Nielsen Heuristics #6, #8) */}
      {availQuery.isLoading && !hydrated ? (
        <div className="grid gap-2.5">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="bg-muted/30 h-16 animate-pulse rounded-xl border" />
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          {WEEKDAYS.map((dayName, dayIdx) => {
            const daySlots = slots
              .filter((s) => s.dayOfWeek === dayIdx)
              .sort((a, b) => a.startTime.localeCompare(b.startTime))
            const isOpen = daySlots.some((s) => s.active)
            const isTodayCard = dayIdx === todayIdx

            return (
              <div
                key={dayIdx}
                className={cn(
                  "flex flex-col gap-3 rounded-xl border p-3.5 transition-all md:flex-row md:items-center md:justify-between",
                  isTodayCard
                    ? "border-primary/40 bg-primary/[0.02] shadow-xs"
                    : isOpen
                      ? "border-border bg-card"
                      : "border-border/80 bg-muted/20 border-dashed",
                )}
              >
                {/* Coluna 1: Nome do dia, Switch mestre e Status */}
                <div className="flex items-center gap-3 sm:min-w-[190px]">
                  <Switch
                    checked={isOpen}
                    onCheckedChange={(checked) => toggleDay(dayIdx, checked)}
                    aria-label={`Ativar atendimento em ${dayName}`}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn("text-sm font-semibold", !isOpen && "text-muted-foreground")}
                      >
                        {dayName}
                      </span>
                      {isTodayCard && (
                        <Badge className="bg-primary/15 text-primary h-4 px-1.5 py-0 text-[10px] font-semibold">
                          Hoje
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground text-[11px]">
                      {isOpen ? (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                          <span className="size-1.5 rounded-full bg-emerald-500" />
                          Aberto ({daySlots.filter((s) => s.active).length} janela
                          {daySlots.filter((s) => s.active).length === 1 ? "" : "s"})
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Fechado</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Coluna 2: Janelas de horários com inputs espaçosos e claros */}
                <div className="flex flex-1 flex-wrap items-center gap-2.5">
                  {isOpen ? (
                    <>
                      {daySlots.map((slot) => {
                        const invalid = slot.startTime >= slot.endTime
                        return (
                          <div
                            key={slot.localId}
                            className={cn(
                              "bg-background flex items-center gap-2 rounded-lg border px-3 py-1.5 shadow-xs transition-colors",
                              invalid
                                ? "border-destructive/60 bg-destructive/5 text-destructive"
                                : "border-border hover:border-primary/40",
                            )}
                          >
                            <Clock className="text-muted-foreground size-3.5 shrink-0" />
                            <span className="text-muted-foreground text-xs font-medium select-none">
                              Das
                            </span>
                            <Input
                              type="time"
                              value={slot.startTime}
                              onChange={(e) =>
                                updateSlot(slot.localId, { startTime: e.target.value })
                              }
                              className="text-foreground h-7 w-[96px] px-1.5 text-xs font-semibold tabular-nums"
                              aria-label={`Horário inicial de ${dayName}`}
                            />
                            <span className="text-muted-foreground text-xs font-medium select-none">
                              às
                            </span>
                            <Input
                              type="time"
                              value={slot.endTime}
                              onChange={(e) =>
                                updateSlot(slot.localId, { endTime: e.target.value })
                              }
                              className="text-foreground h-7 w-[96px] px-1.5 text-xs font-semibold tabular-nums"
                              aria-label={`Horário final de ${dayName}`}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeSlot(slot.localId)}
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive size-6"
                              title="Remover horário"
                              aria-label="Remover intervalo"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                            {invalid && (
                              <span className="text-destructive pl-1 text-[11px] font-medium">
                                Início &ge; Fim
                              </span>
                            )}
                          </div>
                        )
                      })}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addSlot(dayIdx)}
                        className="text-muted-foreground hover:text-foreground h-8 gap-1.5 border-dashed text-xs"
                      >
                        <Plus className="size-3.5" /> Adicionar intervalo
                      </Button>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 py-1">
                      <span className="text-muted-foreground text-xs italic">
                        Sem expediente neste dia
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleDay(dayIdx, true)}
                        className="text-primary h-7 p-0 text-xs font-medium hover:underline"
                      >
                        + Ativar horário comercial
                      </Button>
                    </div>
                  )}
                </div>

                {/* Coluna 3: Ação rápida por dia */}
                {isOpen && dayIdx >= 1 && dayIdx <= 5 && (
                  <div className="flex shrink-0 items-center gap-1 self-end md:self-auto">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => copyDayToOtherDays(dayIdx)}
                      className="text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-[11px]"
                      title="Copiar horários deste dia para os outros dias úteis"
                    >
                      <Copy className="size-3" />
                      Copiar p/ dias úteis
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Dica de usabilidade e boas práticas de agendamento */}
      <div className="text-muted-foreground bg-muted/10 flex items-center justify-between rounded-lg border border-dashed p-3 text-xs">
        <p>
          💡 <strong>Dica:</strong> Mantenha seus horários atualizados para receber agendamentos
          diretos. O sistema valida que cada janela tenha horário de início anterior ao fim e avisa
          sobre sobreposições.
        </p>
      </div>
    </div>
  )
}

export default ProviderExpediente
