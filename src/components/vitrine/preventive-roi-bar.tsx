"use client"

import * as React from "react"
import {
  TrendingDown,
  Droplets,
  Zap,
  Wind,
  Key,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  PiggyBank,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export type RoiCard = {
  id: string
  title: string
  icon: React.ComponentType<{ className?: string }>
  preventiveCost: number
  preventiveDesc: string
  riskCost: number
  riskDesc: string
  savings: number
  serviceQuery: string
}

const ROI_ITEMS: RoiCard[] = [
  {
    id: "vazamento",
    title: "Vazamento Oculto & Válvula de Descarga",
    icon: Droplets,
    preventiveCost: 60,
    preventiveDesc: "Troca preventiva de anel e vedação",
    riskCost: 380,
    riskDesc: "Conta da SAAE com até 4.000L de desperdício",
    savings: 320,
    serviceQuery: "Encanador",
  },
  {
    id: "eletrica",
    title: "Disjuntor Aquecendo & Tomadas Frouxas",
    icon: Zap,
    preventiveCost: 90,
    preventiveDesc: "Reaperto de barramento e troca de disjuntor",
    riskCost: 2400,
    riskDesc: "Queima de placa de ar-condicionado ou geladeira",
    savings: 2310,
    serviceQuery: "Eletricista",
  },
  {
    id: "ar-condicionado",
    title: "Filtro de Ar Obstruído & Serpentina Suja",
    icon: Wind,
    preventiveCost: 130,
    preventiveDesc: "Higienização profunda com bactericida",
    riskCost: 960,
    riskDesc: "+R$ 160/mês na Cemig + queima de compressor",
    savings: 830,
    serviceQuery: "Técnico de Ar-Condicionado",
  },
  {
    id: "fechadura",
    title: "Fechadura Engasgando & Trinco Desalinhado",
    icon: Key,
    preventiveCost: 50,
    preventiveDesc: "Regulagem de batente e lubrificação",
    riskCost: 250,
    riskDesc: "Chaveiro emergencial de madrugada no domingo",
    savings: 200,
    serviceQuery: "Chaveiro",
  },
]

export type PreventiveRoiBarProps = {
  onSelectService?: (serviceQuery: string) => void
  className?: string
}

export function PreventiveRoiBar({ onSelectService, className }: PreventiveRoiBarProps) {
  const totalSavings = React.useMemo(() => {
    return ROI_ITEMS.reduce((acc, curr) => acc + curr.savings, 0)
  }, [])

  return (
    <section className={cn("bg-background relative py-10", className)}>
      <div className="mx-auto w-full max-w-[95%] px-2 sm:px-4">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Badge
              variant="outline"
              className="mb-2 gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-xs font-bold text-emerald-800 dark:text-emerald-300"
            >
              <PiggyBank className="size-3.5 text-emerald-600" />
              <span>Calculadora de Prevenção Inteligente</span>
            </Badge>
            <h2 className="text-foreground text-2xl font-extrabold tracking-tight sm:text-3xl">
              Manutenção Preventiva vs Prejuízo em GV
            </h2>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              Pequenos consertos feitos a tempo evitam contas astronômicas e quebra de eletros.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5">
            <TrendingDown className="size-7 shrink-0 text-emerald-600" />
            <div>
              <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                Economia Total Estimada
              </p>
              <p className="text-lg font-black text-emerald-700 dark:text-emerald-400">
                Até R$ {totalSavings.toLocaleString("pt-BR")}
              </p>
            </div>
          </div>
        </div>

        {/* 4 Comparison Cards */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {ROI_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <div
                key={item.id}
                className="bg-card border-border/70 hover:border-primary/40 flex flex-col justify-between rounded-2xl border p-5 shadow-xs transition-all hover:shadow-md"
              >
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="bg-primary/10 text-primary rounded-xl p-2">
                      <Icon className="size-4" />
                    </span>
                    <h3 className="text-foreground line-clamp-1 text-sm font-bold">{item.title}</h3>
                  </div>

                  {/* Contrast Bars */}
                  <div className="mt-4 space-y-3">
                    {/* Preventive (Green) */}
                    <div className="rounded-xl border border-emerald-300/80 bg-emerald-50/50 p-2.5 dark:border-emerald-900/60 dark:bg-emerald-950/30">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1 font-bold text-emerald-800 dark:text-emerald-300">
                          <CheckCircle2 className="size-3.5 text-emerald-600" />
                          Prevenção Hoje:
                        </span>
                        <span className="font-black text-emerald-700 dark:text-emerald-400">
                          R$ {item.preventiveCost}
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-1 line-clamp-1 text-[10px]">
                        {item.preventiveDesc}
                      </p>
                    </div>

                    {/* Risk (Red) */}
                    <div className="rounded-xl border border-rose-200/80 bg-rose-50/40 p-2.5 dark:border-rose-950/60 dark:bg-rose-950/20">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1 font-bold text-rose-700 dark:text-rose-400">
                          <AlertTriangle className="size-3.5 text-rose-600" />
                          Risco se Adiar:
                        </span>
                        <span className="font-black text-rose-600 dark:text-rose-400">
                          R$ {item.riskCost}
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-1 line-clamp-1 text-[10px]">
                        {item.riskDesc}
                      </p>
                    </div>
                  </div>

                  {/* Savings Tag */}
                  <div className="bg-muted/40 mt-3.5 rounded-lg border border-emerald-500/20 px-2 py-1 text-center text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                    Você economiza: R$ {item.savings}
                  </div>
                </div>

                <div className="border-border/50 mt-5 border-t pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (onSelectService) onSelectService(item.serviceQuery)
                    }}
                    className="w-full cursor-pointer gap-1 text-xs font-bold"
                  >
                    <span>Prevenir com Especialista</span>
                    <ArrowRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export default PreventiveRoiBar
