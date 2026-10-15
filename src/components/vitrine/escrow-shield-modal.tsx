"use client"

import * as React from "react"
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  Camera,
  CheckCircle2,
  XCircle,
  ArrowRight,
  HelpCircle,
  Sparkles,
  Zap,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"

export type EscrowShieldModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onExploreProviders?: () => void
}

export function EscrowShieldModal({
  open,
  onOpenChange,
  onExploreProviders,
}: EscrowShieldModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-hidden rounded-3xl border border-emerald-500/30 p-0">
        <DialogHeader className="via-background border-border/50 border-b bg-gradient-to-br from-emerald-950/30 to-teal-950/20 p-6 text-left sm:p-7">
          <div className="mb-2 flex items-center gap-2">
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/40 bg-emerald-500/15 text-xs font-bold text-emerald-700 dark:text-emerald-300"
            >
              <ShieldCheck className="size-3.5 text-emerald-600" />
              Proteção Financeira Ativa
            </Badge>
          </div>
          <DialogTitle className="text-foreground text-xl font-black tracking-tight sm:text-2xl">
            Central de Garantia Blindada & Anti-Golpe Severinno
          </DialogTitle>
          <DialogDescription className="text-muted-foreground mt-1 text-xs sm:text-sm">
            Entenda como o mecanismo de custódia (Escrow) protege seu dinheiro contra golpes,
            atrasos e serviços mal feitos.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] p-6 sm:p-7">
          <div className="space-y-6">
            {/* 1. Comparison Matrix: WhatsApp/OLX vs Severinno */}
            <div>
              <h4 className="text-muted-foreground mb-3 flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase">
                <Sparkles className="size-3.5 text-amber-500" />
                Comparativo de Segurança: Onde Seu Dinheiro Está Seguro?
              </h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Risk side */}
                <div className="rounded-2xl border border-rose-200/70 bg-rose-50/40 p-4 dark:border-rose-950 dark:bg-rose-950/20">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-rose-700 dark:text-rose-400">
                    <XCircle className="size-4 shrink-0 text-rose-600" />
                    <span>Contratação Informal (WhatsApp / OLX)</span>
                  </div>
                  <ul className="text-muted-foreground space-y-2 text-xs">
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-rose-600">✗</span>
                      <span>Exigem 50% de adiantamento sem contrato</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-rose-600">✗</span>
                      <span>Se o prestador sumir, você fica no prejuízo</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-rose-600">✗</span>
                      <span>Sem laudo de entrega ou vistoria</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-rose-600">✗</span>
                      <span>Sem garantia legal ou suporte para reembolso</span>
                    </li>
                  </ul>
                </div>

                {/* Severinno side */}
                <div className="rounded-2xl border border-emerald-300/80 bg-emerald-50/50 p-4 ring-1 ring-emerald-500/20 dark:border-emerald-800/60 dark:bg-emerald-950/30">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                    <ShieldCheck className="size-4 shrink-0 text-emerald-600" />
                    <span>Severinno Garantia Blindada (Escrow)</span>
                  </div>
                  <ul className="text-foreground space-y-2 text-xs font-medium">
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-emerald-600">✓</span>
                      <span>R$ 0 adiantado na conta do prestador</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-emerald-600">✓</span>
                      <span>Seu Pix fica guardado no cofre da plataforma</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-emerald-600">✓</span>
                      <span>Prestador envia fotos da conclusão</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="font-bold text-emerald-600">✓</span>
                      <span>Liberação somente após a sua aprovação final</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* 2. Three phases of Escrow */}
            <div className="border-border/80 bg-muted/20 rounded-2xl border p-5">
              <h4 className="text-muted-foreground mb-4 flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase">
                <Lock className="text-primary size-3.5" />
                Como Funciona na Prática em 3 Etapas:
              </h4>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="bg-card border-border/60 rounded-xl border p-3.5">
                  <span className="mb-2 flex size-6 items-center justify-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                    1
                  </span>
                  <h5 className="text-foreground text-xs font-bold">Você Reserva Seguro</h5>
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    Ao pagar pelo Pix ou Cartão, o valor é congelado em conta custódia oficial.
                  </p>
                </div>

                <div className="bg-card border-border/60 rounded-xl border p-3.5">
                  <span className="mb-2 flex size-6 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                    2
                  </span>
                  <h5 className="text-foreground text-xs font-bold">Serviço & Laudo</h5>
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    O profissional executa o serviço e envia a foto de comprovação pelo sistema.
                  </p>
                </div>

                <div className="bg-card rounded-xl border border-emerald-500/40 p-3.5">
                  <span className="mb-2 flex size-6 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    3
                  </span>
                  <h5 className="text-foreground text-xs font-bold">Você Dá o OK</h5>
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    Você confere o resultado. Só com o seu aval o valor é repassado ao prestador.
                  </p>
                </div>
              </div>
            </div>

            {/* 3. Frequently Asked Questions about Escrow */}
            <div className="space-y-3">
              <h4 className="text-muted-foreground flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase">
                <HelpCircle className="text-primary size-3.5" />
                Dúvidas Frequentes de Segurança
              </h4>

              <div className="space-y-2 text-xs">
                <div className="border-border/60 bg-card rounded-xl border p-3">
                  <p className="text-foreground font-bold">
                    E se o prestador não comparecer no dia marcado?
                  </p>
                  <p className="text-muted-foreground mt-1 leading-relaxed">
                    Você pode reagendar com prioridade ou solicitar o estorno imediato. O valor é
                    devolvido integralmente para sua chave Pix.
                  </p>
                </div>

                <div className="border-border/60 bg-card rounded-xl border p-3">
                  <p className="text-foreground font-bold">
                    E se o serviço ficar incompleto ou mal feito?
                  </p>
                  <p className="text-muted-foreground mt-1 leading-relaxed">
                    Você não aprova a liberação. A Severinno aciona a garantia de refação gratuita
                    ou media a devolução dos recursos em até 2 horas.
                  </p>
                </div>

                <div className="border-border/60 bg-card rounded-xl border p-3">
                  <p className="text-foreground font-bold">
                    Eu pago alguma taxa extra por essa proteção?
                  </p>
                  <p className="text-muted-foreground mt-1 leading-relaxed">
                    Zero taxa extra para o cliente. A proteção de custódia é nativa e obrigatória em
                    todos os serviços da plataforma.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* Footer CTA */}
        <div className="bg-muted/30 border-border/60 flex flex-col items-center justify-between gap-3 border-t p-4 sm:flex-row sm:p-5">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
            <span>Mais de 1.400 serviços concluídos com 0 calotes em GV.</span>
          </div>

          <Button
            onClick={() => {
              onOpenChange(false)
              if (onExploreProviders) onExploreProviders()
            }}
            className="w-full cursor-pointer gap-2 bg-emerald-600 font-bold text-white hover:bg-emerald-700 sm:w-auto"
          >
            <span>Contratar com Garantia Blindada</span>
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default EscrowShieldModal
