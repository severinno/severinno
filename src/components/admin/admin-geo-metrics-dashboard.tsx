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
  GitCompareArrows,
  Zap,
  Microscope,
  FileJson,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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
  buildBenchmarkBarData,
  getMaxPostgisLatency,
  ratioColor,
  generateBenchmarkCsv,
  downloadFile,
  printBenchmarkReport,
} from "@/lib/benchmark-data"
import { MetricCard, KpiCard } from "@/components/admin/admin-metric-card"
import { DashboardHeader } from "@/components/admin/admin-dashboard-header"
import { GiSTSelectivitySection } from "@/components/admin/gist-selectivity-section"
import { TimelineSection } from "@/components/admin/timeline-section"

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

// ── Benchmark Comparison Section ──────────────────────────────────────────

export function BenchmarkSection({
  benchmark,
}: {
  benchmark: NonNullable<GeoMetricsResponse["benchmark"]>
}) {
  const barData = buildBenchmarkBarData(benchmark)

  const maxLatency = getMaxPostgisLatency(barData)
  const [benchUseLog, setBenchUseLog] = React.useState(() => {
    if (typeof window === "undefined") return true
    const stored = localStorage.getItem("geo-scale-bench")
    return stored !== null ? stored === "true" : true
  })

  return (
    <section aria-label="Comparação de benchmark" className="space-y-6">
      <div className="flex items-center gap-2">
        <Microscope className="size-5 text-purple-500" />
        <h2 className="text-foreground text-lg font-semibold">
          Benchmark Real — Haversine JS vs PostGIS
        </h2>
      </div>

      {/* ── Export buttons + Scale toggle ──────────────────────────── */}
      <div className="flex items-center justify-end gap-2">
        {/* CSV */}
        <button
          type="button"
          onClick={() => {
            const csv = generateBenchmarkCsv(benchmark)
            const ts = new Date().toISOString().slice(0, 19).replace(/[:]/g, "-")
            downloadFile(csv, `benchmark-${ts}.csv`, "text/csv;charset=utf-8")
          }}
          className="bg-muted/50 text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[10px] font-medium transition-colors"
          aria-label="Exportar CSV"
        >
          <FileJson className="size-3" />
          CSV
        </button>

        {/* PDF / Print */}
        <button
          type="button"
          onClick={() => {
            printBenchmarkReport(benchmark)
          }}
          className="bg-muted/50 text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[10px] font-medium transition-colors"
          aria-label="Exportar PDF"
        >
          <FileJson className="size-3" />
          PDF
        </button>

        <span className="text-muted-foreground text-[10px]">
          Gráficos: {benchUseLog ? "Log" : "Linear"}
        </span>
        <button
          type="button"
          onClick={() => {
            const next = !benchUseLog
            localStorage.setItem("geo-scale-bench", String(next))
            setBenchUseLog(next)
          }}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
            benchUseLog ? "bg-primary border-primary" : "bg-muted border-border",
          )}
          role="switch"
          aria-checked={benchUseLog}
          aria-label="Alternar escala Log/Linear nos gráficos de benchmark"
        >
          <span
            className={cn(
              "inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
              benchUseLog ? "translate-x-[18px]" : "translate-x-[2px]",
            )}
          />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <MetricCard
          icon={GitCompareArrows}
          title={`Latência Média (µs) — Escala ${benchUseLog ? "Log" : "Linear"}`}
        >
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
                  scale={benchUseLog ? "log" : "linear"}
                  domain={benchUseLog ? [1, maxLatency * 2] : [0, "auto"]}
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
                  scale={benchUseLog ? "log" : "linear"}
                  domain={benchUseLog ? undefined : [0, "auto"]}
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

// ── Timeline Evolution Section was extracted to src/components/admin/timeline-section.tsx ──

// ── Sub-components ────────────────────────────────────────────────────────

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
        <div>
          <Skeleton className="mb-2 h-6 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  )
}
