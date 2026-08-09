"use client"

import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CalendarDays, Loader2, MapPin } from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type QuoteSummary = {
  id: string
  address: string
  provider: { id: string; name: string }
  items: { serviceId: string; price: number | null; status: string; service?: { title: string } }[]
}

export type ScheduleDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  quote: QuoteSummary | null
}

export function ScheduleBookingDialog({ open, onOpenChange, quote }: ScheduleDialogProps) {
  const qc = useQueryClient()
  const [scheduledAt, setScheduledAt] = React.useState("")
  const [address, setAddress] = React.useState("")

  // Reset when the dialog opens for a quote — adjust state during render (no
  // effect: react-hooks/set-state-in-effect gate).
  const [prevDialogState, setPrevDialogState] = React.useState({
    open,
    quoteId: quote?.id,
  })
  if (prevDialogState.open !== open || prevDialogState.quoteId !== quote?.id) {
    setPrevDialogState({ open, quoteId: quote?.id })
    if (open && quote) {
      setAddress(quote.address)
      setScheduledAt("")
    }
  }

  const bookMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/quotes/${quote?.id}/book`, {
        scheduledAt,
        address: address.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Serviço agendado com sucesso!")
      qc.invalidateQueries({ queryKey: ["quotes"] })
      qc.invalidateQueries({ queryKey: ["bookings"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
      onOpenChange(false)
    },
    onError: (e: { message?: string }) => {
      toast.error(e?.message || "Não foi possível agendar o serviço.")
    },
  })

  const totalQuoted = (quote?.items ?? []).reduce(
    (acc, i) => acc + (i.price ?? 0),
    0,
  )

  const minDate = new Date()
  minDate.setDate(minDate.getDate() + 1)
  const minDateStr = minDate.toISOString().slice(0, 16)

  const canSubmit = scheduledAt.length > 0 && !bookMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agendar serviço</DialogTitle>
          <DialogDescription>
            Escolha a data e o endereço para o serviço. O prestador será notificado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {quote ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{quote.provider.name}</p>
              <p className="text-xs text-muted-foreground">
                Total: {formatBRL(totalQuoted)}
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="scheduledAt">Data e horário</Label>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="scheduledAt"
                type="datetime-local"
                min={minDateStr}
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Endereço</Label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Rua, número, bairro, cidade"
                className="pl-9"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={bookMutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => bookMutation.mutate()}
            disabled={!canSubmit}
            className="gap-2"
          >
            {bookMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CalendarDays className="size-4" />
            )}
            Confirmar agendamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
