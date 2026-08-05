"use client"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CalendarDays, CalendarOff, Trash2, Plus, Loader2, Umbrella } from "lucide-react"
import { format, isSameDay } from "date-fns"
import { ptBR } from "date-fns/locale"

import { apiGet, apiPost } from "@/lib/api"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Calendar } from "@/components/ui/calendar"
import { Badge } from "@/components/ui/badge"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DateBlock = {
  id: string
  date: string
  allDay: boolean
  startTime: string | null
  endTime: string | null
  reason: string | null
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function ProviderDateBlocks() {
  const qc = useQueryClient()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [selectedDate, setSelectedDate] = React.useState<Date>(today)
  const [allDay, setAllDay] = React.useState(true)
  const [startTime, setStartTime] = React.useState("08:00")
  const [endTime, setEndTime] = React.useState("18:00")
  const [reason, setReason] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const blocksQuery = useQuery<{ items: DateBlock[] }>({
    queryKey: ["provider", "date-blocks"],
    queryFn: async () => apiGet("/api/availability/blocks"),
  })

  const blocks = React.useMemo(() => blocksQuery.data?.items ?? [], [blocksQuery.data?.items])

  const selectedBlocks = blocks.filter((b) => isSameDay(new Date(b.date), selectedDate))

  const handleAdd = async () => {
    if (!selectedDate) {
      toast.error("Selecione uma data")
      return
    }

    // Check if already blocked
    if (selectedBlocks.some((b) => b.allDay)) {
      toast.error("Este dia já está bloqueado")
      return
    }

    setSaving(true)
    try {
      await apiPost("/api/availability/blocks", {
        date: selectedDate.toISOString(),
        allDay,
        startTime: allDay ? undefined : startTime,
        endTime: allDay ? undefined : endTime,
        reason: reason || undefined,
      })
      toast.success("Data bloqueada com sucesso")
      setReason("")
      qc.invalidateQueries({ queryKey: ["provider", "date-blocks"] })
    } catch (e) {
      const err = e as { message?: string }
      toast.error(err?.message ?? "Erro ao bloquear data")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (blockId: string) => {
    try {
      const res = await fetch(`/api/availability/blocks/${blockId}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Erro ao remover bloqueio")
      toast.success("Bloqueio removido")
      qc.invalidateQueries({ queryKey: ["provider", "date-blocks"] })
    } catch (e) {
      const err = e as { message?: string }
      toast.error(err?.message ?? "Erro ao remover bloqueio")
    }
  }

  // Build blocked date set for calendar highlighting
  const blockedDates = React.useMemo(() => {
    return blocks.filter((b) => b.allDay).map((b) => new Date(b.date))
  }, [blocks])

  const hasBlocked = blockedDates.length > 0

  return (
    <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
      {/* LEFT: Calendar */}
      <Card className="py-0">
        <CardHeader className="border-b py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CalendarDays className="size-4" />
            Calendário
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <Calendar
            mode="single"
            locale={ptBR}
            selected={selectedDate}
            onSelect={(d) => d && setSelectedDate(d)}
            disabled={(d) => d < today}
            modifiers={{
              blocked: blockedDates,
            }}
            modifiersStyles={{
              blocked: {
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                borderColor: "rgba(239, 68, 68, 0.3)",
                textDecoration: "line-through",
                opacity: 0.6,
              },
            }}
            className="rounded-lg border shadow-sm"
          />
          <p className="text-muted-foreground mt-2 text-center text-[11px]">
            {hasBlocked
              ? `${blockedDates.length} dia(s) bloqueado(s) no total`
              : "Nenhum bloqueio ativo"}
          </p>
        </CardContent>
      </Card>

      {/* RIGHT: Add block + list */}
      <div className="grid gap-4">
        {/* Add new block */}
        <Card className="py-0">
          <CardHeader className="border-b py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Umbrella className="size-4" />
              Bloquear {selectedDate ? format(selectedDate, "dd/MM/yyyy") : "data"}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-3">
            <div className="flex items-center gap-2">
              <Switch id="allDay" checked={allDay} onCheckedChange={setAllDay} />
              <Label htmlFor="allDay" className="text-xs">
                Dia inteiro
              </Label>
            </div>

            {!allDay && (
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="blockStart" className="text-xs">
                    Início
                  </Label>
                  <Input
                    id="blockStart"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="blockEnd" className="text-xs">
                    Fim
                  </Label>
                  <Input
                    id="blockEnd"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}

            <div className="grid gap-1">
              <Label htmlFor="blockReason" className="text-xs">
                Motivo (opcional)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="blockReason"
                  placeholder="Ex: Feriado, Folga, Consulta..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-8 flex-1 text-xs"
                  maxLength={200}
                />
                <Button onClick={handleAdd} disabled={saving} size="sm" className="h-8 gap-1">
                  {saving ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Plus className="size-3" />
                  )}
                  Bloquear
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Existing blocks for selected date */}
        <Card className="py-0">
          <CardHeader className="border-b py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarOff className="size-4" />
              Bloqueios em {format(selectedDate, "dd/MM/yyyy")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            {blocksQuery.isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="text-muted-foreground size-4 animate-spin" />
              </div>
            ) : selectedBlocks.length === 0 ? (
              <p className="text-muted-foreground py-3 text-center text-xs">
                Nenhum bloqueio nesta data
              </p>
            ) : (
              <ul className="grid gap-2">
                {selectedBlocks.map((b) => (
                  <li
                    key={b.id}
                    className="bg-card flex items-center justify-between gap-2 rounded-lg border p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className="border-red-200 bg-red-50 px-1.5 py-0 text-[10px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                        >
                          {b.allDay
                            ? "Dia inteiro"
                            : `${b.startTime?.slice(0, 5)}-${b.endTime?.slice(0, 5)}`}
                        </Badge>
                        {b.reason && (
                          <span className="text-muted-foreground truncate text-xs">{b.reason}</span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive size-7"
                      onClick={() => handleDelete(b.id)}
                      aria-label="Remover bloqueio"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default ProviderDateBlocks
