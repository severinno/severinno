"use client"

import * as React from "react"
import {
  AlertCircle,
  Calendar,
  Clock,
  HelpCircle,
  Loader2,
  Send,
  Sparkles,
  Wrench,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { triggerHaptic } from "@/lib/haptics"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

export interface QuickMediationModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookingId: string
  serviceTitle?: string
  peerName?: string
  userRole?: "CLIENT" | "PROVIDER" | "ADMIN"
  onSuccess?: () => void
}

type MediationTab = "delay" | "reschedule" | "scope"

const DELAY_PRESETS = [15, 30, 45, 60]

export function QuickMediationModal({
  open,
  onOpenChange,
  bookingId,
  serviceTitle = "Serviço",
  peerName = "Usuário",
  userRole = "PROVIDER",
  onSuccess,
}: QuickMediationModalProps) {
  const [activeTab, setActiveTab] = React.useState<MediationTab>("delay")
  const [selectedDelay, setSelectedDelay] = React.useState<number>(15)
  const [delayReason, setDelayReason] = React.useState("")
  const [proposedDate, setProposedDate] = React.useState("")
  const [rescheduleReason, setRescheduleReason] = React.useState("")
  const [additionalAmount, setAdditionalAmount] = React.useState("")
  const [scopeDescription, setScopeDescription] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  const handleSubmitDelay = async () => {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/bookings/${bookingId}/mediate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "notify_delay",
          delayMinutes: selectedDelay,
          reason: delayReason.trim() || undefined,
        }),
      })
      if (!res.ok) throw new Error("Falha ao enviar aviso de atraso")
      triggerHaptic("success")
      toast.success(`Aviso de atraso (+${selectedDelay} min) enviado no chat!`)
      onSuccess?.()
      onOpenChange(false)
    } catch {
      toast.error("Erro ao enviar aviso. Tente novamente.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitReschedule = async () => {
    if (!proposedDate) {
      toast.warning("Selecione uma data e horário para a nova proposta.")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/bookings/${bookingId}/mediate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "request_reschedule",
          proposedDate: new Date(proposedDate).toISOString(),
          reason: rescheduleReason.trim() || undefined,
        }),
      })
      if (!res.ok) throw new Error("Falha ao enviar proposta de reagendamento")
      triggerHaptic("success")
      toast.success("Proposta de reagendamento enviada no chat!")
      onSuccess?.()
      onOpenChange(false)
    } catch {
      toast.error("Erro ao enviar proposta. Tente novamente.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitScope = async () => {
    const val = Number.parseFloat(additionalAmount.replace(",", "."))
    if (!val || val <= 0) {
      toast.warning("Informe um valor válido para a peça ou serviço complementar.")
      return
    }
    if (!scopeDescription.trim()) {
      toast.warning("Descreva a peça ou serviço complementar.")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/bookings/${bookingId}/mediate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "scope_adjustment",
          additionalAmount: val,
          description: scopeDescription.trim(),
        }),
      })
      if (!res.ok) throw new Error("Falha ao enviar aditivo de escopo")
      triggerHaptic("success")
      toast.success("Proposta de aditivo com custódia enviada no chat!")
      onSuccess?.()
      onOpenChange(false)
    } catch {
      toast.error("Erro ao enviar aditivo. Tente novamente.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden p-0 sm:rounded-2xl">
        <DialogHeader className="bg-muted/30 border-b p-4 pb-3">
          <div className="flex items-center gap-2">
            <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
              <HelpCircle className="size-4" />
            </span>
            <div>
              <DialogTitle className="text-base font-bold">
                Resolução Ágil de Imprevistos
              </DialogTitle>
              <DialogDescription className="text-xs">
                Acordo amigável direto entre você e {peerName} ({serviceTitle})
              </DialogDescription>
            </div>
          </div>

          {/* Segmented Rail */}
          <div className="bg-muted/40 mt-3 flex rounded-xl border p-1">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setActiveTab("delay")
              }}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all active:scale-95",
                activeTab === "delay"
                  ? "bg-background text-foreground ring-border/50 shadow-xs ring-1"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Clock className="size-3.5" />
              <span>Atraso</span>
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setActiveTab("reschedule")
              }}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all active:scale-95",
                activeTab === "reschedule"
                  ? "bg-background text-foreground ring-border/50 shadow-xs ring-1"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Calendar className="size-3.5" />
              <span>Reagendar</span>
            </button>
            {userRole === "PROVIDER" && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  setActiveTab("scope")
                }}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all active:scale-95",
                  activeTab === "scope"
                    ? "bg-background text-foreground ring-border/50 shadow-xs ring-1"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Wrench className="size-3.5" />
                <span>Peça / Escopo</span>
              </button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4 p-4 text-xs">
          {/* TAB 1: ATRASO */}
          {activeTab === "delay" && (
            <div className="space-y-3">
              <div>
                <label className="text-foreground font-semibold">Tempo adicional estimado:</label>
                <div className="mt-1.5 flex gap-2">
                  {DELAY_PRESETS.map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => {
                        triggerHaptic("selection")
                        setSelectedDelay(mins)
                      }}
                      className={cn(
                        "flex-1 rounded-xl border py-2 font-bold transition-all active:scale-95",
                        selectedDelay === mins
                          ? "border-primary bg-primary/10 text-primary ring-primary/20 shadow-xs ring-1"
                          : "border-border/60 bg-card hover:bg-muted/50 text-foreground",
                      )}
                    >
                      +{mins}m
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="delay-reason" className="text-foreground font-semibold">
                  Motivo breve (opcional):
                </label>
                <Input
                  id="delay-reason"
                  placeholder="Ex: Trânsito intenso no centro / chuva"
                  value={delayReason}
                  onChange={(e) => setDelayReason(e.target.value)}
                  maxLength={150}
                  className="h-9 text-xs"
                />
              </div>

              <div className="text-muted-foreground rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-[11px]">
                💡 Uma notificação push imediata e uma mensagem serão enviadas para {peerName}{" "}
                mantendo a comunicação transparente.
              </div>
            </div>
          )}

          {/* TAB 2: REAGENDAR */}
          {activeTab === "reschedule" && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="proposed-date" className="text-foreground font-semibold">
                  Sugerir Nova Data e Horário:
                </label>
                <Input
                  id="proposed-date"
                  type="datetime-local"
                  value={proposedDate}
                  onChange={(e) => setProposedDate(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="reschedule-reason" className="text-foreground font-semibold">
                  Motivo da proposta:
                </label>
                <Textarea
                  id="reschedule-reason"
                  placeholder="Ex: Cliente solicitou alteração de data para sábado pela manhã."
                  value={rescheduleReason}
                  onChange={(e) => setRescheduleReason(e.target.value)}
                  maxLength={250}
                  className="min-h-[70px] text-xs"
                />
              </div>

              <div className="text-muted-foreground rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px]">
                🛡️ Reagendamentos amigáveis mantêm a garantia ativa e não geram multas de
                cancelamento.
              </div>
            </div>
          )}

          {/* TAB 3: ESCOPO / PEÇA ADICIONAL */}
          {activeTab === "scope" && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="additional-amount" className="text-foreground font-semibold">
                  Valor Adicional (R$):
                </label>
                <Input
                  id="additional-amount"
                  placeholder="Ex: 85,00"
                  value={additionalAmount}
                  onChange={(e) => setAdditionalAmount(e.target.value)}
                  className="h-9 text-xs tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="scope-desc" className="text-foreground font-semibold">
                  Descrição da Peça ou Ajuste Técnico:
                </label>
                <Textarea
                  id="scope-desc"
                  placeholder="Ex: Substituição da torneira de bóia e flange adicional."
                  value={scopeDescription}
                  onChange={(e) => setScopeDescription(e.target.value)}
                  maxLength={250}
                  className="min-h-[70px] text-xs"
                />
              </div>

              <div className="text-muted-foreground rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[11px]">
                ✨ Uma proposta com link de pagamento seguro PIX sob Custódia será enviada no chat.
                Os fundos ficam protegidos.
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="bg-muted/20 flex items-center justify-between border-t p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground text-xs"
          >
            Cancelar
          </Button>

          {activeTab === "delay" && (
            <Button
              type="button"
              size="sm"
              onClick={handleSubmitDelay}
              disabled={submitting}
              className="bg-primary gap-1.5 text-xs font-semibold"
            >
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              Enviar Aviso de Atraso
            </Button>
          )}

          {activeTab === "reschedule" && (
            <Button
              type="button"
              size="sm"
              onClick={handleSubmitReschedule}
              disabled={submitting || !proposedDate}
              className="bg-primary gap-1.5 text-xs font-semibold"
            >
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Calendar className="size-3.5" />
              )}
              Enviar Proposta
            </Button>
          )}

          {activeTab === "scope" && (
            <Button
              type="button"
              size="sm"
              onClick={handleSubmitScope}
              disabled={submitting || !additionalAmount || !scopeDescription}
              className="gap-1.5 bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              Enviar Aditivo no Chat
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default QuickMediationModal
