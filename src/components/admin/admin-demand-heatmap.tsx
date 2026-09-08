"use client"

import * as React from "react"
import {
  MapPin,
  Flame,
  Filter,
  TrendingUp,
  Layers,
  RefreshCw,
  Compass,
  DollarSign,
  AlertCircle,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { PageTransition } from "@/components/shared/page-transition"
import { Skeleton } from "@/components/ui/skeleton"

type DemandPoint = {
  lat: number
  lng: number
  weight: number
  count: number
  category: string
  avgValue: number
}

type CategoryStat = {
  name: string
  count: number
  percentage: number
}

type DemandResponse = {
  points: DemandPoint[]
  categories: CategoryStat[]
  summary: {
    totalDemandEvents: number
    totalClusters: number
    periodDays: number
  }
}

export function AdminDemandHeatmap() {
  const [data, setData] = React.useState<DemandResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [period, setPeriod] = React.useState("30")
  const [selectedCategory, setSelectedCategory] = React.useState("all")

  const fetchDemand = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/admin/analytics/demand?days=${period}&category=${encodeURIComponent(selectedCategory)}`,
      )
      if (!res.ok) throw new Error("Erro ao carregar dados")
      const json = await res.json()
      setData(json)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [period, selectedCategory])

  React.useEffect(() => {
    queueMicrotask(() => {
      fetchDemand()
    })
  }, [fetchDemand])

  return (
    <PageTransition className="space-y-6">
      {/* Controls Bar */}
      <div className="bg-card border-border/60 flex flex-col items-start justify-between gap-4 rounded-xl border p-4 shadow-xs sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Flame className="h-5 w-5 text-orange-500" />
            Mapa de Calor de Demanda Geográfica
          </h2>
          <p className="text-muted-foreground text-xs">
            Densidade de pedidos e agendamentos por região para expansão de oferta.
          </p>
        </div>

        <div className="flex w-full items-center gap-2.5 sm:w-auto">
          {/* Category filter */}
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="h-9 w-[180px] text-xs">
              <SelectValue placeholder="Todas as categorias" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as Categorias</SelectItem>
              {data?.categories.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name} ({c.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Period filter */}
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-9 w-[120px] text-xs">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={fetchDemand}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="border-border/60 shadow-xs">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-muted-foreground text-xs font-medium">Eventos de Demanda</p>
              <h3 className="mt-1 text-2xl font-bold">
                {loading ? (
                  <Skeleton className="h-7 w-20" />
                ) : (
                  (data?.summary.totalDemandEvents ?? 0)
                )}
              </h3>
              <p className="text-muted-foreground mt-0.5 text-[11px]">Orçamentos + Agendamentos</p>
            </div>
            <div className="rounded-xl bg-orange-500/10 p-3 text-orange-500">
              <Flame className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-xs">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-muted-foreground text-xs font-medium">Polos de Concentração</p>
              <h3 className="mt-1 text-2xl font-bold">
                {loading ? <Skeleton className="h-7 w-16" /> : (data?.summary.totalClusters ?? 0)}
              </h3>
              <p className="text-muted-foreground mt-0.5 text-[11px]">Regiões com alta procura</p>
            </div>
            <div className="rounded-xl bg-blue-500/10 p-3 text-blue-500">
              <Compass className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-xs">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-muted-foreground text-xs font-medium">Ticket Médio Estimado</p>
              <h3 className="mt-1 text-2xl font-bold">
                {loading ? (
                  <Skeleton className="h-7 w-24" />
                ) : (
                  `R$ ${Math.round(
                    (data?.points.reduce((acc, p) => acc + p.avgValue, 0) || 0) /
                      Math.max(1, data?.points.length || 1),
                  )}`
                )}
              </h3>
              <p className="text-muted-foreground mt-0.5 text-[11px]">Por solicitação atendida</p>
            </div>
            <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-500">
              <DollarSign className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid: Heatmap Clusters & Category Ranking */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Hotspot Clusters List */}
        <Card className="border-border/60 shadow-xs lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="text-primary h-4 w-4" />
              Zonas de Maior Concentração de Demanda
            </CardTitle>
            <CardDescription>
              Regiões onde prestadores adicionais trarão maior retorno de conversão.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3 py-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            ) : !data?.points || data.points.length === 0 ? (
              <div className="space-y-2 py-12 text-center">
                <AlertCircle className="text-muted-foreground mx-auto h-8 w-8" />
                <p className="text-muted-foreground text-sm font-medium">
                  Nenhum dado de demanda encontrado para este filtro.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.points.slice(0, 10).map((pt, idx) => {
                  // Color by intensity weight
                  const isHot = pt.weight > 60
                  const isMed = pt.weight > 30

                  return (
                    <div
                      key={idx}
                      className="border-border/40 bg-muted/20 hover:bg-muted/40 flex items-center justify-between gap-4 rounded-xl border p-3.5 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold ${
                            isHot
                              ? "bg-red-500/15 text-red-600 dark:text-red-400"
                              : isMed
                                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                          }`}
                        >
                          #{idx + 1}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-foreground text-sm font-semibold">
                              {pt.category}
                            </span>
                            <Badge
                              variant={isHot ? "destructive" : isMed ? "secondary" : "outline"}
                              className="px-1.5 py-0 text-[10px]"
                            >
                              {pt.count} pedidos
                            </Badge>
                          </div>
                          <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 font-mono text-xs">
                            <MapPin className="h-3 w-3" />
                            {pt.lat}, {pt.lng}
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="text-foreground text-xs font-semibold">
                          R$ {pt.avgValue}
                        </div>
                        <span className="text-muted-foreground text-[11px]">ticket médio</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Categories Distribution */}
        <Card className="border-border/60 shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Categorias em Destaque
            </CardTitle>
            <CardDescription>Participação no volume total de solicitações.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="space-y-4 py-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-2 w-full" />
                  </div>
                ))}
              </div>
            ) : !data?.categories || data.categories.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-xs">
                Sem categorias registradas.
              </p>
            ) : (
              data.categories.slice(0, 8).map((cat) => (
                <div key={cat.name} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-foreground max-w-[150px] truncate">{cat.name}</span>
                    <span className="text-muted-foreground font-mono">
                      {cat.count} ({cat.percentage}%)
                    </span>
                  </div>
                  <Progress value={cat.percentage} className="h-1.5" />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </PageTransition>
  )
}

export default AdminDemandHeatmap
