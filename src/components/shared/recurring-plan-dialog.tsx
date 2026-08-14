"use client"

/**
 * RecurringPlanDialog — Hire service with recurring subscription (Severinno Club).
 */

import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Calendar, CheckCircle2, Loader2, Repeat, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/api"
import { formatBRL, formatDate } from "@/lib/format"
import {
  SUBSCRIPTION_PLANS,
  calculateSubscriptionPrice,
  generateUpcomingDates,
  type SubscriptionFrequency,
} from "@/lib/subscriptions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type RecurringPlanDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  service: {
    id: string
    title: string
    basePrice: number
    providerId: string
  }
}

export function RecurringPlanDialog({
  open,
  onOpenChange,
  service,
}: RecurringPlanDialogProps) {
  const queryClient = useQueryClient()
  const [frequency, setFrequency] = React.useState<SubscriptionFrequency>("BIWEEKLY")
  const [startDate, setStartDate] = React.useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 3)
    return d.toISOString().slice(0, 10)
  })

  const priceInfo = calculateSubscriptionPrice(service.basePrice, frequency)
  const previewDates = generateUpcomingDates(new Date(startDate), frequency, 3)

  const mutation = useMutation({
    mutationFn: () =>
      apiPost("/api/subscriptions", {
        serviceId: service.id,
        providerId: service.providerId,
        frequency,
        startDate,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-bookings"] })
      toast.success("Assinatura Severinno Club ativada com sucesso!")
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(err.message || "Erro ao criar assinatura")
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Repeat className="size-5 text-emerald-600" />
            Contratar com Recorrência (Severinno Club)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-xs">
          <div className="rounded-lg bg-emerald-50/80 p-3 border border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200 flex items-start gap-2">
            <Sparkles className="size-4 text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed">
              Assine com periodicidade garantida na agenda do profissional e ganhe <strong>até 10% de desconto</strong> em cada atendimento.
            </p>
          </div>

          {/* Frequency selector */}
          <div className="space-y-2">
            <label className="font-semibold text-foreground">Escolha a Frequência:</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(SUBSCRIPTION_PLANS) as SubscriptionFrequency[]).map((f) => {
                const plan = SUBSCRIPTION_PLANS[f]
                const isSelected = frequency === f
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFrequency(f)}
                    className={`rounded-xl border p-2.5 text-center transition-all ${
                      isSelected
                        ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 shadow-sm font-bold"
                        : "border-muted hover:border-muted-foreground/40 bg-background text-muted-foreground"
                    }`}
                  >
                    <div className="text-xs">{plan.label.split(" ")[0]}</div>
                    {plan.discountPercent > 0 && (
                      <span className="mt-1 inline-block rounded-full bg-emerald-600 px-1.5 py-0.2 text-[9px] text-white">
                        {plan.discountPercent}% OFF
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Price breakdown */}
          <div className="rounded-lg border p-3 bg-muted/20 space-y-1.5">
            <div className="flex justify-between text-muted-foreground">
              <span>Valor avulso:</span>
              <span className="line-through">{formatBRL(priceInfo.originalPrice)}</span>
            </div>
            <div className="flex justify-between font-bold text-foreground text-sm">
              <span>Valor com desconto do plano:</span>
              <span className="text-emerald-600 dark:text-emerald-400">
                {formatBRL(priceInfo.discountedPrice)} / visita
              </span>
            </div>
          </div>

          {/* Upcoming dates preview */}
          <div className="space-y-1.5">
            <label className="font-semibold text-foreground flex items-center gap-1.5">
              <Calendar className="size-3.5 text-emerald-600" />
              Próximas Visitas Agendadas:
            </label>
            <div className="rounded-lg border p-2.5 bg-background space-y-1">
              {previewDates.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="size-3 text-emerald-600" />
                  <span>{i + 1}ª visita: {formatDate(d)}</span>
                </div>
              ))}
            </div>
          </div>

          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="w-full bg-emerald-600 hover:bg-emerald-700 font-bold text-xs h-10 shadow-md"
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Confirmar Assinatura Recorrente"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
