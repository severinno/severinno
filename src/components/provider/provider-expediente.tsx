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

  // Hydrate state from server
  React.useEffect(() => {
    if (availQuery.data && !hydrated) {
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
  }, [availQuery.data, hydrated])

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
    setSlots((prev) => [
      ...prev,
      {
        localId: makeLocalId(),
        dayOfWeek,
        startTime: "08:00",
        endTime: "12:00",
        active: true,
      },
    ])
  }

  const updateSlot = (localId: string, patch: Partial<Slot>) => {
    setSlots((prev) => prev.map((s) => (s.localId === localId ? { ...s, ...patch } : s)))
  }

  const removeSlot = (localId: string) => {
    setSlots((prev) => prev.filter((s) => s.localId !== localId))
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
      {/* Header / quick actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          Configure os horários que você atende. Os clientes verão essa disponibilidade ao agendar.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={copyToWeekdays} className="gap-1.5">
            <Copy className="size-3.5" />
            Copiar para dias úteis
          </Button>
          <Button onClick={save} disabled={saving || !hydrated} className="gap-1.5">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Salvar expediente
          </Button>
        </div>
      </div>

      {overlapWarning && (
        <Alert>
          <AlertCircle className="size-4" />
          <AlertTitle>Horários sobrepostos</AlertTitle>
          <AlertDescription>
            Há janelas de horário ativas sobrepostas no mesmo dia. Os clientes podem agendar em
            qualquer horário dentro dessas janelas — considere ajustar para evitar confusão.
          </AlertDescription>
        </Alert>
      )}

      {availQuery.isLoading && !hydrated ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="bg-muted/30 h-40 animate-pulse rounded-xl border" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {WEEKDAYS.map((_, dayIdx) => {
            const daySlots = slots
              .filter((s) => s.dayOfWeek === dayIdx)
              .sort((a, b) => a.startTime.localeCompare(b.startTime))
            const isOpen = daySlots.some((s) => s.active)
            const isTodayCard = dayIdx === todayIdx
            return (
              <Card
                key={dayIdx}
                className={cn(
                  "flex flex-col overflow-hidden py-0",
                  isTodayCard && "ring-primary/60 ring-2",
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-between gap-2 border-b px-3 py-2.5",
                    isTodayCard ? "bg-primary/10" : "bg-muted/30",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        isOpen ? "bg-emerald-500" : "bg-muted-foreground/40",
                      )}
                    />
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "truncate text-sm font-semibold",
                          isTodayCard && "text-primary",
                        )}
                      >
                        {WEEKDAYS_SHORT[dayIdx]}
                      </p>
                      <p className="text-muted-foreground text-[10px]">
                        {isOpen
                          ? `${daySlots.filter((s) => s.active).length} janela(s)`
                          : "Fechado"}
                      </p>
                    </div>
                  </div>
                  {isTodayCard && (
                    <Badge className="bg-primary/15 text-primary text-[10px]">Hoje</Badge>
                  )}
                </div>
                <CardContent className="flex flex-1 flex-col gap-2 p-3">
                  {daySlots.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center py-3 text-center">
                      <p className="text-muted-foreground text-[11px]">Sem expediente</p>
                    </div>
                  ) : (
                    <ul className="grid gap-1.5">
                      {daySlots.map((slot) => {
                        const invalid = slot.startTime >= slot.endTime
                        return (
                          <li
                            key={slot.localId}
                            className={cn(
                              "flex flex-col gap-1.5 rounded-lg border p-2 transition-colors",
                              slot.active
                                ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20"
                                : "border-border bg-muted/30",
                            )}
                          >
                            <div className="flex items-center gap-1.5">
                              <Clock className="text-muted-foreground size-3 shrink-0" />
                              <Input
                                type="time"
                                value={slot.startTime}
                                onChange={(e) =>
                                  updateSlot(slot.localId, {
                                    startTime: e.target.value,
                                  })
                                }
                                className="h-7 w-[68px] px-1 text-xs"
                                aria-label="Início"
                              />
                              <span className="text-muted-foreground">→</span>
                              <Input
                                type="time"
                                value={slot.endTime}
                                onChange={(e) =>
                                  updateSlot(slot.localId, {
                                    endTime: e.target.value,
                                  })
                                }
                                className="h-7 w-[68px] px-1 text-xs"
                                aria-label="Fim"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive ml-auto size-6"
                                onClick={() => removeSlot(slot.localId)}
                                aria-label="Remover horário"
                              >
                                <Trash2 className="size-3" />
                              </Button>
                            </div>
                            {invalid && (
                              <p className="text-destructive text-[10px]">
                                Início deve ser anterior ao fim
                              </p>
                            )}
                            <div className="flex items-center justify-between">
                              <Switch
                                checked={slot.active}
                                onCheckedChange={(v) => updateSlot(slot.localId, { active: v })}
                                aria-label="Ativo"
                                className={cn(!slot.active && "opacity-60")}
                              />
                              <span
                                className={cn(
                                  "text-[10px] font-medium",
                                  slot.active
                                    ? "text-emerald-700 dark:text-emerald-300"
                                    : "text-muted-foreground",
                                )}
                              >
                                {slot.active ? "Aberto" : "Fechado"}
                              </span>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => addSlot(dayIdx)}
                    className="text-primary hover:text-primary mt-auto h-7 gap-1 text-xs"
                  >
                    <Plus className="size-3" />
                    Adicionar horário
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        Dica: o servidor valida que cada janela tenha início anterior ao fim. Sobreposições no mesmo
        dia são permitidas mas geram aviso visual.
      </p>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || !hydrated} className="gap-1.5">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Salvar expediente
        </Button>
      </div>
    </div>
  )
}

export default ProviderExpediente
