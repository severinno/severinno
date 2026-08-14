"use client"

/**
 * AdminBusinessMetricsCard — Executive KPI & Financial Analytics Dashboard Widget.
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Banknote,
  DollarSign,
  Flame,
  MapPin,
  Percent,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react"

import { apiGet } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import type { BusinessMetricsResponse } from "@/app/api/admin/business-metrics/route"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"

export function AdminBusinessMetricsCard() {
  const { data, isLoading } = useQuery<{ ok: boolean; metrics: BusinessMetricsResponse }>({
    queryKey: ["admin-business-metrics"],
    queryFn: () => apiGet<{ ok: boolean; metrics: BusinessMetricsResponse }>("/api/admin/business-metrics"),
  })

  if (isLoading) {
    return <Skeleton className="h-96 w-full rounded-2xl" />
  }

  const m = data?.metrics
  if (!m) return null

  return (
    <div className="space-y-6">
      {/* 4 Executive KPI Metric Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="rounded-xl border shadow-sm bg-background">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-11 rounded-xl bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center text-emerald-600">
              <TrendingUp className="size-5" />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                GMV Transacionado
              </div>
              <div className="text-xl font-bold tabular-nums text-foreground">
                {formatBRL(m.gmv)}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border shadow-sm bg-background">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-11 rounded-xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center text-blue-600">
              <DollarSign className="size-5" />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Receita da Plataforma (10%)
              </div>
              <div className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatBRL(m.platformRevenue)}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border shadow-sm bg-background">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-11 rounded-xl bg-purple-100 dark:bg-purple-950 flex items-center justify-center text-purple-600">
              <Banknote className="size-5" />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Ticket Médio
              </div>
              <div className="text-xl font-bold tabular-nums text-foreground">
                {formatBRL(m.avgTicket)}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border shadow-sm bg-background">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-11 rounded-xl bg-amber-100 dark:bg-amber-950 flex items-center justify-center text-amber-600">
              <Percent className="size-5" />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Taxa de Conclusão
              </div>
              <div className="text-xl font-bold tabular-nums text-foreground">
                {m.completionRatePercent}%
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Breakdowns: Top Districts and Top Categories */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* District Ranking */}
        <Card className="rounded-xl border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <MapPin className="size-4 text-emerald-600" />
              Ranking de Bairros por Volume Financeiro
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {m.topDistricts.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                Nenhum dado registrado ainda.
              </div>
            ) : (
              m.topDistricts.map((d, i) => {
                const percentage = m.gmv > 0 ? Math.round((d.totalGmv / m.gmv) * 100) : 0
                return (
                  <div key={i} className="space-y-1 text-xs">
                    <div className="flex justify-between font-semibold">
                      <span>{i + 1}. {d.district} ({d.count} serviços)</span>
                      <span className="text-emerald-600">{formatBRL(d.totalGmv)} ({percentage}%)</span>
                    </div>
                    <Progress value={percentage} className="h-1.5" />
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        {/* Categories Ranking */}
        <Card className="rounded-xl border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Flame className="size-4 text-orange-500" />
              Categorias Mais Demandadas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {m.topCategories.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                Nenhum dado registrado ainda.
              </div>
            ) : (
              m.topCategories.map((c, i) => {
                const percentage = m.gmv > 0 ? Math.round((c.totalRevenue / m.gmv) * 100) : 0
                return (
                  <div key={i} className="space-y-1 text-xs">
                    <div className="flex justify-between font-semibold">
                      <span>{i + 1}. {c.title} ({c.count} atendimentos)</span>
                      <span className="text-orange-600 dark:text-orange-400">{formatBRL(c.totalRevenue)}</span>
                    </div>
                    <Progress value={percentage} className="h-1.5" />
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
