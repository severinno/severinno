"use client"

import * as React from "react"
import { CreditCard, Zap, FileText, ShieldCheck, Star, Siren, X } from "lucide-react"
import { cn } from "@/lib/utils"

export type TrustPillId =
  "parcela12x" | "pix_desconto" | "emite_nf" | "garantia90d" | "top_avaliado" | "plantao_agora"

export interface TrustPill {
  id: TrustPillId
  label: string
  shortLabel: string
  icon: React.ComponentType<{ className?: string }>
  badgeText: string
}

export const TRUST_PAYMENT_PILLS: TrustPill[] = [
  {
    id: "plantao_agora",
    label: "🚨 Atendendo Agora / Plantão Noturno & Domingo",
    shortLabel: "🚨 Plantão Agora",
    icon: Siren,
    badgeText: "24h & Domingo",
  },
  {
    id: "parcela12x",
    label: "Parcela em até 12x",
    shortLabel: "12x no Cartão",
    icon: CreditCard,
    badgeText: "Sem Juros",
  },
  {
    id: "pix_desconto",
    label: "Pix com 5% OFF",
    shortLabel: "5% OFF no Pix",
    icon: Zap,
    badgeText: "Economia Real",
  },
  {
    id: "emite_nf",
    label: "Emite Nota Fiscal (MEI/PJ)",
    shortLabel: "Nota Fiscal",
    icon: FileText,
    badgeText: "Comprovado",
  },
  {
    id: "garantia90d",
    label: "Garantia Blindada 90 Dias",
    shortLabel: "Garantia 90d",
    icon: ShieldCheck,
    badgeText: "Severinno Protege",
  },
  {
    id: "top_avaliado",
    label: "Nota 4.8+ com +20 Serviços",
    shortLabel: "Top Avaliados 4.8★",
    icon: Star,
    badgeText: "Elite GV",
  },
]

interface TrustPaymentPillsProps {
  activePills: TrustPillId[]
  onTogglePill: (id: TrustPillId) => void
  onClearPills?: () => void
  className?: string
}

export function TrustPaymentPills({
  activePills,
  onTogglePill,
  onClearPills,
  className,
}: TrustPaymentPillsProps) {
  return (
    <div
      aria-label="Filtros de Pagamento e Confiabilidade"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      <span className="text-muted-foreground hidden text-xs font-semibold tracking-wider uppercase sm:inline-block">
        Filtrar por:
      </span>

      {TRUST_PAYMENT_PILLS.map((pill) => {
        const Icon = pill.icon
        const isActive = activePills.includes(pill.id)

        return (
          <button
            key={pill.id}
            type="button"
            role="checkbox"
            aria-checked={isActive}
            onClick={() => onTogglePill(pill.id)}
            className={cn(
              "focus-visible:ring-primary inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all focus-visible:ring-2 focus-visible:outline-none active:scale-[0.98]",
              isActive
                ? "border-primary bg-primary/10 text-primary ring-primary/30 font-semibold shadow-sm ring-1"
                : "border-border/80 bg-background text-muted-foreground hover:border-primary/50 hover:bg-muted/40 hover:text-foreground",
            )}
          >
            <Icon
              className={cn(
                "size-3.5 shrink-0 transition-colors",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
            />
            <span>{pill.label}</span>
            {isActive && (
              <span className="bg-primary/20 py-0.2 text-primary ml-0.5 rounded-full px-1 text-[9px] font-bold">
                ✓
              </span>
            )}
          </button>
        )
      })}

      {activePills.length > 0 && onClearPills && (
        <button
          type="button"
          onClick={onClearPills}
          className="text-muted-foreground hover:text-foreground ml-1 inline-flex items-center gap-1 text-xs underline underline-offset-2"
        >
          <X className="size-3" />
          <span>Limpar ({activePills.length})</span>
        </button>
      )}
    </div>
  )
}
