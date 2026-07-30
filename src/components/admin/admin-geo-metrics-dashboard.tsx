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
  RefreshCw,
  Search,
  Timer,
  TrendingDown,
  TrendingUp,
  MapPin,
  Database,
  LineChart as LineChartIcon,
  GitCompareArrows,
  Zap,
  Microscope,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { apiGet } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { ErrorState } from "@/components/admin/admin-shared"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

import type { GeoMetricsResponse } from "@/app/api/admin/geo-metrics/route"
import {
  POSTGIS_FIXED_US,
  POSTGIS_PER_ROW_US,
  PROVIDER_COUNTS,
  computeSelectivityPoints,
  computeCrossovers,
  computeMeasuredFull,
  computeP95Stats,
  computeCostAtSelectivity,
  radiusToSelectivity,
  selectivityToRadiusLabel,
  REFERENCE_RADIUS_KM,
  modelPostGISFullMs,
  modelDelta,
} from "@/lib/geo-benchmark-model"
import { buildBenchmarkBarData, getMaxPostgisLatency, ratioColor } from "@/lib/benchmark-data"

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

// ── Benchmark Comparison Section ──────────────────────────────────────────

function BenchmarkSection({
  benchmark,
}: {
  benchmark: NonNullable<GeoMetricsResponse["benchmark"]>
}) {
  const barData = buildBenchmarkBarData(benchmark)

  const maxLatency = getMaxPostgisLatency(barData)

  return (
    <section aria-label="Comparação de benchmark" className="space-y-6">
      <div className="flex items-center gap-2">
        <Microscope className="size-5 text-purple-500" />
        <h2 className="text-foreground text-lg font-semibold">
          Benchmark Real — Haversine JS vs PostGIS
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <MetricCard icon={GitCompareArrows} title="Latência Média (µs) — Escala Log">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
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
                  scale="log"
                  domain={[1, maxLatency * 2]}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  width={100}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, n: string) => [
                    `${v.toFixed(1)}µs`,
                    n === "haversine" ? "Haversine JS" : "PostGIS",
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                <Bar
                  dataKey="haversine"
                  name="Haversine JS"
                  fill={COLOR_P50}
                  radius={[0, 3, 3, 0]}
                  barSize={12}
                />
                <Bar
                  dataKey="postgis"
                  name="PostGIS"
                  fill={COLOR_P99}
                  radius={[0, 3, 3, 0]}
                  barSize={12}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>

        {/* Use opsPerSec instead of mean for the throughput chart */}
        <MetricCard icon={Zap} title="Throughput (ops/sec)">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
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
                  scale="log"
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  width={100}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, n: string) => [
                    `${v.toLocaleString()} ops/s`,
                    n === "haversine_ops" ? "Haversine JS" : n === "postgis_ops" ? "PostGIS" : n,
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                <Bar
                  dataKey="haversine_ops"
                  name="Haversine JS"
                  fill={COLOR_P50}
                  radius={[0, 3, 3, 0]}
                  barSize={12}
                />
                <Bar
                  dataKey="postgis_ops"
                  name="PostGIS"
                  fill={COLOR_P99}
                  radius={[0, 3, 3, 0]}
                  barSize={12}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>

        <MetricCard icon={BarChart3} title="Razão PostGIS / Haversine">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
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
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  width={100}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [`${v}×`, "Razão"]}
                />
                <Bar dataKey="ratio" name="Razão" radius={[0, 3, 3, 0]} barSize={20}>
                  {barData.map((entry) => (
                    <Cell key={entry.label} fill={ratioColor(entry.ratio)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="border-border/50 bg-muted/20 mt-3 rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">
              <span className="text-foreground font-medium">Análise:</span>{" "}
              {benchmark.analysis.note}
            </p>
            <p className="text-muted-foreground mt-1 text-[10px]">
              Benchmark executado em {benchmark.meta.platform} ({benchmark.meta.nodeVersion}) —{" "}
              centro em {benchmark.meta.centerLabel} —{" "}
              {new Date(benchmark.meta.timestamp).toLocaleDateString("pt-BR")}
            </p>
          </div>
        </MetricCard>
      </div>
    </section>
  )
}

// ── Timeline Evolution Section ────────────────────────────────────────────

function TimelineSection({
  history,
  labels,
  baselines,
}: {
  history: NonNullable<GeoMetricsResponse["history"]>
  labels: Record<string, string>
  baselines: Record<string, number>
}) {
  // Compute the 2x P95 baseline per service for the ReferenceLine
  const baselineThresholds = Object.keys(history[0]?.services ?? {}).reduce<
    Record<string, number | null>
  >((acc, svc) => {
    const bl = baselines[svc]
    acc[svc] = bl != null ? Math.round(bl * 2) : null
    return acc
  }, {})
  // Build timeline data: one row per snapshot timestamp
  const timelineData: Array<Record<string, string | number>> = history.map((snap) => {
    const time = new Date(snap.timestamp)
    const row: Record<string, string | number> = {
      time: time.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      ts: snap.timestamp,
    }
    // Flatten for Recharts
    for (const [key, val] of Object.entries(snap.services)) {
      row[`${key}_p50`] = Math.round(val.p50)
      row[`${key}_p95`] = Math.round(val.p95)
      row[`${key}_p99`] = Math.round(val.p99)
    }
    return row
  })

  const serviceKeys = Object.keys(history[0]?.services ?? {})

  return (
    <section aria-label="Evolução temporal" className="space-y-6">
      <div className="flex items-center gap-2">
        <LineChartIcon className="size-5 text-violet-500" />
        <h2 className="text-foreground text-lg font-semibold">
          Evolução Temporal — P50 / P95 / P99
        </h2>
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium">
          {history.length} snapshots
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {serviceKeys.map((svc) => {
          const svcLabel = labels[svc] ?? svc
          const dataHasSamples = timelineData.some((d) => Number(d[`${svc}_p50`] ?? 0) > 0)
          if (!dataHasSamples) return null

          return (
            <MetricCard key={svc} icon={LineChartIcon} title={`${svcLabel} — P50 / P95 / P99 (ms)`}>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timelineData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                    <XAxis
                      dataKey="time"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={45}
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      label={{
                        value: "ms",
                        angle: -90,
                        position: "insideLeft",
                        style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                      }}
                    />
                    <RTooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(v: number, n: string) => {
                        const label =
                          n === `${svc}_p50` ? "P50" : n === `${svc}_p95` ? "P95" : "P99"
                        return [`${Math.round(v)}ms`, label]
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                    {/* Reference line: 2x P95 baseline for this service */}
                    {baselineThresholds[svc] != null && (
                      <ReferenceLine
                        y={baselineThresholds[svc]!}
                        stroke="hsl(0, 72%, 51%)"
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                        label={{
                          value: "2× baseline",
                          position: "right",
                          fill: "hsl(0, 72%, 51%)",
                          fontSize: 9,
                        }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey={`${svc}_p50`}
                      name="P50"
                      stroke={COLOR_P50}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey={`${svc}_p95`}
                      name="P95"
                      stroke={COLOR_P95}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey={`${svc}_p99`}
                      name="P99"
                      stroke={COLOR_P99}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </MetricCard>
          )
        })}
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-800/30 dark:bg-blue-950/20 dark:text-blue-300">
        <p className="font-medium">⏱ Cada snapshot é coletado automaticamente a cada poll (30s)</p>
        <p className="mt-1">
          O histórico é mantido em memória no servidor (últimos {history.length} snapshots). Os
          snapshots são resetados com cada restart do servidor.
        </p>
      </div>
    </section>
  )
}

// ── GiST Selectivity vs Cost Section ──────────────────────────────────────

export function GiSTSelectivitySection({
  benchmark,
  history,
  baselines,
}: {
  benchmark: NonNullable<GeoMetricsResponse["benchmark"]>
  history: NonNullable<GeoMetricsResponse["history"]> | null
  baselines: Record<string, number>
}) {
  // Use benchmark's avgHaversinePerProvider (dynamic, changes per run)
  const haversinePerProviderUs =
    benchmark.analysis.avgHaversinePerProvider > 0
      ? benchmark.analysis.avgHaversinePerProvider
      : 0.1323 // fallback hardcoded

  // ── Radius + Density state ────────────────────────────────────────
  const [radiusKm, setRadiusKm] = React.useState(15)
  const [density, setDensity] = React.useState(10) // providers/km²
  const [useLogScale, setUseLogScale] = React.useState(true)

  // Estimated providers within the search area at current density
  const estimatedProviders = Math.round(density * Math.PI * radiusKm * radiusKm)

  // Density label for display
  const densityLabel =
    density <= 3
      ? `Interior (~${density}/km²)`
      : density <= 7
        ? `Sul/Sudeste (~${density}/km²)`
        : density <= 15
          ? `São Paulo (~${density}/km²)`
          : `Metrópole (~${density}/km²)`

  // Compute selectivity from selected radius
  const currentSelectivity = radiusToSelectivity(radiusKm)
  const selPct = Math.round(currentSelectivity * 100)

  // Generate selectivity curve data points via extracted pure function
  const selectivityPoints = computeSelectivityPoints(benchmark.comparisons, haversinePerProviderUs)

  // Compute crossover points via extracted pure function
  const crossovers = computeCrossovers(haversinePerProviderUs)

  // Get measured full-scan latencies from benchmark
  const measuredFull = computeMeasuredFull(benchmark.comparisons)

  // ── Cost at selected radius ────────────────────────────────────────
  const costData = computeCostAtSelectivity(currentSelectivity, haversinePerProviderUs)

  // Regime indicators from cost data
  const pgFasterCount = costData.filter((c) => c.faster === "PostGIS").length
  const havFasterCount = costData.filter((c) => c.faster === "Haversine").length

  // Snap selectivity to nearest 5% for ReferenceLine (X axis uses category labels)
  const snapPct = Math.min(Math.round(currentSelectivity * 20) * 5, 100)
  const refLineLabel = `${snapPct}%`

  // ── Real P95 band from geo-metrics history (PostGIS) ────────────────
  const p95Stats = computeP95Stats(history)
  const hasP95Data = p95Stats.count > 0
  const p95Mean = p95Stats.mean
  const p95Min = p95Stats.min
  const p95Max = p95Stats.max
  const p95Stdev = p95Stats.stdev
  const postgisP95ValuesCount = p95Stats.count

  // ── GiST degradation check: real P95 exceeds ALL model curves ─────
  const currentSelLabel = `${snapPct}%`
  const selRow = selectivityPoints.find(
    (r: Record<string, unknown>) => r.selectivity === currentSelLabel,
  )
  let gistDegraded = false
  let maxModelAtSelectivity = 0
  let exceedingCount = 0

  // Inject cost data into the selectivityPoints row at the reference line
  // so the chart tooltip can show cost-per-provider at the selected radius.
  const refLineRow = selectivityPoints.find(
    (r: Record<string, unknown>) => r.selectivity === refLineLabel,
  )
  if (refLineRow) {
    for (const c of costData) {
      const label = c.n >= 1000 ? `${(c.n / 1000).toFixed(0)}k` : String(c.n)
      refLineRow[`cost_pg_${c.n}`] = c.postgisMs
      refLineRow[`cost_hav_${c.n}`] = c.haversineMs
      refLineRow[`cost_ratio_${c.n}`] = c.ratio
      refLineRow[`cost_faster_${c.n}`] = c.faster
      refLineRow[`cost_label_${c.n}`] = label
    }
  }

  if (hasP95Data && selRow) {
    const pgKeys = PROVIDER_COUNTS.map((n) => `pg_${n}`)
    let maxVal = 0
    let exceeding = 0
    for (const k of pgKeys) {
      const v = Number(selRow[k] ?? 0)
      if (v > maxVal) maxVal = v
      if (p95Mean > v) exceeding++
    }
    maxModelAtSelectivity = maxVal
    exceedingCount = exceeding
    gistDegraded = p95Mean > maxVal
  }

  return (
    <section aria-label="Seletividade GiST vs Custo" className="space-y-6">
      <div className="flex items-center gap-2">
        <Database className="size-5 text-sky-500" />
        <h2 className="text-foreground text-lg font-semibold">
          Curva de Seletividade — GiST Index vs Haversine
        </h2>
      </div>

      {/* ── GiST Degradation Alert ──────────────────────────────────── */}
      {gistDegraded && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-5 py-4 dark:border-red-800/40 dark:bg-red-950/20"
        >
          <Database className="mt-0.5 size-5 shrink-0 text-red-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">
              🛑 Índice GiST degradado
            </p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-400">
              P95 real ({Math.round(p95Mean)}ms) ultrapassou <strong>todas</strong> as curvas
              teóricas do modelo PostGIS em <strong>{radiusKm} km</strong> (seletividade {snapPct}
              %). A curva mais alta do modelo prevê {maxModelAtSelectivity.toFixed(1)}ms. O índice
              GiST pode estar com performance degradada —{" "}
              {exceedingCount >= PROVIDER_COUNTS.length
                ? "todas as escalas de provedores estão acima do esperado."
                : `${exceedingCount} de ${PROVIDER_COUNTS.length} escalas de provedores estão acima do esperado.`}
            </p>
          </div>
        </div>
      )}

      {/* ── Radius Selector ─────────────────────────────────────────── */}
      <MetricCard icon={MapPin} title="Selecionar Raio de Busca">
        <div className="flex flex-col gap-4">
          {/* Slider */}
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground w-14 text-right text-xs font-medium">
              {radiusKm} km
            </span>
            <input
              type="range"
              min={1}
              max={REFERENCE_RADIUS_KM}
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="accent-primary h-2 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-sky-300 via-amber-300 to-red-300"
              aria-label="Raio de busca em km"
            />
          </div>

          {/* Preset buttons */}
          <div className="flex flex-wrap gap-2">
            {[5, 15, 30, 50].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRadiusKm(r)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  radiusKm === r
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-muted/70",
                )}
              >
                {r} km
              </button>
            ))}
          </div>

          {/* Density Slider */}
          <div className="border-t pt-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-muted-foreground text-[10px] font-medium">
                Densidade: {densityLabel}
              </span>
              <span className="text-muted-foreground text-[10px]">
                ~{estimatedProviders.toLocaleString("pt-BR")} providers na área
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground w-10 text-right text-[10px] font-medium">
                {density}/km²
              </span>
              <input
                type="range"
                min={2}
                max={50}
                value={density}
                onChange={(e) => setDensity(Number(e.target.value))}
                className="accent-primary h-2 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-emerald-300 via-sky-300 to-violet-300"
                aria-label="Densidade de providers por km²"
              />
            </div>
            <div className="mt-1.5 flex gap-2">
              {[
                { v: 2, label: "Interior" },
                { v: 8, label: "RJ" },
                { v: 10, label: "SP" },
                { v: 30, label: "Metrópole" },
              ].map((p) => (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => setDensity(p.v)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[10px] font-medium transition-all",
                    density === p.v
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-muted/70",
                  )}
                >
                  {p.label} {p.v}/km²
                </button>
              ))}
            </div>
          </div>

          {/* Selectivity indicator */}
          <div className="flex items-center gap-3 rounded-lg border bg-blue-50 px-3 py-2 text-xs dark:bg-blue-950/10">
            <span className="text-foreground font-semibold">{selPct}%</span>
            <span className="text-muted-foreground">
              dos providers em <strong>{radiusKm} km</strong>
              {currentSelectivity > 0 && (
                <>
                  {" · "}seletividade equivalente a{" "}
                  <strong>{selectivityToRadiusLabel(currentSelectivity)}</strong>
                </>
              )}
            </span>
          </div>
        </div>
      </MetricCard>

      {/* Main chart: selectivity vs latency */}
      <MetricCard icon={LineChartIcon} title="Custo por Seletividade (ms)">
        {/* Scale toggle */}
        <div className="flex items-center justify-end gap-2 px-1 pb-3">
          <span className="text-muted-foreground text-[10px]">
            Escala: {useLogScale ? "Log" : "Linear"}
          </span>
          <button
            type="button"
            onClick={() => setUseLogScale((prev) => !prev)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
              useLogScale ? "bg-primary border-primary" : "bg-muted border-border",
            )}
            role="switch"
            aria-checked={useLogScale}
            aria-label="Alternar escala Log/Linear"
          >
            <span
              className={cn(
                "inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                useLogScale ? "translate-x-[18px]" : "translate-x-[2px]",
              )}
            />
          </button>
        </div>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={selectivityPoints} margin={{ left: 8, right: 8, top: 16, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
              <XAxis
                dataKey="selectivity"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{
                  value: "Seletividade (% providers within radius)",
                  position: "bottom",
                  style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={50}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{
                  value: "Latência (ms)",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                }}
                scale={useLogScale ? "log" : "linear"}
                domain={useLogScale ? ["auto", "auto"] : [0, "auto"]}
              />
              <RTooltip
                content={
                  <GiSTCostTooltip
                    refLineLabel={refLineLabel}
                    radiusKm={radiusKm}
                    selPct={selPct}
                    hasP95Data={hasP95Data}
                    p95Mean={p95Mean}
                  />
                }
              />
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} iconSize={8} />

              {/* PostGIS filtered lines (one per provider count) */}
              {PROVIDER_COUNTS.map((n, idx) => (
                <Line
                  key={`pg_${n}`}
                  type="monotone"
                  dataKey={`pg_${n}`}
                  name={`PostGIS filtrado (${n >= 1000 ? `${n / 1000}k` : n})`}
                  stroke={`hsl(${200 + idx * 30}, 70%, ${50 + idx * 5}%)`}
                  strokeWidth={2}
                  strokeDasharray={idx > 1 ? "4 2" : "none"}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}

              {/* Haversine lines (reference) */}
              {PROVIDER_COUNTS.map((n, idx) => (
                <Line
                  key={`hav_${n}`}
                  type="monotone"
                  dataKey={`hav_${n}`}
                  name={`Haversine (${n >= 1000 ? `${n / 1000}k` : n})`}
                  stroke={`hsl(${140 + idx * 10}, 50%, ${45 + idx * 5}%)`}
                  strokeWidth={1.5}
                  strokeDasharray="2 3"
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              ))}

              {/* Measured PostGIS full-scan benchmark points */}
              {measuredFull.map((m) => (
                <Line
                  key={`bench_pg_${m.n}`}
                  type="monotone"
                  dataKey={`bench_pg_${m.n}`}
                  name={`PostGIS medido (${m.n >= 1000 ? `${m.n / 1000}k` : m.n})`}
                  stroke="hsl(0, 0%, 50%)"
                  strokeWidth={1}
                  dot={{ r: 5, fill: "hsl(0, 0%, 50%)" }}
                  activeDot={{ r: 6 }}
                  connectNulls={false}
                />
              ))}

              {/* Real P95 band from geo-metrics history — shows where real operation sits */}
              {hasP95Data && (
                <>
                  {/* Shaded band: P95 min–max range */}
                  <ReferenceArea
                    y1={p95Min}
                    y2={p95Max}
                    fill="hsl(38, 92%, 50%)"
                    fillOpacity={0.12}
                    stroke="none"
                    label={{
                      value: `P95 real: ${p95Mean.toFixed(0)}ms · ${postgisP95ValuesCount} amostras`,
                      position: "right",
                      fill: "hsl(38, 92%, 50%)",
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  />
                  {/* Solid reference line at P95 mean */}
                  <ReferenceLine
                    y={p95Mean}
                    stroke="hsl(38, 92%, 50%)"
                    strokeWidth={2.5}
                    strokeDasharray="none"
                  />
                  {/* Stddev bounds as lighter dashed lines */}
                  {p95Stdev > 1 && (
                    <>
                      <ReferenceLine
                        y={p95Mean + p95Stdev}
                        stroke="hsl(38, 92%, 50%)"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        strokeOpacity={0.5}
                      />
                      <ReferenceLine
                        y={Math.max(p95Mean - p95Stdev, 0.1)}
                        stroke="hsl(38, 92%, 50%)"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        strokeOpacity={0.5}
                      />
                    </>
                  )}
                </>
              )}

              {/* 2× baseline reference line for PostGIS — shows alert threshold */}
              {baselines["postgis"] != null && (
                <ReferenceLine
                  y={Math.round(baselines["postgis"]! * 2)}
                  stroke="hsl(0, 72%, 51%)"
                  strokeDasharray="6 3"
                  strokeWidth={2}
                  label={{
                    value: `2× baseline PostGIS (${Math.round(baselines["postgis"]! * 2)}ms)`,
                    position: "right",
                    fill: "hsl(0, 72%, 51%)",
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                />
              )}

              {/* Reference line at selected radius selectivity (snapped to 5%) */}
              {currentSelectivity > 0 && (
                <ReferenceLine
                  x={refLineLabel}
                  stroke="hsl(201, 90%, 48%)"
                  strokeWidth={2.5}
                  strokeDasharray="none"
                  label={{
                    value: `${radiusKm}km · ${selPct}%`,
                    position: "top",
                    fill: "hsl(201, 90%, 48%)",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </MetricCard>

      {/* ── Cost at Selected Radius ──────────────────────────────────── */}
      {costData.length > 0 && (
        <MetricCard
          icon={Timer}
          title={`Custo Estimado em ${radiusKm}km (seletividade ${selPct}%)`}
        >
          <div className="space-y-3">
            <div className="text-muted-foreground grid grid-cols-5 gap-2 text-[10px] font-medium">
              <div>Providers</div>
              <div className="text-right">PostGIS (ms)</div>
              <div className="text-right">Haversine (ms)</div>
              <div className="text-right">Razão</div>
              <div className="text-right">Regime</div>
            </div>
            {costData.map((c) => (
              <div
                key={c.n}
                className={cn(
                  "grid grid-cols-5 gap-2 rounded-md border px-3 py-2 text-xs",
                  c.faster === "PostGIS"
                    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/30 dark:bg-emerald-950/10"
                    : c.faster === "Haversine"
                      ? "border-amber-200 bg-amber-50 dark:border-amber-900/30 dark:bg-amber-950/10"
                      : "border-border/50",
                )}
              >
                <span className="font-medium tabular-nums">
                  {c.n >= 1000 ? `${(c.n / 1000).toFixed(0)}k` : c.n}
                </span>
                <span className="text-right font-mono text-[11px] tabular-nums">
                  {c.postgisMs.toFixed(c.postgisMs < 1 ? 2 : 1)}
                </span>
                <span className="text-right font-mono text-[11px] tabular-nums">
                  {c.haversineMs.toFixed(c.haversineMs < 1 ? 2 : 1)}
                </span>
                <span className="text-right font-medium tabular-nums">{c.ratio}:1</span>
                <span
                  className={cn(
                    "text-right text-[10px] font-medium",
                    c.faster === "PostGIS"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : c.faster === "Haversine"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground",
                  )}
                >
                  {c.faster === "PostGIS"
                    ? "✓ GiST"
                    : c.faster === "Haversine"
                      ? "✓ Haversine"
                      : "—"}
                </span>
              </div>
            ))}
            <div className="text-muted-foreground flex items-center gap-3 border-t pt-2 text-[10px]">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  pgFasterCount >= havFasterCount
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground",
                )}
              >
                GiST vence em {pgFasterCount} de {costData.length} escalas
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  havFasterCount >= pgFasterCount
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                    : "bg-muted text-muted-foreground",
                )}
              >
                Haversine vence em {havFasterCount} de {costData.length} escalas
              </span>
            </div>
          </div>
        </MetricCard>
      )}

      {/* Crossovers + Analysis cards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Crossover table */}
        <MetricCard icon={GitCompareArrows} title="Pontos de Crossover">
          <div className="space-y-3">
            {crossovers.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Nenhum crossover — Haversine é sempre mais rápido
              </p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="pr-3 pb-2 font-medium">Providers</th>
                    <th className="pr-3 pb-2 font-medium">Raio equivalente*</th>
                    <th className="pr-3 pb-2 text-right font-medium">Seletividade</th>
                  </tr>
                </thead>
                <tbody>
                  {crossovers.map((c) => (
                    <tr key={c.n} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium tabular-nums">
                        {c.n.toLocaleString("pt-BR")}
                      </td>
                      <td className="text-muted-foreground py-2 pr-3">
                        {c.selectivity < 0.1
                          ? "< 5 km"
                          : c.selectivity < 0.3
                            ? "5–15 km"
                            : c.selectivity < 0.6
                              ? "15–30 km"
                              : "> 30 km"}
                      </td>
                      <td className="py-2 text-right font-medium tabular-nums">
                        {(c.selectivity * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-muted-foreground text-[10px] leading-relaxed">
              * Raio estimado para densidade de <strong>{density} providers/km²</strong> · Área de
              cobertura: ~{Math.round(Math.PI * radiusKm * radiusKm).toLocaleString("pt-BR")} km²
            </p>
          </div>
        </MetricCard>

        {/* Measured vs Model */}
        <MetricCard icon={BarChart3} title="Modelo vs Medição (Full Scan)">
          <div className="space-y-3">
            {measuredFull.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Sem dados de medição disponíveis
              </p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="pr-3 pb-2 font-medium">N</th>
                    <th className="pr-3 pb-2 text-right font-medium">Modelo (ms)</th>
                    <th className="pr-3 pb-2 text-right font-medium">Medido (ms)</th>
                    <th className="pb-2 text-right font-medium">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {measuredFull.map((m) => {
                    const model = modelPostGISFullMs(m.n)
                    const delta = modelDelta(m.ms, m.n)
                    return (
                      <tr key={m.n} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-medium tabular-nums">
                          {m.n.toLocaleString("pt-BR")}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{model.toFixed(1)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{m.ms.toFixed(1)}</td>
                        <td
                          className={cn(
                            "py-2 text-right font-medium tabular-nums",
                            delta > 1
                              ? "text-amber-500"
                              : delta < -1
                                ? "text-emerald-500"
                                : "text-muted-foreground",
                          )}
                        >
                          {delta > 0 ? "+" : ""}
                          {delta.toFixed(1)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </MetricCard>

        {/* Analysis */}
        <MetricCard icon={Microscope} title="Interpretação">
          <div className="text-muted-foreground space-y-3 text-xs">
            <p>
              <span className="text-foreground font-medium">Regime GiST (verde):</span> Seletividade
              baixa (&lt;20%) — o índice filtra a maioria dos providers antes de computar distância.
              Ideal para buscas de vizinhança (5–15 km).
            </p>
            <p>
              <span className="text-foreground font-medium">
                Regime Haversine (linhas tracejadas):
              </span>
              Seletividade alta (&gt;60%) — o filtro GiST é pouco seletivo e o overhead fixo (~2ms)
              domina. Haversine puro é mais rápido.
            </p>
            <p>
              <span className="text-foreground font-medium">Crossover:</span> O ponto onde as linhas
              se cruzam indica a seletividade máxima para qual o GiST é vantajoso. Para 1k providers
              em SP, o GiST vence até ~15–30 km de raio.
            </p>
            <p className="border-t pt-2 text-[10px]">
              Modelo: T(N, s) = {POSTGIS_FIXED_US / 1000}ms +{" "}
              {(POSTGIS_PER_ROW_US / 1000).toFixed(3)}ms × N × s
            </p>
          </div>
        </MetricCard>
      </div>
    </section>
  )
}

// ── GiST Cost Tooltip ─────────────────────────────────────────────────────

/**
 * Custom Recharts Tooltip content for the GiST selectivity chart.
 *
 * Displays:
 *   1. Standard curve values (PostGIS filtered + Haversine)
 *   2. Cost-at-radius section when hovering AT the reference line
 *   3. P95 delta for PostGIS filtered lines
 */
function GiSTCostTooltip({
  active,
  payload,
  label,
  refLineLabel,
  radiusKm,
  selPct,
  hasP95Data,
  p95Mean,
}: {
  active?: boolean
  payload?: Array<{ name?: string; dataKey?: string; value?: number; color?: string }>
  label?: string
  refLineLabel: string
  radiusKm: number
  selPct: number
  hasP95Data: boolean
  p95Mean: number
}) {
  if (!active || !payload || payload.length === 0) return null

  // Detect if we're at the reference line by checking if the x-label matches
  const isAtRefLine = label === refLineLabel

  // Separate cost-at-radius items from curve items
  const curves: Array<{ key: string; label: string; value: number; color?: string }> = []
  const costs: Array<{
    label: string
    postgisMs: number
    haversineMs: number
    ratio: number
    faster: string
  }> = []

  for (const entry of payload) {
    const key = String(entry.dataKey ?? entry.name ?? "")
    const value = Number(entry.value ?? 0)

    if (key.startsWith("cost_pg_")) {
      // Find the matching hav/ratio/faster for this cost entry
      const n = key.replace("cost_pg_", "")
      const havEntry = payload.find((p) => p.dataKey === `cost_hav_${n}`)
      const ratioEntry = payload.find((p) => p.dataKey === `cost_ratio_${n}`)
      const fasterEntry = payload.find((p) => p.dataKey === `cost_faster_${n}`)
      costs.push({
        label: n,
        postgisMs: value,
        haversineMs: Number(havEntry?.value ?? 0),
        ratio: Number(ratioEntry?.value ?? 0),
        faster: String(fasterEntry?.value ?? "Haversine"),
      })
      continue
    }
    // Skip cost_hav_, cost_ratio_, cost_faster_, cost_label_ — handled above
    if (
      key.startsWith("cost_hav_") ||
      key.startsWith("cost_ratio_") ||
      key.startsWith("cost_faster_") ||
      key.startsWith("cost_label_")
    ) {
      continue
    }

    // Label mapping for curve entries
    const labelMap: Record<string, string> = {
      pg_100: "PostGIS 100",
      pg_500: "PostGIS 500",
      pg_1000: "PostGIS 1k",
      pg_5000: "PostGIS 5k",
      pg_10000: "PostGIS 10k",
      hav_100: "Haversine 100",
      hav_500: "Haversine 500",
      hav_1000: "Haversine 1k",
      hav_5000: "Haversine 5k",
      hav_10000: "Haversine 10k",
      bench_pg_100: "Medido 100",
      bench_pg_1000: "Medido 1k",
      bench_pg_10000: "Medido 10k",
    }
    const displayLabel = labelMap[key] ?? key

    // For PostGIS filtered lines, add P95 delta
    let deltaStr = ""
    if (key.startsWith("pg_") && hasP95Data && value > 0) {
      const delta = p95Mean - value
      const sign = delta >= 0 ? "+" : ""
      deltaStr = ` · P95 ${sign}${delta.toFixed(1)}ms`
    }

    curves.push({ key, label: displayLabel, value, color: entry.color })
  }

  return (
    <div style={TOOLTIP_STYLE as React.CSSProperties}>
      {/* Selectivity header */}
      <p className="text-foreground mb-1.5 text-[11px] font-semibold">Seletividade: {label}</p>

      {/* Curve values */}
      <div className="space-y-0.5">
        {curves.map((c) => (
          <div key={c.key} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <span
                className="inline-block size-2 shrink-0 rounded-full"
                style={{ backgroundColor: c.color ?? "var(--muted-foreground)" }}
              />
              {c.label}
            </span>
            <span className="text-foreground tabular-nums">
              {c.value.toFixed(c.value < 1 ? 2 : 1)}ms
            </span>
          </div>
        ))}
      </div>

      {/* Cost-at-radius separator — only when at reference line */}
      {isAtRefLine && costs.length > 0 && (
        <>
          <div className="bg-border my-2 h-px" />
          <p className="text-foreground mb-1 text-[11px] font-semibold">
            📍 Custo neste raio ({radiusKm}km · {selPct}%)
          </p>
          <div className="text-[10px]">
            <div className="text-muted-foreground mb-0.5 flex items-center justify-between font-medium">
              <span>Prov</span>
              <span className="text-right">GiST · Hav · Razão</span>
            </div>
            {costs.map((c) => {
              const label = c.label
              return (
                <div
                  key={c.label}
                  className="flex items-center justify-between gap-2 rounded-sm py-0.5"
                >
                  <span className="tabular-nums">{label}</span>
                  <span className="tabular-nums">
                    <span
                      className={
                        c.faster === "PostGIS" ? "text-emerald-500" : "text-muted-foreground"
                      }
                    >
                      {c.postgisMs.toFixed(c.postgisMs < 1 ? 2 : 1)}
                    </span>
                    <span className="text-muted-foreground"> · </span>
                    <span
                      className={
                        c.faster === "Haversine" ? "text-amber-500" : "text-muted-foreground"
                      }
                    >
                      {c.haversineMs.toFixed(c.haversineMs < 1 ? 2 : 1)}
                    </span>
                    <span className="text-muted-foreground"> · </span>
                    <span className="text-muted-foreground">{c.ratio}:1</span>
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
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
