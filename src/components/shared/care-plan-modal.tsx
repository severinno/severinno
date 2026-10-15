"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  CalendarDays,
  Sparkles,
  ShieldCheck,
  Loader2,
  Clock,
  MapPin,
  HeartHandshake,
} from "lucide-react"
import {
  SUBSCRIPTION_PLANS,
  calculateSubscriptionPrice,
  type SubscriptionFrequency,
} from "@/lib/subscriptions"
import { formatBRL } from "@/lib/format"
import { toast } from "sonner"

export type CarePlanModalProps = {
  isOpen: boolean
  onClose: () => void
  service: {
    id: string
    title: string
    basePrice: number
    providerId: string
    providerName?: string
  }
  defaultAddress?: string
  defaultCep?: string
  defaultLat?: number
  defaultLng?: number
  onSuccess?: (bookingId: string) => void
}

const FREQUENCIES: SubscriptionFrequency[] = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"]

export function CarePlanModal({
  isOpen,
  onClose,
  service,
  defaultAddress = "",
  defaultCep = "",
  defaultLat,
  defaultLng,
  onSuccess,
}: CarePlanModalProps) {
  const [selectedFreq, setSelectedFreq] = React.useState<SubscriptionFrequency>("WEEKLY")
  const [startDate, setStartDate] = React.useState<string>(() => {
    // Tomorrow as default
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return tomorrow.toISOString().slice(0, 10)
  })
  const [preferredTime, setPreferredTime] = React.useState<string>("09:00")
  const [userNotes, setUserNotes] = React.useState<string>("")
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false)

  const pricing = React.useMemo(() => {
    return calculateSubscriptionPrice(service.basePrice, selectedFreq)
  }, [service.basePrice, selectedFreq])

  const selectedPlan = SUBSCRIPTION_PLANS[selectedFreq]

  const handleSubscribe = async () => {
    if (!startDate) {
      toast.error("Por favor, selecione a data do primeiro atendimento.")
      return
    }

    setIsSubmitting(true)
    try {
      const scheduledDateTime = new Date(`${startDate}T${preferredTime}:00`)

      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: service.id,
          providerId: service.providerId,
          frequency: selectedFreq,
          startDate: scheduledDateTime.toISOString(),
          address: defaultAddress || "Endereço cadastrado",
          cep: defaultCep || "35010-000",
          lat: defaultLat ?? -18.8511,
          lng: defaultLng ?? -41.9494,
          notes: userNotes,
        }),
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || "Não foi possível ativar o plano.")
      }

      toast.success("Plano de Cuidado ativado com sucesso!", {
        description: `Economia de ${formatBRL(pricing.annualSavings)} projetada no ano!`,
      })

      if (onSuccess && json.firstBookingId) {
        onSuccess(json.firstBookingId)
      }
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao contratar plano recorrente."
      toast.error(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              <Sparkles className="size-5" />
            </span>
            <div>
              <DialogTitle className="text-lg font-bold">Plano de Cuidado Residencial</DialogTitle>
              <DialogDescription className="text-xs">
                Economize até 15% com visitas programadas e agenda garantida para{" "}
                <span className="text-foreground font-semibold">{service.title}</span>.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Frequencies grid */}
          <div className="space-y-2">
            <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Escolha a Frequência Ideal
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FREQUENCIES.map((freq) => {
                const plan = SUBSCRIPTION_PLANS[freq]
                const isSelected = selectedFreq === freq

                return (
                  <button
                    key={freq}
                    type="button"
                    onClick={() => setSelectedFreq(freq)}
                    className={`relative flex flex-col items-center justify-between rounded-xl border p-3 text-center transition-all ${
                      isSelected
                        ? "border-emerald-600 bg-emerald-50/60 ring-2 ring-emerald-600 dark:border-emerald-500 dark:bg-emerald-950/40"
                        : "border-border/70 hover:border-border hover:bg-muted/40"
                    }`}
                  >
                    <span className="absolute -top-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                      {plan.discountPercent}% OFF
                    </span>
                    <div className="text-foreground mt-1 text-xs font-semibold">
                      {freq === "WEEKLY" && "Semanal"}
                      {freq === "BIWEEKLY" && "Quinzenal"}
                      {freq === "MONTHLY" && "Mensal"}
                      {freq === "QUARTERLY" && "Trimestral"}
                    </div>
                    <span className="text-muted-foreground text-[11px]">
                      {plan.label.split("(")[1]?.replace(")", "") || ""}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="text-muted-foreground text-[11px] italic">
              💡 {selectedPlan.recommendedFor}.
            </p>
          </div>

          {/* Pricing & Savings Breakdown Card */}
          <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-teal-50/40 p-4 dark:border-emerald-900/60 dark:from-emerald-950/30 dark:to-teal-950/20">
            <div className="flex items-center justify-between border-b border-emerald-200/60 pb-3 dark:border-emerald-900/60">
              <div>
                <span className="text-[11px] font-medium text-emerald-800 uppercase dark:text-emerald-300">
                  Valor por Visita no Plano
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black text-emerald-700 dark:text-emerald-300">
                    {formatBRL(pricing.discountedPrice)}
                  </span>
                  <span className="text-muted-foreground text-xs line-through">
                    {formatBRL(pricing.originalPrice)}
                  </span>
                </div>
              </div>
              <div className="rounded-lg bg-emerald-600 px-2.5 py-1 text-center text-xs font-bold text-white shadow-sm">
                -{pricing.discountPercent}% OFF
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-white/60 p-2 dark:bg-black/20">
                <span className="text-muted-foreground text-[10px] font-medium uppercase">
                  Economia no Ano
                </span>
                <div className="font-bold text-emerald-700 dark:text-emerald-300">
                  +{formatBRL(pricing.annualSavings)}
                </div>
              </div>
              <div className="rounded-lg bg-white/60 p-2 dark:bg-black/20">
                <span className="text-muted-foreground text-[10px] font-medium uppercase">
                  Estimativa Mensal
                </span>
                <div className="text-foreground font-bold">
                  ~{formatBRL(pricing.monthlyEstimate)}
                </div>
              </div>
            </div>
          </div>

          {/* Date & Time selection */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-semibold">
                <CalendarDays className="size-3.5" />
                1º Atendimento
              </label>
              <input
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border-border bg-background text-foreground w-full rounded-lg border px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-semibold">
                <Clock className="size-3.5" />
                Horário de Preferência
              </label>
              <select
                value={preferredTime}
                onChange={(e) => setPreferredTime(e.target.value)}
                className="border-border bg-background text-foreground w-full rounded-lg border px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="08:00">08:00 (Manhã cedo)</option>
                <option value="09:00">09:00 (Manhã)</option>
                <option value="10:30">10:30 (Manhã)</option>
                <option value="13:30">13:30 (Tarde início)</option>
                <option value="15:00">15:00 (Tarde)</option>
                <option value="16:30">16:30 (Fim de tarde)</option>
              </select>
            </div>
          </div>

          {/* Location note */}
          {defaultAddress && (
            <div className="bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-lg p-2.5 text-xs">
              <MapPin className="size-3.5 shrink-0 text-emerald-600" />
              <span className="truncate">Local: {defaultAddress}</span>
            </div>
          )}

          {/* Special notes */}
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-semibold">
              Observações Especiais ou Preferências (opcional)
            </label>
            <input
              type="text"
              placeholder="Ex: Interfone 202, tem animal no quintal, etc."
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              className="border-border bg-background text-foreground w-full rounded-lg border px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          {/* Guarantees */}
          <div className="border-border/60 bg-muted/20 space-y-1.5 rounded-lg border p-3 text-xs">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="size-4 shrink-0" />
              <span className="font-semibold">Proteção Escrow por Atendimento</span>
            </div>
            <p className="text-muted-foreground text-[11px]">
              Você só paga cada visita individualmente após o profissional concluir o serviço com
              laudo fotográfico aprovado. Cancele ou pause o plano quando quiser, sem taxas ou
              fidelidade oculta.
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2 border-t pt-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
            Voltar
          </Button>
          <Button
            size="sm"
            onClick={handleSubscribe}
            disabled={isSubmitting || !startDate}
            className="gap-1.5 bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Ativando Plano...
              </>
            ) : (
              <>
                <HeartHandshake className="size-4" />
                Ativar Plano ({selectedPlan.discountPercent}% OFF)
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
