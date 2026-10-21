import { SUPPORT_WHATSAPP } from "@/lib/constants"
;("use client")

import * as React from "react"
import {
  Calculator,
  MapPin,
  Wrench,
  ShieldCheck,
  Clock,
  ArrowRight,
  MessageCircle,
  Sparkles,
  TrendingUp,
  Percent,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useRegionalContext } from "@/hooks/use-regional-context"

export type NeighborhoodPriceSimulatorProps = {
  onQuote: (serviceName: string, district: string) => void
  className?: string
}

const GV_NEIGHBORHOODS = [
  "Centro",
  "Ilha dos Araújos",
  "Grã-Duquesa",
  "São Pedro",
  "Vila Isa",
  "Santa Rita",
  "Esplanada",
  "Lourdes",
  "Morada do Vale",
  "Esperança",
  "Vila Bretas",
  "Altinópolis",
  "Biquinhas",
  "Castírio",
]

type ScopeKey = "simple" | "standard" | "complete"

type ScopeOption = {
  id: ScopeKey
  label: string
  sublabel: string
  multiplier: number
}

const SCOPE_OPTIONS: ScopeOption[] = [
  { id: "simple", label: "Básico", sublabel: "1 ponto / reparo rápido", multiplier: 1.0 },
  { id: "standard", label: "Padrão", sublabel: "Cômodo / 2-3 pontos", multiplier: 1.35 },
  { id: "complete", label: "Completo", sublabel: "Revisão geral / urgência", multiplier: 1.8 },
]

type ServiceEstimate = {
  id: string
  name: string
  category: string
  minPrice: number
  maxPrice: number
  unit: string
  etaMinutes: number
  description: string
  benchmarkPct: number
}

const SERVICE_ESTIMATES: ServiceEstimate[] = [
  {
    id: "ar-condicionado",
    name: "Técnico de Ar-Condicionado",
    category: "Reparos e Instalações",
    minPrice: 130,
    maxPrice: 190,
    unit: "serviço / ponto",
    etaMinutes: 25,
    description: "Limpeza profunda, higienização com bactericida ou recarga de gás.",
    benchmarkPct: 78,
  },
  {
    id: "eletricista",
    name: "Eletricista Residencial",
    category: "Reparos e Instalações",
    minPrice: 60,
    maxPrice: 130,
    unit: "ponto / reparo",
    etaMinutes: 20,
    description: "Troca de chuveiro, disjuntores, tomadas e conserto de curto-circuito.",
    benchmarkPct: 82,
  },
  {
    id: "encanador",
    name: "Encanador / Desentupimento",
    category: "Reparos e Instalações",
    minPrice: 80,
    maxPrice: 160,
    unit: "reparo",
    etaMinutes: 20,
    description: "Vazamentos, troca de torneiras, reparo de caixa acoplada e sifão.",
    benchmarkPct: 75,
  },
  {
    id: "pintor",
    name: "Pintor Residencial",
    category: "Reforma e Construção",
    minPrice: 180,
    maxPrice: 350,
    unit: "cômodo / dia",
    etaMinutes: 30,
    description: "Preparação de paredes, massa corrida e pintura premium.",
    benchmarkPct: 71,
  },
  {
    id: "diarista",
    name: "Diarista / Faxina Residencial",
    category: "Limpeza e Casa",
    minPrice: 150,
    maxPrice: 190,
    unit: "diária padrão",
    etaMinutes: 35,
    description: "Limpeza completa, organização e faxina pós-evento com referências checadas.",
    benchmarkPct: 88,
  },
  {
    id: "estofados",
    name: "Higienização de Sofás & Colchões",
    category: "Acabamento e Decoração",
    minPrice: 160,
    maxPrice: 220,
    unit: "sofá / colchão",
    etaMinutes: 30,
    description: "Lavagem profunda com extratora e secagem rápida no local.",
    benchmarkPct: 79,
  },
  {
    id: "chaveiro",
    name: "Chaveiro 24 Horas",
    category: "Emergência 24h",
    minPrice: 70,
    maxPrice: 140,
    unit: "abertura / cópia",
    etaMinutes: 15,
    description: "Abertura emergencial residencial e automotiva sem danificar fechadura.",
    benchmarkPct: 84,
  },
  {
    id: "montador",
    name: "Montador de Móveis",
    category: "Montagem e Reparos",
    minPrice: 70,
    maxPrice: 150,
    unit: "móvel / montagem",
    etaMinutes: 25,
    description: "Montagem e regulagem de armários, mesas, racks e painéis com nível.",
    benchmarkPct: 80,
  },
]

