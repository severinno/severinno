"use client"

/**
 * ProviderCommandHub — Central de Operações & Produtividade do Prestador.
 *
 * Apresenta cards visuais e compactos de acesso direto a todas as ferramentas
 * operacionais e comerciais do profissional (agenda, rotas GV, orçamentos,
 * extrato financeiro, catálogo de serviços, calculadora, reputação e clube).
 */

import * as React from "react"
import {
  Award,
  Calculator,
  CalendarDays,
  ChevronRight,
  Compass,
  Send,
  Share2,
  Wallet,
  Wrench,
} from "lucide-react"

import { triggerHaptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

export type ProviderBadgeTone = "emerald" | "blue" | "amber" | "purple" | "neutral"

export interface ProviderCommandOption {
  id: string
  title: string
  subtitle: string
  badge: string
  badgeTone: ProviderBadgeTone
  icon: React.ComponentType<{ className?: string }>
  onClick: (params: {
    navigate: (view: string) => void
    openReputationCard: () => void
    openPriceEstimator: () => void
  }) => void
}

const BADGE_STYLES: Record<ProviderBadgeTone, string> = {
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  purple: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  neutral: "bg-muted/80 text-muted-foreground border-border/50",
}

export const PROVIDER_COMMAND_OPTIONS: ProviderCommandOption[] = [
  {
    id: "agenda",
    title: "Agenda & Calendário",
    subtitle: "Organize seus atendimentos, marque bloqueios e planeje a semana",
    badge: "Compromissos",
    badgeTone: "blue",
    icon: CalendarDays,
    onClick: ({ navigate }) => navigate("provider.agenda"),
  },
  {
    id: "routes",
    title: "Rotas & Deslocamento",
    subtitle: "Menor tempo de trânsito entre atendimentos nos bairros de GV",
    badge: "Logística GV",
    badgeTone: "emerald",
    icon: Compass,
    onClick: ({ navigate }) => navigate("provider.routes"),
  },
  {
    id: "quotes",
    title: "Responder Orçamentos",
    subtitle: "Envie propostas personalizadas para novos clientes em potencial",
    badge: "Oportunidades",
    badgeTone: "blue",
    icon: Send,
    onClick: ({ navigate }) => navigate("provider.quotes"),
  },
  {
    id: "finance",
    title: "Extrato & Repasses PIX",
    subtitle: "Consulte saldo liberado de custódia e solicite transferências",
    badge: "Financeiro",
    badgeTone: "emerald",
    icon: Wallet,
    onClick: ({ navigate }) => navigate("provider.finance"),
  },
  {
    id: "services",
    title: "Meus Serviços & Preços",
    subtitle: "Cadastre novas especialidades, ajuste valores e fotos de portfólio",
    badge: "Catálogo",
    badgeTone: "amber",
    icon: Wrench,
    onClick: ({ navigate }) => navigate("provider.services"),
  },
  {
    id: "price-estimator",
    title: "Calculadora de Preço",
    subtitle: "Estime valor de mão de obra e deslocamento exato por bairro em GV",
    badge: "Precificação",
    badgeTone: "neutral",
    icon: Calculator,
    onClick: ({ openPriceEstimator }) => openPriceEstimator(),
  },
  {
    id: "reputation-card",
    title: "Cartão de Reputação",
    subtitle: "Compartilhe seu selo oficial com avaliações no WhatsApp e Instagram",
    badge: "Prova Social",
    badgeTone: "emerald",
    icon: Share2,
    onClick: ({ openReputationCard }) => openReputationCard(),
  },
  {
    id: "rewards",
    title: "Clube & Benefícios",
    subtitle: "Pontue a cada atendimento e resgate descontos em ferramentas",
    badge: "Vantagens VIP",
    badgeTone: "purple",
    icon: Award,
    onClick: ({ navigate }) => navigate("provider.rewards"),
  },
]

interface ProviderCommandHubProps {
  onNavigate: (view: string) => void
  onOpenReputationCard: () => void
  onOpenPriceEstimator: () => void
}

export function ProviderCommandHub({
  onNavigate,
  onOpenReputationCard,
  onOpenPriceEstimator,
}: ProviderCommandHubProps) {
  return (
    <section aria-label="Central de operações e produtividade" className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground text-xs font-bold tracking-wide uppercase">
            Central de Operações &amp; Produtividade
          </h2>
          <p className="text-muted-foreground text-[11px]">
            Atalhos diretos para gerenciar atendimentos, finanças, rotas e captação de clientes
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {PROVIDER_COMMAND_OPTIONS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                item.onClick({
                  navigate: onNavigate,
                  openReputationCard: onOpenReputationCard,
                  openPriceEstimator: onOpenPriceEstimator,
                })
              }}
              className={cn(
                "group border-border/60 bg-card relative flex flex-col justify-between rounded-xl border p-3 text-left shadow-2xs",
                "hover:border-primary/40 hover:bg-accent/30 transition-all duration-200 hover:shadow-xs active:scale-[0.98]",
                "focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:outline-none",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="bg-primary/10 text-primary border-primary/20 group-hover:bg-primary group-hover:text-primary-foreground flex size-7.5 shrink-0 items-center justify-center rounded-lg border shadow-2xs transition-colors">
                  <Icon className="size-3.5 transition-transform group-hover:scale-105" />
                </div>
                <span
                  className={cn(
                    "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
                    BADGE_STYLES[item.badgeTone],
                  )}
                >
                  {item.badge}
                </span>
              </div>

              <div className="mt-2 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <h3 className="text-foreground group-hover:text-primary truncate text-xs font-semibold transition-colors">
                    {item.title}
                  </h3>
                  <ChevronRight className="text-muted-foreground/60 group-hover:text-primary size-3 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[11px] leading-relaxed">
                  {item.subtitle}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
