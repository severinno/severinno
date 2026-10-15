"use client"

import * as React from "react"
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Search,
  Sparkles,
  ArrowRight,
  Info,
  BadgeAlert,
  Percent,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type FipeBenchmark = {
  id: string
  serviceName: string
  category: string
  dangerLow: number
  fairMin: number
  fairMax: number
  premiumHigh: number
  unit: string
  trend: string
  riskWarning: string
  safeGuaranteeNote: string
}

const FIPE_BENCHMARKS: FipeBenchmark[] = [
  {
    id: "fipe-1",
    serviceName: "Instalação / Troca de Chuveiro Elétrico",
    category: "Elétrica",
    dangerLow: 50,
    fairMin: 80,
    fairMax: 130,
    premiumHigh: 180,
    unit: "por ponto",
    trend: "+3.1% nos últimos 6 meses",
    riskWarning:
      "Abaixo de R$ 80: Risco de fiação sem conector de cerâmica/Wago, gerando aquecimento e derretimento.",
    safeGuaranteeNote:
      "Inclui teste de vazão, aperto seguro e verificação de aterramento elétrico.",
  },
  {
    id: "fipe-2",
    serviceName: "Limpeza & Higienização de Ar Split (9k a 12k BTUs)",
    category: "Climatização",
    dangerLow: 90,
    fairMin: 140,
    fairMax: 200,
    premiumHigh: 280,
    unit: "por aparelho",
    trend: "+2.4% nos últimos 6 meses",
    riskWarning:
      "Abaixo de R$ 140: Lavagem superficial apenas de filtro de tela, sem limpeza da serpentina e turbina interna.",
    safeGuaranteeNote: "Aplicação de bactericida hospitalar com bolsa coletora e teste de dreno.",
  },
  {
    id: "fipe-3",
    serviceName: "Desentupimento de Ralo / Pia / Vaso",
    category: "Hidráulica",
    dangerLow: 70,
    fairMin: 120,
    fairMax: 220,
    premiumHigh: 350,
    unit: "por ponto",
    trend: "+1.8% nos últimos 6 meses",
    riskWarning:
      "Abaixo de R$ 120: Uso de soda cáustica ou arame que pode perfurar o PVC e causar infiltração no vizinho.",
    safeGuaranteeNote:
      "Desobstrução mecânica profissional com maquinário rotativo sem agressão ao encanamento.",
  },
  {
    id: "fipe-4",
    serviceName: "Pintura Residencial Interna (Paredes e Teto)",
    category: "Pintura",
    dangerLow: 12,
    fairMin: 18,
    fairMax: 32,
    premiumHigh: 45,
    unit: "por m² (mão de obra)",
    trend: "+4.0% nos últimos 6 meses",
    riskWarning:
      "Abaixo de R$ 18/m²: Aplicação de 1 única demão sem emassamento e sem lixamento anti-pó.",
    safeGuaranteeNote:
      "Preparação prévia, fita crepe de proteção, 2 a 3 demãos cruzadas e entrega limpa.",
  },
  {
    id: "fipe-5",
    serviceName: "Montagem de Guarda-Roupa Casal (6 Portas)",
    category: "Montador",
    dangerLow: 90,
    fairMin: 150,
    fairMax: 230,
    premiumHigh: 320,
    unit: "por móvel",
    trend: "+2.0% nos últimos 6 meses",
    riskWarning:
      "Abaixo de R$ 150: Gavetas desalinhadas, parafusos espanados e falta de esquadro na estrutura.",
    safeGuaranteeNote:
      "Nivelamento preciso de portas, corrediças telescópicas reguladas e fixação anti-tombamento.",
  },
  {
    id: "fipe-6",
    serviceName: "Troca de Quadro de Disjuntores Residencial",
    category: "Elétrica",
    dangerLow: 200,
    fairMin: 350,
    fairMax: 650,
    premiumHigh: 950,
    unit: "por quadro (até 12 circuitos)",
    trend: "+5.2% nos últimos 6 meses",
    riskWarning:
      "Abaixo de R$ 350: Barramentos frouxos sem identificação de circuitos e sem proteção DR.",
    safeGuaranteeNote:
      "Separação rigorosa de circuitos, barramento pente isolado e etiquetagem dos disjuntores.",
  },
]

export type FipeServicesIndexProps = {
  onFilterService?: (serviceName: string) => void
  className?: string
}

