"use client"

import * as React from "react"
import {
  Wrench,
  Sparkles,
  HardHat,
  PaintRoller,
  Trees,
  Truck,
  Siren,
  ArrowRight,
  ShieldCheck,
  Clock,
  Users,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Category } from "@/lib/api"

export type CategoryGridSectionProps = {
  categories: Category[]
  activeId: string | null
  onSelect: (id: string | null) => void
  onEmergencyClick?: () => void
  className?: string
}

type PillarConfig = {
  slug: string
  name: string
  subtitle: string
  icon: typeof Wrench
  color: string
  bgColor: string
  badgeColor: string
  eta: string
  providersEstimate: string
  quickTags: string[]
}

const PILLARS_CONFIG: PillarConfig[] = [
  {
    slug: "emergencia-24h",
    name: "Emergência 24h",
    subtitle: "Vazamento, curto-circuito, chaveiro ou desentupimento agora",
    icon: Siren,
    color: "text-rose-600 dark:text-rose-400",
    bgColor: "bg-rose-50/80 dark:bg-rose-950/30 border-rose-200/80 dark:border-rose-900/50",
    badgeColor: "bg-rose-600 text-white",
    eta: "Chegada em 15-30 min",
    providersEstimate: "Plantão 24h em GV",
    quickTags: ["Encanador 24h", "Eletricista 24h", "Chaveiro", "Desentupir"],
  },
  {
    slug: "reparos-e-instalacoes",
    name: "Reparos & Instalações",
    subtitle: "Elétrica, encanador, ar-condicionado e pequenos consertos",
    icon: Wrench,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50/60 dark:bg-blue-950/20 border-blue-200/60 dark:border-blue-900/40",
    badgeColor: "bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300",
    eta: "Atendimento hoje",
    providersEstimate: "180+ prestadores",
    quickTags: ["Tomadas & Disjuntores", "Chuveiro", "Ar Condicionado", "Torneiras"],
  },
  {
    slug: "limpeza-e-casa",
    name: "Limpeza & Cuidados",
    subtitle: "Diaristas, pós-obra, passadoria e higienização residencial",
    icon: Sparkles,
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor:
      "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-900/40",
    badgeColor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300",
    eta: "Agendamento flexível",
    providersEstimate: "270+ profissionais",
    quickTags: ["Faxina Completa", "Pós-Obra", "Passadeira", "Sanitização"],
  },
  {
    slug: "reforma-e-construcao",
    name: "Reforma & Obras",
    subtitle: "Pedreiros, azulejistas, drywall, pisos e regularização",
    icon: HardHat,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-900/40",
    badgeColor: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300",
    eta: "Orçamento sem custo",
    providersEstimate: "140+ especialistas",
    quickTags: ["Alvenaria", "Assentar Piso", "Gesso", "Demolição"],
  },
  {
    slug: "acabamento-e-decoracao",
    name: "Acabamento & Pintura",
    subtitle: "Pintores, gesso, marcenaria, vidros e tapeçaria",
    icon: PaintRoller,
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50/60 dark:bg-purple-950/20 border-purple-200/60 dark:border-purple-900/40",
    badgeColor: "bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-300",
    eta: "Laudo com garantia",
    providersEstimate: "60+ profissionais",
    quickTags: ["Pintura Interna", "Texturas", "Marceneiro", "Estofados"],
  },
  {
    slug: "jardim-e-piscina",
    name: "Jardim & Piscina",
    subtitle: "Corte de grama, podas de árvores, limpeza e químicos de piscina",
    icon: Trees,
    color: "text-teal-600 dark:text-teal-400",
    bgColor: "bg-teal-50/60 dark:bg-teal-950/20 border-teal-200/60 dark:border-teal-900/40",
    badgeColor: "bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-300",
    eta: "Atendimento semanal",
    providersEstimate: "40+ prestadores",
    quickTags: ["Manutenção Grama", "Limpeza Piscina", "Paisagismo", "Adubação"],
  },
  {
    slug: "mudanca-e-organizacao",
    name: "Mudança & Fretes",
    subtitle: "Transporte com proteção, içamento de móveis e montadores",
    icon: Truck,
    color: "text-indigo-600 dark:text-indigo-400",
    bgColor: "bg-indigo-50/60 dark:bg-indigo-950/20 border-indigo-200/60 dark:border-indigo-900/40",
    badgeColor: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300",
    eta: "Veículos rastreados",
    providersEstimate: "45+ fretes",
    quickTags: ["Carreto Local", "Montador de Móveis", "Embalagem", "Içamento"],
  },
]

