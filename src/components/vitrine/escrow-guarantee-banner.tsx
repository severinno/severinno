"use client"

import * as React from "react"
import {
  ShieldCheck,
  Lock,
  Camera,
  CheckCircle2,
  ArrowRight,
  ShieldAlert,
  Award,
} from "lucide-react"
import { cn } from "@/lib/utils"

export type EscrowGuaranteeBannerProps = {
  className?: string
  onLearnMore?: () => void
}

export function EscrowGuaranteeBanner({ className, onLearnMore }: EscrowGuaranteeBannerProps) {
  return (
    <section
      className={cn(
        "from-card to-muted/30 border-border/40 border-b bg-gradient-to-b py-12",
        className,
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="border-primary/20 via-background relative overflow-hidden rounded-3xl border bg-gradient-to-br from-emerald-950/20 to-teal-950/20 p-6 shadow-sm sm:p-10">
          {/* Subtle background glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-emerald-500/10 blur-3xl"
          />

          <div className="relative z-10 flex flex-col items-center justify-between gap-8 lg:flex-row">
            {/* Left copy */}
            <div className="max-w-xl text-left">
              <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="size-4 text-emerald-600" />
                <span>Garantia de Custódia Blindada Severinno</span>
              </div>

              <h2 className="text-foreground text-2xl font-extrabold tracking-tight text-balance sm:text-3xl">
                Pague pelo PIX com <span className="text-primary">Zero Risco</span> de Golpe ou
                Prejuízo.
              </h2>

              <p className="text-muted-foreground mt-3 text-sm leading-relaxed sm:text-base">
                Nunca mais adiante dinheiro para quem você não conhece. Na Severinno, seu pagamento
                fica retido em conta de custódia oficial e{" "}
                <strong>só é liberado para o prestador após a sua aprovação final</strong>.
              </p>

              <div className="text-foreground mt-6 flex flex-wrap items-center gap-4 text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  R$ 0 adiantado sem proteção
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  Laudo com fotos antes e depois
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  Devolução 100% garantida
                </span>
              </div>
            </div>

            {/* Right steps card */}
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3 lg:w-auto">
              {/* Step 1 */}
              <div className="bg-card/90 border-border/60 flex flex-col items-start rounded-2xl border p-4 shadow-xs">
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-blue-500/15 text-sm font-bold text-blue-600 dark:text-blue-400">
                  <Lock className="size-5" />
                </div>
                <span className="text-[11px] font-bold tracking-wider text-blue-600 uppercase dark:text-blue-400">
                  Passo 1
                </span>
                <h4 className="text-foreground mt-0.5 text-sm font-bold">Pagamento Seguro</h4>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  Você paga via PIX ou Cartão. O dinheiro fica guardado no Escrow da Severinno.
                </p>
              </div>

              {/* Step 2 */}
              <div className="bg-card/90 border-border/60 flex flex-col items-start rounded-2xl border p-4 shadow-xs">
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-amber-500/15 text-sm font-bold text-amber-600 dark:text-amber-400">
                  <Camera className="size-5" />
                </div>
                <span className="text-[11px] font-bold tracking-wider text-amber-600 uppercase dark:text-amber-400">
                  Passo 2
                </span>
                <h4 className="text-foreground mt-0.5 text-sm font-bold">Serviço Executado</h4>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  O profissional faz o trabalho e envia o laudo fotográfico de entrega.
                </p>
              </div>

              {/* Step 3 */}
              <div className="bg-card/90 flex flex-col items-start rounded-2xl border border-emerald-500/40 p-4 shadow-xs ring-1 ring-emerald-500/20">
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-emerald-500/20 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  <Award className="size-5" />
                </div>
                <span className="text-[11px] font-bold tracking-wider text-emerald-600 uppercase dark:text-emerald-400">
                  Passo 3
                </span>
                <h4 className="text-foreground mt-0.5 text-sm font-bold">Aprovação & Liberação</h4>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  Você confere tudo. Só após o seu "OK" o valor é liberado ao profissional.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
export default EscrowGuaranteeBanner