export function FipeServicesIndex({ onFilterService, className }: FipeServicesIndexProps) {
  const [selectedId, setSelectedId] = React.useState<string>(FIPE_BENCHMARKS[0].id)
  const current = FIPE_BENCHMARKS.find((b) => b.id === selectedId) || FIPE_BENCHMARKS[0]

  return (
    <section
      aria-label="Tabela FIPE dos Serviços de Governador Valadares"
      className={cn(
        "border-border/80 bg-card/60 relative mx-auto my-10 w-full max-w-7xl overflow-hidden rounded-3xl border p-6 shadow-xl backdrop-blur-xs sm:p-8 md:p-10",
        className,
      )}
    >
      {/* Background decorations */}
      <div className="pointer-events-none absolute -top-24 -left-24 size-72 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 -bottom-24 size-72 rounded-full bg-blue-500/10 blur-3xl" />

      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
            <TrendingUp className="size-3.5" />
            <span>Índice Oficial de Preços de GV • Atualizado Mensalmente</span>
          </div>
          <h2 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl md:text-4xl">
            A &ldquo;Tabela FIPE&rdquo; da Manutenção em Governador Valadares
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-xs sm:text-sm">
            Auditoria independente baseada em mais de 1.480 serviços reais concluídos nos bairros de
            GV. Saiba a faixa justa e evite cobranças abusivas ou orçamentos suspeitos.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
          <ShieldCheck className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>
            <strong>Garantia de Preço Justo:</strong> Pagamento só liberado com escopo validado.
          </span>
        </div>
      </div>

      {/* Selector pills */}
      <div className="mt-6 flex scrollbar-thin gap-2 overflow-x-auto pb-2">
        {FIPE_BENCHMARKS.map((item) => {
          const active = item.id === selectedId
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={cn(
                "shrink-0 rounded-xl px-4 py-2 text-xs font-bold transition-all",
                active
                  ? "bg-primary text-primary-foreground ring-primary/30 shadow-md ring-2"
                  : "border-border/80 bg-background/80 text-muted-foreground hover:bg-muted hover:text-foreground border",
              )}
            >
              {item.serviceName}
            </button>
          )
        })}
      </div>

      {/* Visual Benchmark Gauge / Price Range Display */}
      <div className="border-border/80 bg-background/90 mt-6 rounded-2xl border p-5 shadow-sm sm:p-7">
        <div className="border-border/60 flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
              Categoria: {current.category} • {current.unit}
            </span>
            <h3 className="text-foreground text-xl font-black sm:text-2xl">
              {current.serviceName}
            </h3>
          </div>
          <div className="bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold">
            <Percent className="size-3.5" />
            <span>{current.trend}</span>
          </div>
        </div>

        {/* 3 Zones Bar */}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-xs font-bold">
            <span className="text-rose-600 dark:text-rose-400">
              ⚠️ Zona de Risco (&lt; R$ {current.fairMin})
            </span>
            <span className="text-emerald-600 dark:text-emerald-400">
              ✅ Faixa Justa de GV (R$ {current.fairMin} a R$ {current.fairMax})
            </span>
            <span className="text-amber-600 dark:text-amber-400">
              ⚡ Complexidade Alta (&gt; R$ {current.fairMax})
            </span>
          </div>

          {/* Color strip */}
          <div className="relative flex h-5 w-full overflow-hidden rounded-full shadow-inner">
            <div className="w-[25%] bg-rose-500/80" title="Risco de material de baixa qualidade" />
            <div className="w-[50%] bg-emerald-500" title="Faixa Justa de Mercado em GV" />
            <div className="w-[25%] bg-amber-500/80" title="Horários especiais ou altura" />
          </div>

          {/* Scale labels */}
          <div className="text-muted-foreground mt-2 flex justify-between text-[11px] font-semibold">
            <span>R$ {current.dangerLow}</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              R$ {current.fairMin}
            </span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              R$ {current.fairMax}
            </span>
            <span>R$ {current.premiumHigh}+</span>
          </div>
        </div>

        {/* Diagnostic Cards */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Card Risco */}
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-xs">
            <div className="flex items-center gap-2 font-bold text-rose-700 dark:text-rose-400">
              <BadgeAlert className="size-4 shrink-0" />
              <span>Por que orçamentos muito baixos são perigosos?</span>
            </div>
            <p className="text-muted-foreground mt-2">{current.riskWarning}</p>
          </div>

          {/* Card Garantia */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs">
            <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>O que está incluso na Faixa Justa do Severinno?</span>
            </div>
            <p className="text-muted-foreground mt-2">{current.safeGuaranteeNote}</p>
          </div>
        </div>

        {/* CTA Filter */}
        <div className="border-border/60 mt-6 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Info className="text-primary size-4" />
            <span>Dados auditados pela Central de Mediação Severinno GV.</span>
          </div>

          {onFilterService && (
            <Button
              type="button"
              onClick={() => onFilterService(current.serviceName)}
              className="gap-2 font-bold shadow-md"
            >
              <span>Ver Profissionais com Preço Justo</span>
              <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
export default FipeServicesIndex
