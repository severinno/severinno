"use client"

/**
 * AdminCommandHub — Central de Operações & Acesso Rápido do Painel Admin.
 *
 * Apresenta cards interativos com as principais verticais operacionais e
 * de inteligência da plataforma Severinno, permitindo navegação em 1 clique
 * e resumo visual das capacidades do marketplace.
 */

import * as React from "react"
import {
  Activity,
  BellRing,
  ChevronRight,
  Layers,
  MapPin,
  MessageSquare,
  Radio,
  Scale,
  ShieldCheck,
  Wallet,
} from "lucide-react"

import { triggerHaptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

export type BadgeTone = "emerald" | "blue" | "amber" | "purple" | "rose" | "neutral"

export interface AdminCommandOption {
  id: string
  title: string
  subtitle: string
  badge: string
  badgeTone: BadgeTone
  icon: React.ComponentType<{ className?: string }>
  view: string
}

export const ADMIN_COMMAND_OPTIONS: AdminCommandOption[] = [
  {
    id: "operations",
    title: "Torre de Controle Operacional",
    subtitle: "Rastreamento ao vivo, 20 bairros de GV e telemetria de atendimentos",
    badge: "Tempo Real",
    badgeTone: "emerald",
    icon: Radio,
    view: "admin.operations",
  },
  {
    id: "verifications",
    title: "Conformidade & KYC",
    subtitle: "Validação de identidade, selfie, antecedentes e aprovação de prestadores",
    badge: "Auditoria",
    badgeTone: "blue",
    icon: ShieldCheck,
    view: "admin.verifications",
  },
  {
    id: "settlements",
    title: "Custódia & Repasses PIX",
    subtitle: "Liberação de valores retidos em escrow e liquidação para prestadores",
    badge: "Financeiro",
    badgeTone: "emerald",
    icon: Wallet,
    view: "admin.settlements",
  },
  {
    id: "disputes",
    title: "Mediação de Disputas",
    subtitle: "Arbitragem de conflitos, split de valores e garantia de 90 dias",
    badge: "Garantia",
    badgeTone: "amber",
    icon: Scale,
    view: "admin.disputes",
  },
  {
    id: "whatsapp",
    title: "WhatsApp & Automações",
    subtitle: "Instância Evolution API, mensagens transacionais e status de conexão",
    badge: "Mensageria",
    badgeTone: "emerald",
    icon: MessageSquare,
    view: "admin.whatsapp",
  },
  {
    id: "push",
    title: "Campanhas Push",
    subtitle: "Notificações direcionadas, réguas de reengajamento e métricas de envio",
    badge: "Engajamento",
    badgeTone: "purple",
    icon: BellRing,
    view: "admin.push",
  },
  {
    id: "coverage",
    title: "Cobertura & Demanda GV",
    subtitle: "Polígonos de atendimento, raios de cobertura e calor de busca",
    badge: "Inteligência Geo",
    badgeTone: "blue",
    icon: MapPin,
    view: "admin.coverage",
  },
  {
    id: "taxonomy",
    title: "Taxonomia & Catálogo",
    subtitle: "Categorias, níveis de especialidade e tabela referencial de serviços",
    badge: "Catálogo",
    badgeTone: "neutral",
    icon: Layers,
    view: "admin.taxonomy",
  },
  {
    id: "health",
    title: "Saúde & Confiabilidade",
    subtitle: "PgBouncer, Redis Valkey, OSRM, modo manutenção e telemetria",
    badge: "DevOps",
    badgeTone: "rose",
    icon: Activity,
    view: "admin.health",
  },
]

const BADGE_STYLES: Record<BadgeTone, string> = {
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  purple: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  neutral: "bg-muted/80 text-muted-foreground border-border/50",
}

export function AdminCommandHub({ onNavigate }: { onNavigate: (view: string) => void }) {
  return (
    <section aria-label="Central de operações e acesso rápido" className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground text-xs font-bold tracking-wide uppercase">
            Central de Operações &amp; Acesso Rápido
          </h2>
          <p className="text-muted-foreground text-[11px]">
            Acesso direto às principais ferramentas de gestão e controle da plataforma
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {ADMIN_COMMAND_OPTIONS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onNavigate(item.view)
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
