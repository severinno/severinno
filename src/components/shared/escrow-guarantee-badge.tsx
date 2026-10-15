"use client"

/**
 * EscrowGuaranteeBadge — Selo de Confiança "Garantia Severinno com Custódia Protegida (Escrow)"
 *
 * Aplicação das Heurísticas de Nielsen:
 * - H1 Visibilidade do status e segurança financeira.
 * - H5 Prevenção de erros e desconfiança do consumidor no ambiente digital.
 * - Orientação a Serviços: garante que contratar um serviço presencial é tão seguro
 *   quanto comprar em grandes marketplaces online.
 */

import * as React from "react"
import { ShieldCheck, CheckCircle2, Lock, Sparkles, MapPin } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type EscrowGuaranteeBadgeProps = {
  variant?: "inline" | "card" | "compact" | "checkout"
  className?: string
}

export function EscrowGuaranteeBadge({ variant = "inline", className }: EscrowGuaranteeBadgeProps) {
  if (variant === "compact") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex cursor-help items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400",
              className,
            )}
          >
            <ShieldCheck className="size-3 shrink-0" />
            <span>Escrow Protegido</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <p className="font-semibold text-emerald-600 dark:text-emerald-400">Garantia Severinno</p>
          <p className="text-muted-foreground mt-0.5">
            Seu pagamento fica seguro na plataforma e só é liberado após o serviço ser concluído e
            aprovado por você.
          </p>
        </TooltipContent>
      </Tooltip>
    )
  }

  if (variant === "card") {
    return (
      <div
        className={cn(
          "rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 text-xs backdrop-blur-xs",
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="size-4" />
          </div>
          <div className="min-w-0">
            <h5 className="text-foreground font-bold">Garantia Severinno com Custódia Protegida</h5>
            <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
              Seu dinheiro fica retido e seguro. O prestador só recebe após você aprovar a
              realização do serviço ou validação por GPS.
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-emerald-500/15 pt-2 text-[10px]">
          <div className="text-muted-foreground flex items-center gap-1">
            <Lock className="size-3 text-emerald-600 dark:text-emerald-400" />
            <span>Retenção Segura</span>
          </div>
          <div className="text-muted-foreground flex items-center gap-1">
            <MapPin className="size-3 text-emerald-600 dark:text-emerald-400" />
            <span>Check-in GPS</span>
          </div>
          <div className="text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
            <span>Aprovação Final</span>
          </div>
        </div>
      </div>
    )
  }

  if (variant === "checkout") {
    return (
      <div
        className={cn(
          "rounded-xl border-2 border-emerald-500/30 bg-emerald-500/10 p-4 text-xs shadow-xs",
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
            <ShieldCheck className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h4 className="text-foreground text-sm font-bold">
                Pagamento 100% Protegido em Custódia
              </h4>
              <Sparkles className="size-3 text-amber-500" />
            </div>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Fique tranquilo! O valor pago via PIX não vai direto para a conta do profissional. Ele
              fica guardado sob a custódia da Severinno e só é liberado para o prestador quando você
              confirmar que o serviço foi executado com qualidade.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Default inline
  return (
    <div
      className={cn("text-muted-foreground inline-flex items-center gap-1.5 text-xs", className)}
    >
      <ShieldCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <span>
        <strong className="text-foreground font-semibold">Garantia Severinno:</strong> Pagamento
        protegido em custódia até a conclusão.
      </span>
    </div>
  )
}
