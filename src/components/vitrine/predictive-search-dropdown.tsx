"use client"

import * as React from "react"
import { Search, MapPin, Wrench, Sparkles, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { triggerHaptic } from "@/lib/haptics"
import { useRegionalContext } from "@/hooks/use-regional-context"

interface PredictiveSearchDropdownProps {
  query: string
  isOpen: boolean
  onSelect: (value: string) => void
  onClose: () => void
  className?: string
}

interface SuggestionItem {
  id: string
  label: string
  category: "service" | "neighborhood" | "urgent"
  subtext?: string
}

const COMMON_SERVICES: SuggestionItem[] = [
  {
    id: "s-1",
    label: "Ar-Condicionado (Instalação e Limpeza)",
    category: "service",
    subtext: "Climatização",
  },
  {
    id: "s-2",
    label: "Eletricista Residencial",
    category: "service",
    subtext: "Troca de fiação, tomadas e chuveiro",
  },
  {
    id: "s-3",
    label: "Encanador & Caça-Vazamentos",
    category: "service",
    subtext: "Tubulação e desentupimento",
  },
  {
    id: "s-4",
    label: "Chaveiro 24 Horas",
    category: "urgent",
    subtext: "Abertura de portas e troca de segredo",
  },
  {
    id: "s-5",
    label: "Montador de Móveis",
    category: "service",
    subtext: "Guarda-roupa, estante e painel TV",
  },
  {
    id: "s-6",
    label: "Diarista e Faxina Residencial",
    category: "service",
    subtext: "Limpeza comum e pós-obra",
  },
  {
    id: "s-7",
    label: "Pintor Residencial e Comercial",
    category: "service",
    subtext: "Pintura interna, externa e massa",
  },
  {
    id: "s-8",
    label: "Marido de Aluguel / Reparos",
    category: "service",
    subtext: "Instalação de varões e furos",
  },
]

export function PredictiveSearchDropdown({
  query,
  isOpen,
  onSelect,
  onClose,
  className,
}: PredictiveSearchDropdownProps) {
  const regional = useRegionalContext()
  const context = regional?.context
  const rawNeighborhoods = context?.neighborhoods
  const neighborhoods = React.useMemo(() => {
    return rawNeighborhoods && rawNeighborhoods.length > 0
      ? rawNeighborhoods
      : ["Centro", "Ilha dos Araújos", "Grã-Duquesa", "São Pedro", "Vila Bretas"]
  }, [rawNeighborhoods])

  const dropdownRef = React.useRef<HTMLDivElement>(null)

  // Filtragem de serviços com base no termo
  const filteredServices = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COMMON_SERVICES.slice(0, 5)
    return COMMON_SERVICES.filter(
      (s) => s.label.toLowerCase().includes(q) || s.subtext?.toLowerCase().includes(q),
    ).slice(0, 5)
  }, [query])

  // Filtragem de bairros
  const filteredNeighborhoods = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return neighborhoods.slice(0, 4)
    return neighborhoods.filter((n) => n.toLowerCase().includes(q)).slice(0, 4)
  }, [query, neighborhoods])

  // Click outside listener
  React.useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label="Sugestões preditivas de busca"
      className={cn(
        "border-border/80 bg-background/95 animate-in fade-in-50 zoom-in-95 absolute top-full left-0 z-50 mt-2 w-full rounded-2xl border p-3 shadow-2xl backdrop-blur-md duration-150",
        className,
      )}
    >
      {/* Grupo de Serviços */}
      <div className="mb-2">
        <div className="text-muted-foreground flex items-center gap-1.5 px-2 py-1 text-[11px] font-bold tracking-wider uppercase">
          <TrendingUp className="text-primary size-3" />
          <span>Serviços Mais Procurados</span>
        </div>
        <div className="space-y-0.5">
          {filteredServices.map((svc) => (
            <button
              key={svc.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                triggerHaptic("selection")
                onSelect(svc.label)
              }}
              className="group hover:bg-primary/10 hover:text-primary focus-visible:bg-primary/10 flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none"
            >
              <div className="flex items-center gap-2.5">
                <span className="bg-muted text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary flex size-7 shrink-0 items-center justify-center rounded-lg">
                  {svc.category === "urgent" ? (
                    <Sparkles className="size-3.5 text-rose-500" />
                  ) : (
                    <Wrench className="size-3.5" />
                  )}
                </span>
                <div>
                  <p className="text-foreground group-hover:text-primary font-semibold">
                    {svc.label}
                  </p>
                  {svc.subtext && (
                    <p className="text-muted-foreground text-[10px]">{svc.subtext}</p>
                  )}
                </div>
              </div>
              <Search className="text-muted-foreground/50 size-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </div>

      {/* Grupo de Bairros */}
      {filteredNeighborhoods.length > 0 && (
        <div className="border-border/50 border-t pt-2">
          <div className="text-muted-foreground flex items-center gap-1.5 px-2 py-1 text-[11px] font-bold tracking-wider uppercase">
            <MapPin className="size-3 text-emerald-600 dark:text-emerald-400" />
            <span>Buscar por Bairro</span>
          </div>
          <div className="flex flex-wrap gap-1.5 px-2 pt-1">
            {filteredNeighborhoods.map((district) => (
              <button
                key={district}
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  onSelect(district)
                }}
                className="border-border/80 bg-muted/40 text-foreground hover:border-primary hover:bg-primary/10 hover:text-primary inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-all"
              >
                <MapPin className="text-muted-foreground size-2.5" />
                <span>{district}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
