"use client"

/**
 * AdminAnalyticsDashboard — visual analytics dashboard for admin.
 *
 * Features:
 * - Funnel chart (landing → retention) with conversion rates
 * - Trend line chart showing daily volumes per stage
 * - KPI cards: conversion rate, avg response time, avg ticket, volume
 * - Period filters: 7d / 30d / 90d
 *
 * Uses recharts directly (the `@/components/ui/chart` wrapper was removed —
 * no consumer ever used it; see docs/GUARDS.md §38 for the <style> policy).
 * Data comes from the analytics API: /api/admin/analytics
 */

import * as React from "react"
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts"
import { TrendingUp, TrendingDown, Users, ArrowRight, Activity, BarChart3 } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { PageTransition, StaggerChildren } from "@/components/shared/page-transition"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type FunnelStage =
  "landing" | "signup" | "onboarding" | "search" | "booking" | "completed" | "review" | "retention"

type FunnelData = Record<
  FunnelStage,
  { total: number; byRole: { CLIENT: number; PROVIDER: number } }
>

type ConversionRate = {
  from: FunnelStage
  to: FunnelStage
  rate: number | null
  absolute: number
}

type DailyCount = { date: string; count: number }

type Period = "7d" | "30d" | "90d"

const STAGE_LABELS: Record<FunnelStage, string> = {
  landing: "Visita",
  signup: "Cadastro",
  onboarding: "Onboarding",
  search: "Busca",
  booking: "Agendamento",
  completed: "Concluído",
  review: "Avaliação",
  retention: "Retenção",
}