export function CategoryGridSection({
  categories,
  activeId,
  onSelect,
  onEmergencyClick,
  className,
}: CategoryGridSectionProps) {
  // Mapear categorias reais por slug
  const categoryMap = React.useMemo(() => {
    const map = new Map<string, Category>()
    for (const cat of categories) {
      map.set(cat.slug, cat)
    }
    return map
  }, [categories])

  return (
    <section className={cn("bg-muted/20 border-border/40 border-b py-12", className)}>
      <div className="mx-auto w-full max-w-[95%] px-2 sm:px-4">
        {/* Header persuasivo */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="bg-primary/10 text-primary mb-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold">
              <ShieldCheck className="size-3.5" />
              <span>Profissionais Verificados em Governador Valadares</span>
            </div>
            <h2 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
              O que você precisa resolver hoje?
            </h2>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              Escolha uma categoria para ver profissionais disponíveis no seu bairro com garantia de
              custódia e orçamento gratuito.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-primary flex shrink-0 items-center gap-1 text-xs font-semibold hover:underline"
          >
            <span>Ver todos os profissionais</span>
            <ArrowRight className="size-3.5" />
          </button>
        </div>

        {/* Grid de Alta Conversão */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {PILLARS_CONFIG.map((pillar) => {
            const realCat = categoryMap.get(pillar.slug)
            const Icon = pillar.icon
            const isEmergency = pillar.slug === "emergencia-24h"
            const isSelected = activeId === realCat?.id

            return (
              <div
                key={pillar.slug}
                onClick={() => {
                  if (isEmergency && onEmergencyClick) {
                    onEmergencyClick()
                  } else if (realCat) {
                    onSelect(isSelected ? null : realCat.id)
                  }
                }}
                className={cn(
                  "group relative flex cursor-pointer flex-col justify-between rounded-2xl border p-5 text-left transition-all duration-200",
                  pillar.bgColor,
                  isSelected
                    ? "ring-primary scale-[1.01] shadow-md ring-2"
                    : "hover:border-foreground/20 hover:-translate-y-0.5 hover:shadow-lg",
                  isEmergency &&
                    "border-rose-400 shadow-sm shadow-rose-500/10 dark:border-rose-800",
                )}
              >
                {/* Top badges & Icon */}
                <div>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div
                      className={cn(
                        "flex size-11 items-center justify-center rounded-xl transition-transform group-hover:scale-110",
                        isEmergency
                          ? "bg-rose-600 text-white shadow-md shadow-rose-600/30"
                          : "bg-card shadow-xs",
                      )}
                    >
                      <Icon className={cn("size-6", isEmergency ? "text-white" : pillar.color)} />
                    </div>

                    {isEmergency ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-2.5 py-1 text-[10px] font-bold tracking-wider text-white uppercase shadow-xs">
                        <span className="size-1.5 animate-ping rounded-full bg-white" />
                        SOS Plantão
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                          pillar.badgeColor,
                        )}
                      >
                        <Users className="size-3" />
                        {pillar.providersEstimate}
                      </span>
                    )}
                  </div>

                  {/* Title & Subtitle */}
                  <h3 className="text-foreground group-hover:text-primary flex items-center gap-1.5 text-base font-bold transition-colors">
                    {pillar.name}
                    {isEmergency && <span className="size-2 rounded-full bg-rose-500" />}
                  </h3>
                  <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
                    {pillar.subtitle}
                  </p>
                </div>

                {/* Quick tags & ETA Footer */}
                <div className="border-border/40 mt-4 border-t pt-3">
                  <div className="mb-3 flex flex-wrap gap-1">
                    {pillar.quickTags.map((tag) => (
                      <span
                        key={tag}
                        className="bg-background/80 text-foreground/80 border-border/40 rounded-md border px-2 py-0.5 text-[10px] font-medium"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                    <span className="text-foreground/80 flex items-center gap-1 font-medium">
                      <Clock className="text-primary size-3" />
                      {pillar.eta}
                    </span>
                    <span className="text-primary inline-flex items-center gap-0.5 font-semibold transition-transform group-hover:translate-x-0.5">
                      {isEmergency ? "Chamar Agora" : "Ver Opções"}
                      <ArrowRight className="size-3" />
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
export default CategoryGridSection
