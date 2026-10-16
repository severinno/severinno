"use client"

import * as React from "react"
import { ShieldCheck, FileCheck2, Scale, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { GvTransparencyBoard } from "./gv-transparency-board"
import { DigitalContractGenerator } from "./digital-contract-generator"
import { TrustComparisonTable } from "./trust-comparison-table"

export type TrustShieldHubTab = "transparency" | "contract" | "comparison"

export type TrustShieldHubProps = {
  onLearnMoreEscrow?: () => void
  onExploreProtectedProviders?: () => void
  initialTab?: TrustShieldHubTab
  className?: string
}

const TABS: { id: TrustShieldHubTab; label: string; icon: React.ElementType; badge: string }[] = [
  {
    id: "transparency",
    label: "Central de Integridade GV",
    icon: ShieldCheck,
    badge: "100% Auditado",
  },
  {
    id: "contract",
    label: "Contrato Digital & Recibo",
    icon: FileCheck2,
    badge: "Validade Jurídica",
  },
  {
    id: "comparison",
    label: "Boca a Boca vs Severinno",
    icon: Scale,
    badge: "Zero Risco",
  },
]

export function TrustShieldHub({
  onLearnMoreEscrow,
  onExploreProtectedProviders,
  initialTab = "transparency",
  className,
}: TrustShieldHubProps) {
  const [activeTab, setActiveTab] = React.useState<TrustShieldHubTab>(initialTab)

  return (
    <section
      aria-label="Central de Segurança Jurídica, Garantia e Integridade em Governador Valadares"
      className={cn("mx-auto my-12 w-full max-w-[95%] px-2 sm:px-4", className)}
    >
      {/* Header com Navegação em Abas */}
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3.5 py-1 text-xs font-bold text-blue-700 dark:text-blue-400">
          <Sparkles className="size-3.5" />
          <span>Blindagem Residencial Completa • Governador Valadares</span>
        </div>
        <h2 className="mt-2.5 text-2xl font-black tracking-tight sm:text-3xl lg:text-4xl">
          Segurança Jurídica & Transparência Inegociável
        </h2>
        <p className="text-muted-foreground mt-1.5 max-w-2xl text-xs sm:text-sm">
          Entenda como eliminamos o risco de calotes, abandono de obra e prestadores desqualificados
          com verificação criminal, custódia financeira e pré-contrato oficial.
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
                    ? "scale-[1.02] bg-blue-600 text-white shadow-md ring-2 ring-blue-500/30"
                    : "text-muted-foreground hover:bg-background/80 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span>{tab.label}</span>
                <span
                  className={cn(
                    "hidden rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase sm:inline-block",
                    active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground",
                  )}
                >
                  {tab.badge}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Conteúdo Ativo */}
      <div className="relative">
        {activeTab === "transparency" && (
          <div className="animate-in fade-in duration-300">
            <GvTransparencyBoard onLearnMore={onLearnMoreEscrow} className="my-0 max-w-full" />
          </div>
        )}

        {activeTab === "contract" && (
          <div className="animate-in fade-in duration-300">
            <DigitalContractGenerator
              onExploreProtectedProviders={onExploreProtectedProviders}
              className="my-0 max-w-full"
            />
          </div>
        )}

        {activeTab === "comparison" && (
          <div className="animate-in fade-in duration-300">
            <TrustComparisonTable
              onCtaClick={onExploreProtectedProviders}
              className="my-0 max-w-full px-0"
            />
          </div>
        )}
      </div>
    </section>
  )
}
export default TrustShieldHub