const PERIOD_DAYS: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90 }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AdminAnalyticsDashboard() {
  const [period, setPeriod] = React.useState<Period>("30d")
  const [funnel, setFunnel] = React.useState<FunnelData | null>(null)
  const [rates, setRates] = React.useState<ConversionRate[]>([])
  const [trend, setTrend] = React.useState<DailyCount[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)

      async function fetchData() {
        try {
          const days = PERIOD_DAYS[period]
          const endMs = Date.now()
          const startMs = endMs - days * 24 * 60 * 60 * 1000

          const [funnelRes, ratesRes, trendRes] = await Promise.all([
            fetch(`/api/admin/analytics?type=funnel&start=${startMs}&end=${endMs}`),
            fetch(`/api/admin/analytics?type=rates&start=${startMs}&end=${endMs}`),
            fetch(`/api/admin/analytics?type=daily&stage=booking&days=${days}`),
          ])

          if (cancelled) return

          if (funnelRes.ok) {
            const data = await funnelRes.json()
            setFunnel(data)
          }
          if (ratesRes.ok) {
            const data = await ratesRes.json()
            setRates(data)
          }
          if (trendRes.ok) {
            const data = await trendRes.json()
            setTrend(data)
          }
        } catch {
          // Silently handle — dashboard is best-effort
        } finally {
          if (!cancelled) setLoading(false)
        }
      }

      void fetchData()
    })

    return () => {
      cancelled = true
    }
  }, [period])

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <Skeleton className="mb-2 h-4 w-24" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="mt-2 h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="mb-4 h-5 w-40" />
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  // Compute KPIs
  const totalLandings = funnel?.landing?.total ?? 0
  const totalBookings = funnel?.booking?.total ?? 0
  const totalCompleted = funnel?.completed?.total ?? 0
  const totalRetention = funnel?.retention?.total ?? 0

  const globalConversion =
    totalLandings > 0 ? ((totalBookings / totalLandings) * 100).toFixed(1) : "—"
  const completionRate =
    totalBookings > 0 ? ((totalCompleted / totalBookings) * 100).toFixed(1) : "—"
  const retentionRate =
    totalCompleted > 0 ? ((totalRetention / totalCompleted) * 100).toFixed(1) : "—"

  // Funnel chart data
  const funnelChartData = funnel
    ? (Object.keys(STAGE_LABELS) as FunnelStage[]).map((stage) => ({
        stage: STAGE_LABELS[stage],
        total: funnel[stage]?.total ?? 0,
        clientes: funnel[stage]?.byRole.CLIENT ?? 0,
        prestadores: funnel[stage]?.byRole.PROVIDER ?? 0,
      }))
    : []

  return (
    <PageTransition className="space-y-6 p-6">
      {/* Period filter */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Analytics de Conversão</h2>
          <p className="text-muted-foreground text-sm">Funil completo de aquisição e retenção</p>
        </div>
        <div className="bg-muted flex gap-1 rounded-lg p-1">
          {(["7d", "30d", "90d"] as Period[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? "default" : "ghost"}
              size="sm"
              onClick={() => setPeriod(p)}
              className="h-7 text-xs"
            >
              {p === "7d" ? "7 dias" : p === "30d" ? "30 dias" : "90 dias"}
            </Button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <StaggerChildren className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" staggerMs={80}>
        <KpiCard
          icon={TrendingUp}
          label="Conversão Global"
          value={`${globalConversion}%`}
          description={`${totalBookings} agendamentos de ${totalLandings} visitas`}
          trend={Number(globalConversion) > 5 ? "up" : "neutral"}
        />
        <KpiCard
          icon={Activity}
          label="Taxa de Conclusão"
          value={`${completionRate}%`}
          description={`${totalCompleted} serviços concluídos`}
          trend={Number(completionRate) > 80 ? "up" : "neutral"}
        />
        <KpiCard
          icon={Users}
          label="Retenção"
          value={`${retentionRate}%`}
          description={`${totalRetention} clientes recorrentes`}
          trend={Number(retentionRate) > 20 ? "up" : "down"}
        />
        <KpiCard
          icon={BarChart3}
          label="Volume Total"
          value={String(totalLandings)}
          description={`Visitas nos últimos ${PERIOD_DAYS[period]} dias`}
          trend="neutral"
        />
      </StaggerChildren>

      {/* Funnel Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Funil de Conversão</CardTitle>
          <CardDescription>Volume por estágio do funil — Landing → Retenção</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={funnelChartData} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="stage" type="category" width={90} tick={{ fontSize: 11 }} />
              <RechartsTooltip
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--popover)",
                  color: "var(--popover-foreground)",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="total" fill="var(--chart-1)" radius={[0, 4, 4, 0]} name="Total" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Conversion Rates */}
      {rates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Taxas de Conversão entre Estágios</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              {rates.map((r, i) => (
                <React.Fragment key={i}>
                  <div className="flex flex-col items-center gap-0.5 rounded-lg border px-3 py-2">
                    <span className="text-muted-foreground text-[10px]">
                      {STAGE_LABELS[r.from]}
                    </span>
                    <span className="text-sm font-bold">{r.absolute}</span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <ArrowRight className="text-muted-foreground size-3.5" />
                    <span
                      className={cn(
                        "text-[10px] font-bold",
                        r.rate !== null && r.rate > 50
                          ? "text-emerald-600"
                          : r.rate !== null && r.rate > 20
                            ? "text-amber-600"
                            : "text-red-500",
                      )}
                    >
                      {r.rate !== null ? `${r.rate}%` : "—"}
                    </span>
                  </div>
                </React.Fragment>
              ))}
              {/* Last stage */}
              {rates.length > 0 && (
                <div className="flex flex-col items-center gap-0.5 rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground text-[10px]">
                    {STAGE_LABELS[rates[rates.length - 1]!.to]}
                  </span>
                  <span className="text-sm font-bold">{rates[rates.length - 1]!.absolute}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trend Line */}
      {trend.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tendência de Agendamentos</CardTitle>
            <CardDescription>Volume diário nos últimos {PERIOD_DAYS[period]} dias</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(d: string) => {
                    const parts = d.split("-")
                    return `${parts[2]}/${parts[1]}`
                  }}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <RechartsTooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--popover)",
                    color: "var(--popover-foreground)",
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                  name="Agendamentos"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </PageTransition>
  )
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------
function KpiCard({
  icon: Icon,
  label,
  value,
  description,
  trend,
}: {
  icon: React.ElementType
  label: string
  value: string
  description: string
  trend: "up" | "down" | "neutral"
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm font-medium">{label}</span>
          <Icon className="text-muted-foreground size-4" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight">{value}</span>
          {trend === "up" && <TrendingUp className="size-4 text-emerald-500" />}
          {trend === "down" && <TrendingDown className="size-4 text-red-500" />}
        </div>
        <p className="text-muted-foreground mt-1 text-xs">{description}</p>
      </CardContent>
    </Card>
  )
}

export default AdminAnalyticsDashboard
