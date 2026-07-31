"use client"

/**
 * AdminGeoMetricsDashboard — Geo Performance Monitoring
 *
 * Exibe P50 / P95 / P99 de latência para Nominatim, ViaCEP e PostGIS
 * em gráficos de barras com atualização automática. Inclui:
 *   - Live metrics: latência atual dos serviços geo
 *   - Benchmark comparison: Haversine JS vs PostGIS (dados reais)
 *   - Evolução temporal: P50/P95/P99 ao longo dos snapshots
 *
 * Data source: GET /api/admin/geo-metrics
 */

import * as React from "react"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CheckCircle2,
  Globe,
  Search,
  Timer,
  MapPin,
  Database,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { apiGet } from "@/lib/api"
import {
  BenchmarkSection,
  DashboardHeader,
  ErrorState,
  formatMs,
  GeoSkeleton,
  GiSTSelectivitySection,
  KpiCard,
  LatencyBar,
  latencyColor,
  MetricCard,
  TimelineSection,
} from "./_shared"
import { COLOR_P50, COLOR_P95, COLOR_P99, TOOLTIP_STYLE } from "./admin-chart-theme"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

import type { GeoMetricsResponse } from "@/app/api/admin/geo-metrics/route"

// ── Chart tooltip style ──────────────────────────────────────────────────

// ── Color palette ────────────────────────────────────────────────────────

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

  const { services, windowSeconds, labels, baselines = {} } = data

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

  // P95 vs baseline alert: which services are exceeding 2x baseline?
  const exceededServices = Object.entries(services).filter(([key, metrics]) => {
    const baseline = baselines[key]
    return baseline != null && metrics.p95 > baseline * 2
  })
  const hasExceeded = exceededServices.length > 0

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* ── P95 Exceeded Alert Banner ────────────────────────────────── */}
      {hasExceeded && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4 dark:border-red-800/30 dark:bg-red-950/20"
        >
          <Bell className="mt-0.5 size-5 shrink-0 text-red-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">
              P95 acima do limiar de alerta
            </p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-400">
              {exceededServices
                .map(([key, metrics]) => {
                  const baseline = baselines[key]
                  const threshold = Math.round(baseline * 2)
                  return `${labels[key] ?? key}: ${Math.round(metrics.p95)}ms (limiar: ${threshold}ms)`
                })
                .join(" · ")}
            </p>
          </div>
        </div>
      )}

      <DashboardHeader
        title="Métricas de Geolocalização"
        description="Latência P50/P95/P99 dos serviços de geocoding e PostGIS"
        isFetching={isFetching}
        onRefresh={() => void refetch()}
        dataUpdatedAt={dataUpdatedAt}
        refreshLabel="Atualizar métricas"
      />

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
          trend={maxP95 > 500 ? "down" : "up"}
        />
        <KpiCard
          icon={totalErrors > 0 ? AlertTriangle : CheckCircle2}
          label="Erros"
          value={String(totalErrors)}
          subtitle={`${errorRateLabel(totalCalls > 0 ? totalErrors / totalCalls : 0)} taxa`}
          trend={totalErrors > 0 ? "down" : "up"}
        />
        <KpiCard
          icon={Globe}
          label="Serviços Saudáveis"
          value={`${healthyCount}/${Object.keys(services).length}`}
          subtitle="Taxa de erro &lt; 5%"
          trend={healthyCount === Object.keys(services).length ? "up" : "down"}
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
                {/* Reference line: 2x P95 baseline for the top-most service */}
                {sortedByP95.length > 0 && baselines[sortedByP95[0]!.key] != null && (
                  <ReferenceLine
                    x={Math.round(baselines[sortedByP95[0]!.key]! * 2)}
                    stroke="hsl(0, 72%, 51%)"
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    label={{
                      value: "2× baseline",
                      position: "insideTopRight",
                      fill: "hsl(0, 72%, 51%)",
                      fontSize: 10,
                    }}
                  />
                )}
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
          const baseline = baselines[key]
          const p95Exceeded = baseline != null && metrics.p95 > baseline * 2
          return (
            <div
              key={key}
              className={cn(
                "border-border/50 bg-card rounded-xl border transition-colors",
                p95Exceeded
                  ? "border-red-200 hover:border-red-300 dark:border-red-800/30 dark:hover:border-red-700"
                  : "hover:border-primary/20",
              )}
            >
              <div className="flex items-center gap-3 border-b px-5 py-4">
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg",
                    p95Exceeded
                      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      : isHealthy
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
                {p95Exceeded ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center justify-center"
                        aria-label="Detalhes do alerta P95"
                      >
                        <Bell className="size-4 shrink-0 text-red-500" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="end" className="max-w-[260px] space-y-1.5">
                      <p className="font-semibold">🔔 P95 excedeu 2× baseline</p>
                      <div className="text-muted-foreground space-y-1 text-[11px]">
                        <p>
                          <span className="text-foreground font-medium">Baseline:</span>{" "}
                          {baseline != null ? `${Math.round(baseline)}ms` : "—"}
                          {" → "}2× limiar:{" "}
                          <span className="font-medium text-red-500">
                            {baseline != null ? `${Math.round(baseline * 2)}ms` : "—"}
                          </span>
                        </p>
                        <p>
                          <span className="text-foreground font-medium">P95 atual:</span>{" "}
                          <span className="font-medium text-red-500">
                            {Math.round(metrics.p95)}ms
                          </span>
                        </p>
                        <p>
                          <span className="text-foreground font-medium">Excedente:</span>{" "}
                          {baseline != null
                            ? `${Math.round(metrics.p95 - baseline * 2)}ms acima do limiar`
                            : "—"}
                        </p>
                        <p>
                          <span className="text-foreground font-medium">Última amostra:</span>{" "}
                          {metrics.lastSampleAt
                            ? new Date(metrics.lastSampleAt).toLocaleString("pt-BR")
                            : "—"}
                        </p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ) : isHealthy ? (
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
                    <span className="text-muted-foreground">P95 vs Baseline</span>
                    <span
                      className={cn(
                        "font-medium tabular-nums",
                        p95Exceeded ? "text-red-500" : "text-muted-foreground",
                      )}
                    >
                      {baseline != null
                        ? `${Math.round(metrics.p95)}ms / ${Math.round(baseline)}ms`
                        : `${Math.round(metrics.p95)}ms`}
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

      {/* ── GiST Selectivity vs Cost Curve ───────────────────────── */}
      {data.benchmark != null &&
        "comparisons" in data.benchmark &&
        data.benchmark.comparisons.length > 0 && (
          <GiSTSelectivitySection
            benchmark={data.benchmark}
            history={data.history}
            baselines={baselines}
            onReindexSuccess={() => void refetch()}
            isRefetching={isFetching}
          />
        )}

      {/* ── Benchmark Comparison ──────────────────────────────────── */}
      {data.benchmark != null &&
        "comparisons" in data.benchmark &&
        data.benchmark.comparisons.length > 0 && <BenchmarkSection benchmark={data.benchmark} />}

      {/* ── Historical Evolution (P50/P95/P99 timeline) ───────────── */}
      {data.history != null && data.history.length > 1 && (
        <TimelineSection history={data.history} labels={data.labels} baselines={baselines} />
      )}

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

// ── BenchmarkSection was extracted to src/components/admin/benchmark-section.tsx ──

// ── Timeline Evolution Section was extracted to src/components/admin/timeline-section.tsx ──

// ── LatencyBar + GeoSkeleton were extracted to:
//    src/components/admin/geo-latency-bar.tsx
//    src/components/admin/geo-skeleton.tsx
