"use client"

/**
 * ProviderDemandHeatmap — Visual geospatial demand analysis widget for providers.
 *
 * Displays demand hotspots, top requested categories, and actionable radius insights.
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Flame, Loader2, MapPin, TrendingUp, Sparkles } from "lucide-react"

import { apiGet } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"

type DemandResponse = {
  center: { lat: number; lng: number }
  radiusKm: number
  city: string
  totalDemandEvents: number
  points: Array<{
    lat: number
    lng: number
    weight: number
    count: number
    label?: string
  }>
}

export function ProviderDemandHeatmap() {
  const { data, isLoading } = useQuery<DemandResponse>({
    queryKey: ["provider-demand-heatmap"],
    queryFn: () => apiGet<DemandResponse>("/api/provider/demand-heatmap"),
    staleTime: 60 * 1000,
  })

  if (isLoading) {
    return (
      <Card className="rounded-xl border shadow-sm">
        <CardContent className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-10">
          <Loader2 className="size-6 animate-spin text-emerald-600" />
          <p className="text-xs">Carregando mapa de demanda…</p>
        </CardContent>
      </Card>
    )
  }

  const points = data?.points ?? []
  const sortedPoints = [...points].sort((a, b) => b.count - a.count)

  return (
    <Card className="rounded-xl border shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-bold">
            <Flame className="size-5 text-orange-500" />
            Mapa de Calor de Demanda ({data?.city || "Sua Região"})
          </CardTitle>
          <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-800 dark:bg-orange-950/40 dark:text-orange-300">
            <TrendingUp className="size-3" />
            {data?.totalDemandEvents || 0} buscas recentes
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-xs leading-relaxed">
          Áreas com maior volume de buscas por clientes no seu raio de atuação (
          {data?.radiusKm || 25} km).
        </p>

        {/* Hotspots breakdown list */}
        <div className="space-y-3">
          {sortedPoints.slice(0, 4).map((p, i) => {
            const percentage = Math.round(p.weight * 100)
            return (
              <div key={i} className="bg-muted/20 space-y-1.5 rounded-lg border p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground flex items-center gap-1.5 font-semibold">
                    <MapPin className="size-3.5 text-emerald-600" />
                    {p.label || `Ponto de Demanda #${i + 1}`}
                  </span>
                  <span className="font-bold text-orange-600 tabular-nums dark:text-orange-400">
                    {p.count} solicitações ({percentage}%)
                  </span>
                </div>
                <Progress value={percentage} className="bg-muted h-1.5" />
              </div>
            )
          })}
        </div>

        {/* AI Strategic Insight */}
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          <div>
            <strong>Dica Estratégica Severinno:</strong>
            <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-300/90">
              A maior concentração de solicitações está a aproximadamente 4km ao norte do seu
              endereço. Considere manter seu raio em no mínimo <strong>15 km</strong> para captar
              essas oportunidades.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
