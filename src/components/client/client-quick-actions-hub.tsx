"use client"

/**
 * ClientQuickActionsHub — Central de Serviços & Acesso Rápido do Painel do Cliente.
 *
 * Exibe cards modernos e compactos com atalhos diretos para todas as
 * funcionalidades essenciais do cliente (busca geo, orçamentos, agendamentos,
 * pagamentos protegidos, clube de benefícios e indicações).
 */

import * as React from "react"
import {
  Award,
  CalendarCheck,
  ChevronRight,
  FileText,
  Gift,
  MapPin,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react"

import { triggerHaptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

export type ClientBadgeTone = "emerald" | "blue" | "amber" | "purple" | "rose" | "neutral"

export interface ClientActionOption {
  id: string
  title: string
  subtitle: string
  badge: string
  badgeTone: ClientBadgeTone
  icon: React.ComponentType<{ className?: string }>
  onClick: (params: { navigate: (view: string) => void; openQuote: () => void }) => void
}

const BADGE_STYLES: Record<ClientBadgeTone, string> = {
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  purple: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  neutral: "bg-muted/80 text-muted-foreground border-border/50",
}

export const CLIENT_ACTION_OPTIONS: ClientActionOption[] = [
  {
    id: "search-map",
    title: "Buscar Prestadores no Mapa",
    subtitle: "Encontre profissionais verificados mais próximos no radar de GV",
    badge: "Geolocalização",
    badgeTone: "emerald",
    icon: MapPin,
    onClick: ({ navigate }) => navigate("client.providers"),
  },
  {
    id: "express-quote",
    title: "Pedir Orçamento Rápido",
    subtitle: "Descreva o que precisa e receba propostas detalhadas em minutos",
    badge: "Grátis",
    badgeTone: "blue",
    icon: Sparkles,
    onClick: ({ openQuote }) => openQuote(),
  },
  {
    id: "bookings",
    title: "Meus Agendamentos",
    subtitle: "Acompanhe horários marcados, confirmações e deslocamento ao vivo",
    badge: "Atendimentos",
    badgeTone: "blue",
    icon: CalendarCheck,
    onClick: ({ navigate }) => navigate("client.bookings"),
  },
  {
    id: "quotes",
    title: "Orçamentos & Propostas",
    subtitle: "Compare valores recebidos, negocie condições e aprove em 1 toque",
    badge: "Propostas",
    badgeTone: "amber",
    icon: FileText,
    onClick: ({ navigate }) => navigate("client.quotes"),
  },
  {
    id: "services",
    title: "Catálogo de Serviços",
    subtitle: "Explore todas as especialidades, categorias e tabelas de referência",
    badge: "Catálogo",
    badgeTone: "neutral",
    icon: Wrench,
    onClick: ({ navigate }) => navigate("client.services"),
  },
  {
    id: "escrow-finance",
    title: "Pagamentos & Custódia",
    subtitle: "Valores retidos até você aprovar o serviço com garantia de 90 dias",
    badge: "Garantia 90D",
    badgeTone: "emerald",
    icon: ShieldCheck,
    onClick: ({ navigate }) => navigate("client.finance"),
  },
  {
    id: "rewards",
    title: "Clube de Benefícios",
    subtitle: "Pontue a cada serviço realizado e troque por cupons exclusivos",
    badge: "Vantagens VIP",
    badgeTone: "purple",
    icon: Award,
    onClick: ({ navigate }) => navigate("client.rewards"),
  },
  {
    id: "referral",
    title: "Indique e Ganhe",
    subtitle: "Convide amigos e familiares para ganhar créditos na sua carteira",
    badge: "Bônus",
    badgeTone: "rose",
    icon: Gift,
    onClick: ({ navigate }) => navigate("client.referral"),
  },
]

interface ClientQuickActionsHubProps {
  onNavigate: (view: string) => void
  onOpenQuote: () => void
}

export function ClientQuickActionsHub({ onNavigate, onOpenQuote }: ClientQuickActionsHubProps) {
  return (
    <section aria-label="Central de serviços e ações rápidas" className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground text-xs font-bold tracking-wide uppercase">
            Central de Serviços &amp; Acesso Rápido
          </h2>
          <p className="text-muted-foreground text-[11px]">
            Atalhos diretos para gerenciar seus atendimentos, orçamentos e benefícios
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {CLIENT_ACTION_OPTIONS.map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                action.onClick({ navigate: onNavigate, openQuote: onOpenQuote })
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
                    BADGE_STYLES[action.badgeTone],
                  )}
                >
                  {action.badge}
                </span>
              </div>

              <div className="mt-2 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <h3 className="text-foreground group-hover:text-primary truncate text-xs font-semibold transition-colors">
                    {action.title}
                  </h3>
                  <ChevronRight className="text-muted-foreground/60 group-hover:text-primary size-3 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[11px] leading-relaxed">
                  {action.subtitle}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
