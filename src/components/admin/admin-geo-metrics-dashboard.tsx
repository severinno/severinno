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

// ── GiST model constants (from geo-benchmark-real.mjs analysis) ───────────

/** Fixed PostGIS overhead (TCP + query parse/plan) in µs. */
const POSTGIS_FIXED_US = 2000
/** Per-row ST_Distance computation cost in µs. */
const POSTGIS_PER_ROW_US = 22

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

      {/* ── GiST Selectivity vs Cost Curve ───────────────────────── */}
      {data.benchmark != null &&
        "comparisons" in data.benchmark &&
        data.benchmark.comparisons.length > 0 && (
          <GiSTSelectivitySection benchmark={data.benchmark} />
        )}

      {/* ── Benchmark Comparison ──────────────────────────────────── */}
      {data.benchmark != null &&
        "comparisons" in data.benchmark &&
        data.benchmark.comparisons.length > 0 && <BenchmarkSection benchmark={data.benchmark} />}

      {/* ── Historical Evolution (P50/P95/P99 timeline) ───────────── */}
      {data.history != null && data.history.length > 1 && (
        <TimelineSection history={data.history} labels={data.labels} />
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
  const barData = benchmark.comparisons.map((c) => ({
    label: c.label,
    scale: c.scale,
    haversine: c.haversine.mean,
    postgis: c.postgis.mean,
    haversine_ops: c.haversine.opsPerSec,
    postgis_ops: c.postgis.opsPerSec,
    ratio: c.ratio,
  }))

  const maxLatency = Math.max(...barData.map((d) => d.postgis))

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
                    <Cell
                      key={entry.label}
                      fill={entry.ratio > 50 ? COLOR_P99 : entry.ratio > 10 ? COLOR_P95 : COLOR_P50}
                    />
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
}: {
  history: NonNullable<GeoMetricsResponse["history"]>
  labels: Record<string, string>
}) {
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

function GiSTSelectivitySection({
  benchmark,
}: {
  benchmark: NonNullable<GeoMetricsResponse["benchmark"]>
}) {
  // Use benchmark's avgHaversinePerProvider (dynamic, changes per run)
  const haversinePerProviderUs =
    benchmark.analysis.avgHaversinePerProvider > 0
      ? benchmark.analysis.avgHaversinePerProvider
      : 0.1323 // fallback hardcoded

  // Provider counts to model
  const providerCounts = [100, 500, 1000, 5000, 10000]

  // Generate selectivity curve: selectivity from 0% to 100%
  // PostGIS filtered cost: T(N, s) = FIXED_US + PER_ROW_US × N × s
  // Where s = selectivity (fraction of providers within radius)
  const selectivityPoints = Array.from({ length: 21 }, (_, i) => {
    const selectivity = i / 20 // 0, 0.05, 0.1, ..., 1.0
    const pct = Math.round(selectivity * 100)

    const row: Record<string, number | string> = {
      selectivity: `${pct}%`,
      pct: selectivity,
    }

    for (const n of providerCounts) {
      // PostGIS filtered (ST_DWithin + ST_Distance on subset)
      const pgFiltered = POSTGIS_FIXED_US + POSTGIS_PER_ROW_US * n * selectivity
      row[`pg_${n}`] = Math.round((pgFiltered / 1000) * 10) / 10 // convert to ms, 1 decimal

      // Haversine full scan
      const haversine = haversinePerProviderUs * n
      row[`hav_${n}`] = Math.round((haversine / 1000) * 100) / 100 // convert to ms, 2 decimal

      // PostGIS full scan (no filter, s=1.0)
      if (pct === 100) {
        row[`pg_full_${n}`] =
          Math.round(((POSTGIS_FIXED_US + POSTGIS_PER_ROW_US * n) / 1000) * 10) / 10
      }
    }

    // Real benchmark data points for PostGIS full scan (from benchmark comparisons)
    for (const comp of benchmark.comparisons) {
      if (pct === 100) {
        const key = `bench_pg_${comp.scale}`
        row[key] = Math.round((comp.postgis.mean / 1000) * 10) / 10
      }
    }

    return row
  })

  // Compute crossover points: where haversine becomes cheaper than PostGIS filtered
  const crossovers: Array<{ n: number; selectivity: number }> = []
  for (const n of providerCounts) {
    // haversine total = haversinePerProviderUs × n
    // PostGIS filtered = POSTGIS_FIXED_US + POSTGIS_PER_ROW_US × n × s
    // Crossover when: haversine = postgis_filtered
    // haversinePerProviderUs × n = POSTGIS_FIXED_US + POSTGIS_PER_ROW_US × n × s
    // s = (haversinePerProviderUs × n - POSTGIS_FIXED_US) / (POSTGIS_PER_ROW_US × n)
    const num = haversinePerProviderUs * n - POSTGIS_FIXED_US
    const den = POSTGIS_PER_ROW_US * n
    if (den > 0) {
      const s = num / den
      if (s > 0 && s < 1) {
        crossovers.push({ n, selectivity: s })
      }
    }
  }

  // Get measured full-scan latencies from benchmark
  const measuredFull: Array<{ n: number; ms: number }> = []
  for (const comp of benchmark.comparisons) {
    measuredFull.push({ n: comp.scale, ms: Math.round((comp.postgis.mean / 1000) * 10) / 10 })
  }

  return (
    <section aria-label="Seletividade GiST vs Custo" className="space-y-6">
      <div className="flex items-center gap-2">
        <Database className="size-5 text-sky-500" />
        <h2 className="text-foreground text-lg font-semibold">
          Curva de Seletividade — GiST Index vs Haversine
        </h2>
      </div>

      {/* Main chart: selectivity vs latency */}
      <MetricCard icon={LineChartIcon} title="Custo por Seletividade (ms)">
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
                scale="log"
                domain={["auto", "auto"]}
              />
              <RTooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v: number, n: string) => {
                  const labelMap: Record<string, string> = {
                    pg_100: "PostGIS filtrado (100 prov)",
                    pg_500: "PostGIS filtrado (500 prov)",
                    pg_1000: "PostGIS filtrado (1k prov)",
                    pg_5000: "PostGIS filtrado (5k prov)",
                    pg_10000: "PostGIS filtrado (10k prov)",
                    hav_100: "Haversine (100 prov)",
                    hav_500: "Haversine (500 prov)",
                    hav_1000: "Haversine (1k prov)",
                    hav_5000: "Haversine (5k prov)",
                    hav_10000: "Haversine (10k prov)",
                    bench_pg_100: "PostGIS full scan medido (100)",
                    bench_pg_1000: "PostGIS full scan medido (1k)",
                    bench_pg_10000: "PostGIS full scan medido (10k)",
                  }
                  return [`${v.toFixed(v < 1 ? 2 : 1)}ms`, labelMap[n] ?? n]
                }}
              />
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} iconSize={8} />

              {/* PostGIS filtered lines (one per provider count) */}
              {providerCounts.map((n, idx) => (
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
              {providerCounts.map((n, idx) => (
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
            </LineChart>
          </ResponsiveContainer>
        </div>
      </MetricCard>

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
              * Raio estimado para densidade de São Paulo (~10 providers/km²)
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
                    const model = (POSTGIS_FIXED_US + POSTGIS_PER_ROW_US * m.n) / 1000
                    const delta = m.ms - model
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
