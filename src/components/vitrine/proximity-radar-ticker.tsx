"use client"

import * as React from "react"
import { Navigation, Clock, ArrowRight, UserCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRegionalContext } from "@/hooks/use-regional-context"

interface ProximityRadarTickerProps {
  onExploreNearby?: () => void
  className?: string
}

interface NearbyActiveProvider {
  id: string
  name: string
  specialty: string
  etaMinutes: number
  neighborhood: string
  rating: number
  avatarLetter: string
  avatarColor: string
}

const SAMPLE_NEARBY_PROVIDERS: Omit<NearbyActiveProvider, "neighborhood">[] = [
  {
    id: "p-1",
    name: "Carlos M.",
    specialty: "Eletricista de Emergência",
    etaMinutes: 12,
    rating: 5.0,
    avatarLetter: "C",
    avatarColor: "from-amber-500 to-orange-600",
  },
  {
    id: "p-2",
    name: "Rafael S.",
    specialty: "Técnico de Ar & Climatização",
    etaMinutes: 16,
    rating: 4.9,
    avatarLetter: "R",
    avatarColor: "from-blue-600 to-indigo-600",
  },
  {
    id: "p-3",
    name: "Luciana P.",
    specialty: "Encanadora & Caça-Vazamentos",
    etaMinutes: 14,
    rating: 5.0,
    avatarLetter: "L",
    avatarColor: "from-cyan-500 to-blue-600",
  },
  {
    id: "p-4",
    name: "Juliano T.",
    specialty: "Chaveiro Residencial & Automotivo",
    etaMinutes: 10,
    rating: 4.8,
    avatarLetter: "J",
    avatarColor: "from-rose-500 to-red-600",
  },
]

export function ProximityRadarTicker({ onExploreNearby, className }: ProximityRadarTickerProps) {
  const regional = useRegionalContext()
  const context = regional?.context
  const city = context?.city || "Governador Valadares"
  const rawNeighborhoods = context?.neighborhoods
  const platformEvents = context?.platformEvents
  const activeNearbyCount = platformEvents?.activeProvidersNearby || 42

  const providersWithNeighborhoods = React.useMemo(() => {
    const list =
      rawNeighborhoods && rawNeighborhoods.length > 0
        ? rawNeighborhoods
        : ["Centro", "Ilha dos Araújos"]
    return SAMPLE_NEARBY_PROVIDERS.map((p, idx) => ({
      ...p,
      neighborhood: list[idx % list.length] || "Centro",
    }))
  }, [rawNeighborhoods])

  return (
    <section
      aria-label="Radar de Proximidade em Tempo Real"
      className={cn(
        "border-primary/20 from-primary/5 via-card to-background relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm sm:p-6",
        className,
      )}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        {/* Left: Radar animation + stats */}
        <div className="flex items-center gap-4">
          {/* Radar graphic animation */}
          <div className="border-primary/30 bg-primary/10 relative flex size-14 shrink-0 items-center justify-center rounded-2xl border shadow-inner">
            <span className="bg-primary/20 absolute inline-flex size-10 animate-ping rounded-full" />
            <span className="border-primary/40 absolute inline-flex size-7 rounded-full border" />
            <Navigation className="text-primary size-5 rotate-45" />
            <span className="absolute top-1.5 right-1.5 flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-600 dark:text-emerald-400">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                <span>Radar GPS Ao Vivo</span>
              </span>
              <span className="text-muted-foreground text-xs font-semibold">{city} e Região</span>
            </div>

            <h3 className="text-foreground text-base font-black tracking-tight sm:text-lg">
              {activeNearbyCount} profissionais verificados com rota ativa perto de você
            </h3>
            <p className="text-muted-foreground text-xs sm:text-sm">
              Tempo médio de chegada estimado em até 15 minutos nos principais bairros.
            </p>
          </div>
        </div>

        {/* Right action button */}
        <button
          type="button"
          onClick={onExploreNearby}
          className="border-border/80 bg-background hover:border-primary/50 hover:bg-primary/5 text-foreground inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-extrabold shadow-xs transition-all active:scale-95 sm:text-sm"
        >
          <span>Ver Técnicos Mais Próximos</span>
          <ArrowRight className="text-primary size-3.5" />
        </button>
      </div>

      {/* Live Provider Mini-Cards Strip */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {providersWithNeighborhoods.map((provider) => (
          <div
            key={provider.id}
            className="border-border/60 bg-background/80 hover:border-primary/40 flex items-center justify-between rounded-xl border p-3 shadow-2xs transition-all hover:shadow-xs"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <div
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-xs font-black text-white shadow-xs",
                  provider.avatarColor,
                )}
              >
                {provider.avatarLetter}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-foreground truncate text-xs font-bold">
                    {provider.name}
                  </span>
                  <UserCheck className="size-3 shrink-0 text-emerald-500" />
                </div>
                <span className="text-muted-foreground block truncate text-[11px]">
                  {provider.specialty}
                </span>
                <span className="text-primary block truncate text-[10px] font-semibold">
                  {provider.neighborhood}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-end pl-2">
              <span className="flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-black text-emerald-600 dark:text-emerald-400">
                <Clock className="size-2.5" />~{provider.etaMinutes} min
              </span>
              <span className="text-muted-foreground mt-0.5 text-[10px] font-semibold">
                ⭐ {provider.rating.toFixed(1)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
