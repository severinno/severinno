"use client"

import * as React from "react"
import { Award, CheckCircle2, MapPin, ShieldCheck, Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatBRL } from "@/lib/format"
import { triggerHaptic } from "@/lib/haptics"
import { playCoinSound } from "@/lib/sounds"
import { useViewStore } from "@/store/view"

export interface ServiceCompletionCelebrationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookingTitle?: string
  amount?: number
  pointsAwarded?: number
  geofenceVerified?: boolean
  role?: "CLIENT" | "PROVIDER"
  onNavigateToRewards?: () => void
}

export function ServiceCompletionCelebrationDialog({
  open,
  onOpenChange,
  bookingTitle = "Serviço Prestado",
  amount = 0,
  pointsAwarded = 10,
  geofenceVerified = true,
  role = "PROVIDER",
  onNavigateToRewards,
}: ServiceCompletionCelebrationDialogProps) {
  const navigate = useViewStore((s) => s.navigate)

  // Trigger celebration haptic & coin audio when dialog opens
  React.useEffect(() => {
    if (open) {
      triggerHaptic("success")
      playCoinSound({ vibrate: true })
    }
  }, [open])

  const handleGoToRewards = () => {
    triggerHaptic("selection")
    onOpenChange(false)
    if (onNavigateToRewards) {
      onNavigateToRewards()
    } else {
      const targetView = role === "CLIENT" ? "client.rewards" : "provider.rewards"
      navigate(targetView)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden p-0 sm:rounded-2xl">
        {/* Celebratory Top Banner */}
        <div className="relative overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 p-6 text-white">
          {/* Ambient Glows */}
          <div className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-white/15 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-10 -left-10 size-32 rounded-full bg-teal-400/20 blur-xl" />

          <div className="relative flex flex-col items-center text-center">
            <div className="relative mb-3 flex size-14 items-center justify-center rounded-2xl bg-white/10 shadow-inner ring-1 ring-white/30 backdrop-blur-md">
              <CheckCircle2 className="size-8 text-white" />
              <Sparkles className="absolute -top-1 -right-1 size-4 animate-spin text-amber-300" />
            </div>

            <DialogTitle className="text-xl font-bold tracking-tight text-white">
              Atendimento Concluído com Sucesso!
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-emerald-100">
              {role === "PROVIDER"
                ? "A custódia do pagamento foi liberada e seu laudo técnico foi homologado."
                : "Seu pagamento sob custódia foi liberado ao especialista e a garantia está ativa."}
            </DialogDescription>

            {bookingTitle && (
              <Badge
                variant="outline"
                className="mt-3 border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-emerald-50 backdrop-blur-xs"
              >
                {bookingTitle}
              </Badge>
            )}
          </div>
        </div>

        {/* Bento Cards Details */}
        <div className="space-y-3 p-5">
          {/* Row 1: Escrow Release + Geofence Audit */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Escrow Release Value */}
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-50/50 p-3 dark:border-emerald-900/30 dark:bg-emerald-950/20">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Custódia Escrow</span>
              </div>
              <p className="mt-1.5 text-lg font-bold tracking-tight text-emerald-950 tabular-nums dark:text-emerald-100">
                {amount > 0 ? formatBRL(amount) : "Liberada"}
              </p>
              <p className="text-muted-foreground text-[10px]">
                {role === "PROVIDER" ? "Creditado na sua Carteira" : "Liberado ao especialista"}
              </p>
            </div>

            {/* Geofence Audit */}
            <div className="rounded-xl border border-sky-500/20 bg-sky-50/50 p-3 dark:border-sky-900/30 dark:bg-sky-950/20">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-800 dark:text-sky-300">
                <MapPin className="size-3.5 text-sky-600 dark:text-sky-400" />
                <span>Geofence GPS</span>
              </div>
              <p className="mt-1.5 text-sm font-bold tracking-tight text-sky-950 dark:text-sky-100">
                {geofenceVerified ? "Auditado no Local" : "Comprovado"}
              </p>
              <p className="text-muted-foreground text-[10px]">Raio de segurança verificado</p>
            </div>
          </div>

          {/* Row 2: Severinno Clube Pontos de Fidelidade (Anti-Cash) */}
          <div className="relative overflow-hidden rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-50/80 via-orange-50/40 to-amber-50/80 p-3.5 shadow-xs dark:border-amber-700/40 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-amber-950/30">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-300">
                  <Award className="size-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-amber-950 dark:text-amber-100">
                      Severinno Clube
                    </span>
                    <Badge className="bg-amber-500 text-[10px] font-bold text-white shadow-xs hover:bg-amber-600">
                      +{pointsAwarded} pts
                    </Badge>
                  </div>
                  <p className="text-[10px] text-amber-800/90 dark:text-amber-300/90">
                    Pontos creditados automaticamente no seu perfil
                  </p>
                </div>
              </div>
            </div>

            <p className="text-muted-foreground mt-2 text-[10px] leading-relaxed">
              🛡️ <strong>Clube de Benefícios:</strong> Seus pontos acumulados podem ser trocados por
              vouchers de desconto em novos serviços e materiais parceiros (não convertíveis em
              dinheiro físico).
            </p>
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            Fechar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleGoToRewards}
            className="gap-1.5 bg-emerald-600 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 active:scale-98"
          >
            <Sparkles className="size-3.5 fill-current" />
            <span>Ver Benefícios do Clube</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ServiceCompletionCelebrationDialog
