"use client"

import * as React from "react"
import { MapPin, Clock, ShieldCheck, Users, Sparkles, ChevronRight, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { triggerHaptic } from "@/lib/haptics"
import { useRegionalContext } from "@/hooks/use-regional-context"

export type NeighborhoodSelectorBarProps = {
  selectedNeighborhood?: string
  onSelectNeighborhood?: (neighborhood: string) => void
  onSearchService?: (serviceName: string, neighborhood: string) => void
  className?: string
}

export type NeighborhoodData = {
  name: string
  etaRange: string
  activeProviders: number
  satisfactionRate: number
  topServices: string[]
  highlight: string
}

export const GV_NEIGHBORHOOD_METRICS: Record<string, NeighborhoodData> = {
  Centro: {
    name: "Centro",
    etaRange: "10-20 min",
    activeProviders: 28,
    satisfactionRate: 99.4,
    topServices: ["Eletricista Rápido", "Diarista Residencial", "Ar-Condicionado", "Chaveiro 24h"],
    highlight: "Maior densidade de profissionais a postos para atendimento imediato.",
  },
  "Ilha dos Araújos": {
    name: "Ilha dos Araújos",
    etaRange: "15-25 min",
    activeProviders: 19,
    satisfactionRate: 99.8,
    topServices: ["Ar-Condicionado & Clima", "Pintor & Acabamento", "Jardinagem", "Diarista"],
    highlight: "Alta demanda por técnicos residenciais com verificação de antecedentes.",
  },
  "Grã-Duquesa": {
    name: "Grã-Duquesa",
    etaRange: "15-25 min",
    activeProviders: 16,
    satisfactionRate: 98.9,
    topServices: [
      "Manutenção Hidráulica",
      "Instalação de Ventilador",
      "Eletricista",
      "Montador de Móveis",
    ],
    highlight: "Tempo médio de resposta abaixo de 20 minutos com rota OSRM otimizada.",
  },
  "Vila Bretas": {
    name: "Vila Bretas",
    etaRange: "12-22 min",
    activeProviders: 21,
    satisfactionRate: 99.1,
    topServices: [
      "Desentupimento",
      "Reparos Elétricos",
      "Diarista",
      "Pedreiro de Pequenos Reparos",
    ],
    highlight: "Cobertura completa comercial e residencial com prestadores credenciados.",
  },
  "São Pedro": {
    name: "São Pedro",
    etaRange: "18-28 min",
    activeProviders: 15,
    satisfactionRate: 98.7,
    topServices: ["Encanador", "Conserto de Chuveiro", "Serralheiro", "Pintor"],
    highlight: "Atendimento expresso garantido com custódia segura na plataforma.",
  },
  "Vila Isa": {
    name: "Vila Isa",
    etaRange: "15-30 min",
    activeProviders: 14,
    satisfactionRate: 99.0,
    topServices: ["Eletricista", "Limpeza Pós-Obra", "Manutenção de Ar", "Montador de Móveis"],
    highlight: "Prestadores locais da região sul de Governador Valadares.",
  },
  Lourdes: {
    name: "Lourdes",
    etaRange: "15-25 min",
    activeProviders: 17,
    satisfactionRate: 99.2,
    topServices: ["Faxina Residencial", "Reparos Hidráulicos", "Gesso & Pintura", "Eletricista"],
    highlight: "Região nobre com alta pontuação de avaliações 5 estrelas.",
  },
  Esplanada: {
    name: "Esplanada",
    etaRange: "12-22 min",
    activeProviders: 18,
    satisfactionRate: 99.3,
    topServices: ["Ar-Condicionado", "Instalação Elétrica", "Diarista", "Chaveiro"],
    highlight: "Prestadores próximos ao Parque de Exposições e Ibituruna.",
  },
  "Santa Rita": {
    name: "Santa Rita",
    etaRange: "15-28 min",
    activeProviders: 13,
    satisfactionRate: 98.8,
    topServices: ["Encanador & Caixa d'Água", "Eletricista", "Pintor", "Serralheria"],
    highlight: "Rapidez no atendimento emergencial de hidráulica e vazamentos.",
  },
  Altinópolis: {
    name: "Altinópolis",
    etaRange: "18-30 min",
    activeProviders: 12,
    satisfactionRate: 98.5,
    topServices: ["Pequenas Reformas", "Conserto de Telhado", "Eletricista", "Diarista"],
    highlight: "Profissionais avaliados da região com garantia de refação.",
  },
}

export const GV_NEIGHBORHOOD_NAMES = Object.keys(GV_NEIGHBORHOOD_METRICS)

export function NeighborhoodSelectorBar({
  selectedNeighborhood: propNeighborhood,
  onSelectNeighborhood,
  onSearchService,
  className,
}: NeighborhoodSelectorBarProps) {
  const { context } = useRegionalContext()
  const detectedDistrict = context?.city === "Governador Valadares" ? "Centro" : "Centro"

  const [activeDistrict, setActiveDistrict] = React.useState<string>(
    propNeighborhood || detectedDistrict,
  )
  const prevPropNeighborhood = React.useRef(propNeighborhood)

  React.useEffect(() => {
    if (propNeighborhood && propNeighborhood !== prevPropNeighborhood.current) {
      prevPropNeighborhood.current = propNeighborhood
      setActiveDistrict(propNeighborhood)
    }
  }, [propNeighborhood])

  const handleSelect = (neighborhood: string) => {
    triggerHaptic("selection")
    setActiveDistrict(neighborhood)
    onSelectNeighborhood?.(neighborhood)
  }

  const currentMetrics =
    GV_NEIGHBORHOOD_METRICS[activeDistrict] || GV_NEIGHBORHOOD_METRICS["Centro"]

  return (
    <section
      data-testid="neighborhood-selector-bar"
      className={cn(
        "via-background rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.04] to-teal-500/[0.03] p-3.5 shadow-xs transition-all sm:p-4",
        className,
      )}
    >
      {/* Top Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
            <MapPin className="size-4 animate-bounce" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
                Hiperlocalidade Valadarense
              </span>
              <span className="py-0.2 inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                <Sparkles className="size-2.5" /> GPS Ativo
              </span>
            </div>
            <h3 className="text-foreground text-sm font-bold sm:text-base">
              Prestadores perto de você em{" "}
              <span className="text-emerald-600">{activeDistrict}</span>
            </h3>
          </div>
        </div>

        <p className="text-muted-foreground text-xs sm:text-right">
          Tempo de chegada médio:{" "}
          <strong className="text-emerald-700 dark:text-emerald-400">
            {currentMetrics.etaRange}
          </strong>
        </p>
      </div>

      {/* Horizontal Neighborhood Pills Slider */}
      <div className="-mx-1 mt-3.5 flex snap-x snap-mandatory [scrollbar-width:none] gap-2 overflow-x-auto scroll-smooth px-1 pt-0.5 pb-1.5">
        {GV_NEIGHBORHOOD_NAMES.map((name) => {
          const isSelected = name === activeDistrict
          return (
            <button
              key={name}
              type="button"
              onClick={() => handleSelect(name)}
              className={cn(
                "group relative inline-flex min-h-[40px] shrink-0 cursor-pointer snap-start items-center rounded-full px-4 text-xs font-semibold transition-all duration-150 active:scale-95 sm:h-7.5 sm:min-h-[32px]",
                isSelected
                  ? "scale-[1.02] bg-emerald-600 text-white shadow-sm shadow-emerald-600/30"
                  : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground border-border/60 border shadow-2xs",
              )}
            >
              {name}
              {isSelected && (
                <span className="ml-1.5 inline-block size-1.5 animate-ping rounded-full bg-white" />
              )}
            </button>
          )
        })}
      </div>

      {/* Neighborhood Metrics Card */}
      <div className="border-border/60 bg-card/60 mt-4 grid grid-cols-2 gap-2 rounded-xl border p-3 sm:grid-cols-4 sm:gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
            <Clock className="size-4" />
          </div>
          <div>
            <p className="text-muted-foreground text-xs font-semibold uppercase">Chegada</p>
            <p className="text-foreground text-sm font-bold">{currentMetrics.etaRange}</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:bg-teal-950/60 dark:text-teal-400">
            <Users className="size-4" />
          </div>
          <div>
            <p className="text-muted-foreground text-xs font-semibold uppercase">
              A postos no bairro
            </p>
            <p className="text-foreground text-sm font-bold">
              {currentMetrics.activeProviders} profissionais
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
            <TrendingUp className="size-4" />
          </div>
          <div>
            <p className="text-muted-foreground text-xs font-semibold uppercase">
              Satisfação local
            </p>
            <p className="text-foreground text-sm font-bold">
              {currentMetrics.satisfactionRate}% aprovado
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
            <ShieldCheck className="size-4" />
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-medium uppercase">Proteção</p>
            <p className="text-foreground text-xs font-bold">Custódia Garantida</p>
          </div>
        </div>
      </div>

      {/* Top Services in Neighborhood */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-1 text-xs">
        <span className="text-muted-foreground mr-1 text-[11px] font-medium">
          Mais pedidos em {activeDistrict}:
        </span>
        {currentMetrics.topServices.map((service) => (
          <Button
            key={service}
            variant="outline"
            size="sm"
            onClick={() => onSearchService?.(service, activeDistrict)}
            className="h-6 gap-1 rounded-md border-emerald-500/30 px-2 py-0 text-[11px] font-medium text-emerald-800 hover:bg-emerald-500/10 dark:text-emerald-300"
          >
            {service}
            <ChevronRight className="size-2.5 opacity-60" />
          </Button>
        ))}
      </div>
    </section>
  )
}
