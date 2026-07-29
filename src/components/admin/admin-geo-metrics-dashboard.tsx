"use client"

/**
 * AdminGeoMetricsDashboard — Geo Performance Monitoring
 *
 * Exibe P50 / P95 / P99 de latência para Nominatim, ViaCEP e PostGIS
 * em gráficos de barras horizontais com atualização automática.
 *
 * Data source: GET /api/admin/geo-metrics
 */

import * as React from "react"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Globe,
  RefreshCw,
  Search,
  Timer,
  TrendingDown,
  TrendingUp,
  MapPin,
  Database,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { apiGet } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { ErrorState } from "@/components/admin/admin-shared"

import type { GeoMetricsResponse } from "@/app/api/admin/geo-metrics/route"

// ── Chart tooltip style ──────────────────────────────────────────────────

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.1)",
  padding: "8px 10px",
}

// ── Color palette ────────────────────────────────────────────────────────

const COLOR_P50 = "hsl(160, 84%, 39%)"
const COLOR_P95 = "hsl(38, 92%, 50%)"
const COLOR_P99 = "hsl(0, 72%, 51%)"

const SERVICE_ICONS: Record<string, React.ElementType> = {
  nominatim: Search,
  viacep: MapPin,
  postgis: Database,
}

const SERVICE_DESC: Record<string, string> = {
  nominatim: "Geocoding via OpenStreetMap",
  viacep: "Busca de CEP via ViaCEP",
  postgis: "Consultas espaciais PostGIS",
}

// ── Helpers ──────────────────────────────────────────────────────────────

function latencyColor(ms: number): string {
  if (ms > 1000) return COLOR_P99
  if (ms > 200) return COLOR_P95
  return COLOR_P50
}

function formatMs(ms: number): string {
  return ms < 1 ? "<1ms" : `${Math.round(ms)}ms`
}

