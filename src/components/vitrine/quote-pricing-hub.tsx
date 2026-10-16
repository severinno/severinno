"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { Calculator, TrendingUp, PiggyBank, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

const InstantQuoteStepWizard = dynamic(
  () => import("./instant-quote-step-wizard").then((m) => m.InstantQuoteStepWizard),
  {
    ssr: false,
    loading: () => <div className="bg-muted/60 h-64 w-full animate-pulse rounded-2xl" />,
  },
)

const FipeServicesIndex = dynamic(
  () => import("./fipe-services-index").then((m) => m.FipeServicesIndex),
  {
    ssr: false,
    loading: () => <div className="bg-muted/60 h-64 w-full animate-pulse rounded-2xl" />,
  },
)

const PreventiveRoiBar = dynamic(
  () => import("./preventive-roi-bar").then((m) => m.PreventiveRoiBar),
  {
    ssr: false,
    loading: () => <div className="bg-muted/60 h-64 w-full animate-pulse rounded-2xl" />,
  },
)

export type QuotePricingHubTab = "wizard" | "fipe" | "roi"

export type QuotePricingHubProps = {
  onSearchService?: (serviceQuery: string) => void
  initialTab?: QuotePricingHubTab
  className?: string
}

const TABS: { id: QuotePricingHubTab; label: string; icon: React.ElementType; badge: string }[] = [
  {
    id: "wizard",
    label: "Orçamentômetro WhatsApp",
    icon: Calculator,
    badge: "Disparo em 30s",
  },
  {
    id: "fipe",
    label: "Tabela FIPE dos Serviços GV",
    icon: TrendingUp,
    badge: "Preço Justo",
  },
  {
    id: "roi",
    label: "Prevenção vs Prejuízo",
    icon: PiggyBank,
    badge: "Economia Real",
  },
]

export function QuotePricingHub({
  onSearchService,
  initialTab = "wizard",
  className,
}: QuotePricingHubProps) {
  const [activeTab, setActiveTab] = React.useState<QuotePricingHubTab>(initialTab)

  return (
    <section
      aria-label="Central de Cotação Inteligente e Preço Justo em Governador Valadares"
      className={cn("mx-auto my-12 w-full max-w-[95%] px-2 sm:px-4", className)}
    >
      {/* Header com Navegação em Abas */}
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="border-primary/30 bg-primary/10 text-primary inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-xs font-bold">
          <Sparkles className="size-3.5" />
          <span>Hub de Inteligência Financeira Residencial • GV</span>
        </div>
        <h2 className="mt-2.5 text-2xl font-black tracking-tight sm:text-3xl lg:text-4xl">
          Cotação Rápida & Preço Justo de Mercado
        </h2>
        <p className="text-muted-foreground mt-1.5 max-w-2xl text-xs sm:text-sm">
          Descubra o valor médio de mercado em GV, simule economias preventivas ou dispare um pedido
          formatado diretamente para prestadores verificados.
        </p>

        {/* Tab Switcher Pills */}
        <div className="border-border/80 bg-muted/40 mt-6 flex flex-wrap justify-center gap-2 rounded-2xl border p-1.5 backdrop-blur-xs">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all duration-200",
                  active
                    ? "bg-primary text-primary-foreground ring-primary/20 scale-[1.02] shadow-md ring-2"
                    : "text-muted-foreground hover:bg-background/80 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span>{tab.label}</span>
                <span
                  className={cn(
                    "hidden rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase sm:inline-block",
                    active
                      ? "text-primary-foreground bg-white/20"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {tab.badge}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Conteúdo Ativo com Transição Suave */}
      <div className="relative">
        {activeTab === "wizard" && (
          <div className="animate-in fade-in duration-300">
            <InstantQuoteStepWizard onFilterResults={onSearchService} className="my-0 max-w-full" />
          </div>
        )}

        {activeTab === "fipe" && (
          <div className="animate-in fade-in duration-300">
            <FipeServicesIndex onFilterService={onSearchService} className="my-0 max-w-full" />
          </div>
        )}

        {activeTab === "roi" && (
          <div className="animate-in fade-in duration-300">
            <PreventiveRoiBar onSelectService={onSearchService} className="my-0 max-w-full" />
          </div>
        )}
      </div>
    </section>
  )
}
export default QuotePricingHub