export function NeighborhoodPriceSimulator({
  onQuote,
  className,
}: NeighborhoodPriceSimulatorProps) {
  const { context: regionalContext } = useRegionalContext()
  const city = regionalContext?.city || "Governador Valadares"
  const neighborhoods =
    regionalContext?.neighborhoods && regionalContext.neighborhoods.length > 0
      ? regionalContext.neighborhoods
      : GV_NEIGHBORHOODS

  const [userNeighborhood, setUserNeighborhood] = React.useState<string>("")
  const selectedNeighborhood =
    userNeighborhood && neighborhoods.includes(userNeighborhood)
      ? userNeighborhood
      : neighborhoods[0] || "Centro"

  const [selectedServiceId, setSelectedServiceId] = React.useState("ar-condicionado")
  const [selectedScope, setSelectedScope] = React.useState<ScopeKey>("simple")

  const currentService = React.useMemo(() => {
    return SERVICE_ESTIMATES.find((s) => s.id === selectedServiceId) || SERVICE_ESTIMATES[0]
  }, [selectedServiceId])

  const currentScope = React.useMemo(() => {
    return SCOPE_OPTIONS.find((sc) => sc.id === selectedScope) || SCOPE_OPTIONS[0]
  }, [selectedScope])

  const calculatedMin = Math.round(currentService.minPrice * currentScope.multiplier)
  const calculatedMax = Math.round(currentService.maxPrice * currentScope.multiplier)
  const calculatedAvg = Math.round((calculatedMin + calculatedMax) / 2)

  const handleWhatsAppLockPrice = () => {
    const text = `Olá! Simulei na Severinno o serviço *${currentService.name}* (porte: ${currentScope.label}) no bairro *${selectedNeighborhood}* em ${city} (faixa estimada de R$ ${calculatedMin} a R$ ${calculatedMax}). Gostaria de travar este orçamento com a Garantia de Custódia.`
    const url = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <div
      className={cn(
        "border-primary/30 bg-card relative rounded-3xl border p-6 shadow-xl backdrop-blur-md transition-all sm:p-8",
        className,
      )}
    >
      {/* Top Banner Tag */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="bg-primary/10 text-primary border-primary/20 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold">
          <Calculator className="size-3.5" />
          <span>Simulador de Preço Médio em {city}</span>
        </div>
        <span className="text-muted-foreground flex items-center gap-1 text-xs font-medium">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          Valores baseados em atendimentos reais na cidade
        </span>
      </div>

      {/* Quick Service Pills */}
      <div className="mb-6 overflow-x-auto pb-1">
        <div className="flex items-center gap-2">
          {SERVICE_ESTIMATES.map((srv) => (
            <button
              key={srv.id}
              type="button"
              onClick={() => setSelectedServiceId(srv.id)}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all",
                selectedServiceId === srv.id
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {srv.name.split("/")[0].trim()}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        {/* Left Inputs */}
        <div className="space-y-5 lg:col-span-7">
          <h3 className="text-foreground text-xl font-extrabold tracking-tight sm:text-2xl">
            Descubra quanto custa seu conserto no seu bairro:
          </h3>

          <div className="grid grid-cols-1 gap-4 pt-1 sm:grid-cols-2">
            {/* Service Selector */}
            <div>
              <label className="text-muted-foreground mb-1.5 flex items-center gap-1 text-xs font-bold tracking-wider uppercase">
                <Wrench className="text-primary size-3" />
                Qual serviço você precisa?
              </label>
              <select
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
                className="border-border/80 bg-background text-foreground focus:ring-primary h-11 w-full rounded-xl border px-3.5 text-sm font-semibold shadow-xs transition-all focus:ring-2 focus:outline-none"
              >
                {SERVICE_ESTIMATES.map((srv) => (
                  <option key={srv.id} value={srv.id}>
                    {srv.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Neighborhood Selector */}
            <div>
              <label className="text-muted-foreground mb-1.5 flex items-center gap-1 text-xs font-bold tracking-wider uppercase">
                <MapPin className="text-primary size-3" />
                Em qual bairro de {city}?
              </label>
              <select
                value={selectedNeighborhood}
                onChange={(e) => setUserNeighborhood(e.target.value)}
                className="border-border/80 bg-background text-foreground focus:ring-primary h-11 w-full rounded-xl border px-3.5 text-sm font-semibold shadow-xs transition-all focus:ring-2 focus:outline-none"
              >
                {neighborhoods.map((nh) => (
                  <option key={nh} value={nh}>
                    {nh}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Scope / Complexity Selector */}
          <div>
            <label className="text-muted-foreground mb-2 flex items-center gap-1 text-xs font-bold tracking-wider uppercase">
              <TrendingUp className="text-primary size-3" />
              Complexidade ou Porte do Serviço:
            </label>
            <div className="grid grid-cols-3 gap-2">
              {SCOPE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedScope(opt.id)}
                  className={cn(
                    "flex flex-col items-start rounded-xl border p-2.5 text-left transition-all",
                    selectedScope === opt.id
                      ? "border-primary bg-primary/10 text-primary ring-primary/20 ring-1"
                      : "border-border/60 bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="text-xs font-bold">{opt.label}</span>
                  <span className="line-clamp-1 text-[10px] opacity-80">{opt.sublabel}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Sparkles className="size-3.5 shrink-0 text-amber-500" />
            <span>{currentService.description}</span>
          </p>
        </div>

        {/* Right Output Card with 3-tier benchmark */}
        <div className="from-primary/10 via-background border-primary/30 flex flex-col justify-between rounded-2xl border bg-gradient-to-br to-emerald-500/10 p-5 shadow-md lg:col-span-5">
          <div>
            <div className="text-muted-foreground border-border/40 flex items-center justify-between border-b pb-2 text-xs">
              <span className="font-medium">Faixa estimada para {selectedNeighborhood}:</span>
              <span className="text-primary flex items-center gap-1 font-bold">
                <Clock className="size-3" /> ~{currentService.etaMinutes} min
              </span>
            </div>

            <div className="mt-3 text-center sm:text-left">
              <div className="flex items-baseline gap-1.5">
                <span className="text-foreground text-3xl font-black tracking-tight">
                  R$ {calculatedMin} — {calculatedMax}
                </span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Estimativa por {currentService.unit} ({currentScope.label})
              </p>
            </div>

            {/* Benchmark distribution graphic */}
            <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="text-muted-foreground flex items-center justify-between text-[11px] font-semibold">
                <span>Econômico</span>
                <span className="flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-300">
                  <Percent className="size-3 text-emerald-600" />
                  Média GV ({currentService.benchmarkPct}% dos pedidos)
                </span>
                <span>Premium</span>
              </div>
              <div className="bg-muted relative mt-2 h-2.5 w-full overflow-hidden rounded-full">
                <div className="absolute inset-y-0 left-0 w-1/4 bg-emerald-500/30" />
                <div className="absolute inset-y-0 left-1/4 w-1/2 bg-emerald-500" />
                <div className="absolute inset-y-0 left-3/4 w-1/4 bg-teal-600/70" />
              </div>
              <div className="text-foreground mt-1.5 flex items-center justify-between text-[11px] font-bold">
                <span className="text-muted-foreground font-normal">R$ {calculatedMin}</span>
                <span className="text-emerald-600 dark:text-emerald-400">R$ {calculatedAvg}</span>
                <span className="text-muted-foreground font-normal">R$ {calculatedMax}</span>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-emerald-200/60 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300">
              <ShieldCheck className="size-3.5 shrink-0 text-emerald-600" />
              <span>Garantia Severinno: você só paga após o serviço entregue.</span>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="mt-5 space-y-2">
            <button
              type="button"
              onClick={handleWhatsAppLockPrice}
              className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white shadow-md transition-all hover:scale-[1.01] hover:bg-emerald-700 sm:text-sm"
            >
              <MessageCircle className="size-4" />
              <span>Travar Orçamento no WhatsApp</span>
            </button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onQuote(currentService.name, selectedNeighborhood)}
              className="flex w-full items-center justify-center gap-1 text-xs font-semibold"
            >
              <span>Ver Profissionais Disponíveis em {selectedNeighborhood}</span>
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default NeighborhoodPriceSimulator