function errorRateLabel(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

// ── Main component ───────────────────────────────────────────────────────

export function AdminGeoMetricsDashboard() {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "geo-metrics"],
    queryFn: () => apiGet<GeoMetricsResponse>("/api/admin/geo-metrics"),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar métricas de geolocalização"
        description="Verifique se você está autenticado como administrador."
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return <GeoSkeleton />
  }

  const { services, windowSeconds, labels } = data
  const _unusedTimestamp = data.timestamp

  // Build chart data for each service
  type ServiceChartItem = {
    name: string
    key: string
    p50: number
    p95: number
    p99: number
  }

  const chartData: ServiceChartItem[] = Object.entries(services).map(([key, metrics]) => ({
    name: labels[key] ?? key,
    key,
    p50: Math.round(metrics.p50),
    p95: Math.round(metrics.p95),
    p99: Math.round(metrics.p99),
  }))

  // P95 sorted desc for the main bar chart
  const sortedByP95 = [...chartData].sort((a, b) => b.p95 - a.p95)

  // Summary stats
  const totalCalls = Object.values(services).reduce((a, s) => a + s.count, 0)
  const totalErrors = Object.values(services).reduce((a, s) => a + s.errorCount, 0)
  const maxP95 = Math.max(...Object.values(services).map((s) => s.p95))
  const healthyCount = Object.values(services).filter(
    (s) => s.errorRate < 0.05 && s.count > 0,
  ).length

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-xl font-bold tracking-tight">
            Métricas de Geolocalização
          </h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Latência P50/P95/P99 dos serviços de geocoding e PostGIS
          </p>
        </div>

        <div className="flex items-center gap-3">
          {dataUpdatedAt ? (
            <span className="text-muted-foreground text-xs">
              Atualizado {new Date(dataUpdatedAt).toLocaleTimeString("pt-BR")}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="bg-muted/50 text-muted-foreground hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-50"
            aria-label="Atualizar métricas"
          >
            <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────── */}
      <section
        aria-label="KPIs de geolocalização"
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        <KpiCard
          icon={Activity}
          label="Chamadas (janela)"
          value={totalCalls.toLocaleString("pt-BR")}
          subtitle={`Últimos ${windowSeconds / 60} min`}
          trend={totalCalls > 0 ? "up" : "down"}
        />
        <KpiCard
          icon={Timer}
          label="P95 Máximo"
          value={formatMs(maxP95)}
          subtitle="Entre todos os serviços"
          trend={maxP95 > 500 ? "up" : "down"}
        />
        <KpiCard
          icon={totalErrors > 0 ? AlertTriangle : CheckCircle2}
          label="Erros"
          value={String(totalErrors)}
          subtitle={`${errorRateLabel(totalCalls > 0 ? totalErrors / totalCalls : 0)} taxa`}
          trend={totalErrors > 0 ? "up" : "down"}
        />
        <KpiCard
          icon={Globe}
          label="Serviços Saudáveis"
          value={`${healthyCount}/${Object.keys(services).length}`}
          subtitle="Taxa de erro &lt; 5%"
          trend={healthyCount === Object.keys(services).length ? "down" : "up"}
        />
      </section>

      {/* ── Latency Bar Chart ───────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* P50 / P95 / P99 por serviço */}
        <MetricCard icon={BarChart3} title="Latência por Serviço (ms)">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={sortedByP95}
                layout="vertical"
                margin={{ left: 100, right: 16, top: 8, bottom: 8 }}
              >
                <CartesianGrid
                  horizontal={false}
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border) / 0.5)"
                />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  width={90}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, n: string) => [
                    `${Math.round(v)}ms`,
                    n === "p95" ? "P95" : n === "p50" ? "P50" : "P99",
                  ]}
                />
                <Bar dataKey="p95" name="P95" radius={[0, 3, 3, 0]} barSize={14}>
                  {sortedByP95.map((entry) => (
                    <Cell key={entry.key} fill={latencyColor(entry.p95)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>

        {/* Percentile detail per service */}
        <MetricCard icon={BarChart3} title="P50 / P95 / P99 por Serviço">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border) / 0.5)"
                />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [`${Math.round(v)}ms`]}
                />
                <Bar
                  dataKey="p50"
                  name="P50"
                  stackId="a"
                  fill={COLOR_P50}
                  radius={[0, 0, 0, 0]}
                  barSize={24}
                />
                <Bar
                  dataKey="p95"
                  name="P95"
                  stackId="a"
                  fill={COLOR_P95}
                  radius={[0, 0, 0, 0]}
                  barSize={24}
                />
                <Bar
                  dataKey="p99"
                  name="P99"
                  stackId="a"
                  fill={COLOR_P99}
                  radius={[0, 3, 3, 0]}
                  barSize={24}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>
      </section>

      {/* ── Detailed service cards ──────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {Object.entries(services).map(([key, metrics]) => {
          const Icon = SERVICE_ICONS[key] ?? Globe
          const isHealthy = metrics.errorRate < 0.05 && metrics.count > 0
          return (
            <div
              key={key}
              className="border-border/50 bg-card hover:border-primary/20 rounded-xl border transition-colors"
            >
              <div className="flex items-center gap-3 border-b px-5 py-4">
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg",
                    isHealthy
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-sm font-semibold">{labels[key] ?? key}</p>
                  <p className="text-muted-foreground text-[11px]">{SERVICE_DESC[key] ?? ""}</p>
                </div>
                {isHealthy ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                ) : (
                  <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                )}
              </div>
              <div className="space-y-3 p-4">
                {/* Percentile bars */}
                <LatencyBar label="P50" value={metrics.p50} max={Math.max(metrics.p99, 1)} />
                <LatencyBar label="P95" value={metrics.p95} max={Math.max(metrics.p99, 1)} />
                <LatencyBar label="P99" value={metrics.p99} max={Math.max(metrics.p99, 1)} />

                <div className="border-t pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Chamadas</span>
                    <span className="font-medium tabular-nums">
                      {metrics.count.toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Taxa de erro</span>
                    <span
                      className={cn(
                        "font-medium tabular-nums",
                        metrics.errorRate > 0.05
                          ? "text-red-500"
                          : metrics.errorRate > 0.01
                            ? "text-amber-500"
                            : "text-emerald-500",
                      )}
                    >
                      {errorRateLabel(metrics.errorRate)}
                    </span>
                  </div>
                  {metrics.errorCount > 0 && (
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Último erro</span>
                      <span className="text-muted-foreground text-[10px] tabular-nums">
                        {metrics.lastSampleAt
                          ? new Date(metrics.lastSampleAt).toLocaleTimeString("pt-BR")
                          : "—"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </section>

      {/* ── Info note ────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-800/30 dark:bg-blue-950/20 dark:text-blue-300">
        <p className="font-medium">📊 Janela deslizante de {windowSeconds / 60} minutos</p>
        <p className="mt-1">
          As métricas são coletadas em memória e resetam com cada restart do servidor. Para
          armazenamento persistente das séries históricas, configure Redis como backend de métricas.
        </p>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  subtitle,
  trend,
}: {
  icon: React.ElementType
  label: string
  value: string
  subtitle?: string
  trend?: "up" | "down"
}) {
  return (
    <div className="border-border/50 bg-card hover:border-primary/20 rounded-xl border p-5 transition-colors">
      <div className="flex items-start justify-between">
        <span className="bg-primary/8 text-primary flex size-10 items-center justify-center rounded-lg">
          <Icon className="size-5" />
        </span>
        {trend ? (
          trend === "up" ? (
            <TrendingUp className="size-4 text-red-500" />
          ) : (
            <TrendingDown className="size-4 text-emerald-500" />
          )
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs font-medium tracking-wider uppercase">
        {label}
      </p>
      {subtitle ? <p className="text-muted-foreground mt-0.5 text-[10px]">{subtitle}</p> : null}
    </div>
  )
}

function MetricCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border-border/50 bg-card rounded-xl border">
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <Icon className="text-primary size-4" />
        <h2 className="text-foreground text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function LatencyBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground w-8 text-right text-xs font-medium">{label}</span>
      <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            backgroundColor: latencyColor(value),
          }}
        />
      </div>
      <span
        className="w-14 text-right text-xs font-medium tabular-nums"
        style={{ color: latencyColor(value) }}
      >
        {formatMs(value)}
      </span>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function GeoSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border p-5">
            <Skeleton className="size-10 rounded-lg" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-1 h-3 w-16" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border">
            <div className="border-b px-5 py-4">
              <Skeleton className="h-4 w-48" />
            </div>
            <div className="p-4">
              <Skeleton className="h-[220px] w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border">
            <div className="border-b px-5 py-4">
              <Skeleton className="h-9 w-40" />
            </div>
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, j) => (
                <Skeleton key={j} className="h-4 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
