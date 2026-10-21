"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Navigation, MapPin, Compass, ExternalLink, Loader2 } from "lucide-react"
import { apiGet } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { triggerHaptic } from "@/lib/haptics"
import type { OptimizedRoutePlan, RouteStop, TransportMode } from "@/lib/tsp-route-optimizer"
import { ProviderTransitHud } from "@/components/provider/provider-transit-hud"

type DailyRouteResponse = {
  ok: boolean
  date: string
  stopsCount: number
  plan: OptimizedRoutePlan
}

export function ProviderRouteOptimizer({ initialDate }: { initialDate?: string }) {
  const todayStr = React.useMemo(() => {
    return initialDate || new Date().toISOString().slice(0, 10)
  }, [initialDate])

  const [date, setDate] = React.useState<string>(todayStr)
  const [mode, setMode] = React.useState<TransportMode>("CAR")
  const [selectedTransitStop, setSelectedTransitStop] = React.useState<RouteStop | null>(null)

  // Load saved preference on mount
  React.useEffect(() => {
    async function loadPref() {
      try {
        const res = await fetch("/api/provider/preferences/transport")
        if (res.ok) {
          const json = await res.json()
          if (json.mode) setMode(json.mode)
        }
      } catch {
        // Fallback
      }
    }
    loadPref()
  }, [])

  const { data, isLoading } = useQuery<DailyRouteResponse>({
    queryKey: ["provider", "daily-route", date, mode],
    queryFn: () =>
      apiGet<DailyRouteResponse>(`/api/provider/routes/daily?date=${date}&mode=${mode}`),
  })

  const handleModeChange = async (newMode: TransportMode) => {
    triggerHaptic("selection")
    setMode(newMode)
    try {
      await fetch("/api/provider/preferences/transport", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      })
    } catch {
      // Fire-and-forget save
    }
  }

  const plan = data?.plan
  const stopsCount = data?.stopsCount ?? 0

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <Navigation className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">Otimizador de Rotas do Dia</CardTitle>
              <CardDescription className="text-xs">
                Sequenciamento inteligente 2-Opt TSP para economizar tempo e combustível
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Modal de Transporte */}
            <div className="bg-muted/40 flex items-center rounded-lg border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => handleModeChange("MOTO")}
                className={`rounded px-2 py-1 font-medium transition-colors active:scale-95 ${
                  mode === "MOTO"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                🏍️ Moto
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("CAR")}
                className={`rounded px-2 py-1 font-medium transition-colors active:scale-95 ${
                  mode === "CAR"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                🚗 Carro
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("BICYCLE")}
                className={`rounded px-2 py-1 font-medium transition-colors active:scale-95 ${
                  mode === "BICYCLE"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                🚲 Bike
              </button>
            </div>

            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-background text-foreground focus:ring-primary rounded-lg border px-2.5 py-1 text-xs focus:ring-1 focus:outline-none"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex h-36 items-center justify-center">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        ) : stopsCount === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed py-8 text-center text-xs">
            Nenhum agendamento ativo encontrado para a data selecionada ({date}).
          </div>
        ) : plan ? (
          <>
            {/* KPI Summary */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="bg-muted/30 rounded-lg border p-2.5 text-center">
                <div className="text-muted-foreground text-[10px] font-medium uppercase">
                  Paradas
                </div>
                <div className="text-foreground text-lg font-bold">{stopsCount}</div>
              </div>
              <div className="bg-muted/30 rounded-lg border p-2.5 text-center">
                <div className="text-muted-foreground text-[10px] font-medium uppercase">
                  Trajeto Otimizado
                </div>
                <div className="text-foreground text-lg font-bold">
                  {plan.optimizedDistanceKm} km
                </div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-center dark:border-emerald-800/40 dark:bg-emerald-950/40">
                <div className="text-[10px] font-medium text-emerald-700 uppercase dark:text-emerald-300">
                  Km Economizados
                </div>
                <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  {plan.savedDistanceKm > 0 ? `-${plan.savedDistanceKm} km` : "Melhor Rota"}
                </div>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-center dark:border-blue-800/40 dark:bg-blue-950/40">
                <div className="text-[10px] font-medium text-blue-700 uppercase dark:text-blue-300">
                  Tempo Estimado Salvo
                </div>
                <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                  {plan.estimatedTimeSavedMinutes > 0
                    ? `~${plan.estimatedTimeSavedMinutes} min`
                    : "0 min"}
                </div>
              </div>
            </div>

            {/* Stops Timeline */}
            <div className="space-y-2 pt-1">
              <div className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                Ordem Recomendada de Atendimentos
              </div>
              <div className="space-y-2">
                {plan.orderedStops.map((stop, idx) => (
                  <div
                    key={stop.id}
                    className="bg-card hover:bg-muted/40 flex items-center gap-3 rounded-lg border p-2.5 text-xs transition-colors"
                  >
                    <div className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
                      {idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground truncate font-semibold">{stop.title}</span>
                        {stop.scheduledTime && (
                          <span className="bg-muted py-0.2 text-muted-foreground rounded px-1.5 text-[10px]">
                            {stop.scheduledTime}
                          </span>
                        )}
                      </div>
                      <div className="text-muted-foreground mt-0.5 flex items-center gap-1 truncate text-[11px]">
                        <MapPin className="size-3 shrink-0" />
                        <span className="truncate">{stop.address}</span>
                        {stop.clientName && <span>· Cliente: {stop.clientName}</span>}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        triggerHaptic("medium")
                        setSelectedTransitStop(stop)
                      }}
                      className="h-7 shrink-0 gap-1 border-sky-500/40 px-2 text-[11px] font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300"
                      title={`Iniciar Modo Trânsito HUD para ${stop.title}`}
                      aria-label={`Iniciar Modo Trânsito HUD para ${stop.title}`}
                    >
                      <Navigation className="size-3 text-sky-500" />
                      <span>HUD</span>
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Navigation buttons */}
            <div className="flex flex-wrap items-center gap-2 border-t pt-2">
              <Button
                size="sm"
                className="flex-1 gap-1.5 bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
                onClick={() => {
                  triggerHaptic("light")
                  window.open(plan.googleMapsUrl, "_blank")
                }}
              >
                <Compass className="size-3.5" />
                Navegar no Google Maps
                <ExternalLink className="size-3 opacity-70" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5 text-xs font-semibold"
                onClick={() => {
                  triggerHaptic("light")
                  window.open(plan.wazeUrl, "_blank")
                }}
              >
                <Navigation className="size-3.5 text-blue-500" />
                Abrir no Waze
                <ExternalLink className="size-3 opacity-70" />
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>

      {selectedTransitStop && (
        <ProviderTransitHud
          bookingId={selectedTransitStop.id}
          clientName={selectedTransitStop.clientName || "Cliente"}
          clientAddress={selectedTransitStop.address}
          destinationLat={selectedTransitStop.lat}
          destinationLng={selectedTransitStop.lng}
          serviceTitle={selectedTransitStop.title}
          onClose={() => setSelectedTransitStop(null)}
        />
      )}
    </Card>
  )
}
