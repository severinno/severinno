"use client"

/**
 * AdminBenchmarkDashboard — Continuous Benchmark Monitoring
 *
 * Lê os dados de /api/admin/benchmarks e exibe:
 *   - KPI cards: total de runs, regressões, último benchmark
 *   - Gráfico de tendência temporal dos principais benchmarks
 *   - Tabela de comparação baseline vs latest com regressões destacadas
 *   - Painel de alertas de regressão
 *   - Detalhamento por tipo (geo, cache, gist, real_postgis)
 *
 * Data source: GET /api/admin/benchmarks
 */

import * as React from "react"
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock,
  Database,
  FileJson,
  Filter,
  GitCompareArrows,
  TrendingDown,
  TrendingUp,
  Activity,
  RefreshCw,
  MapPin,
  MousePointerClick,
  Gauge,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
import { MetricCard } from "@/components/admin/admin-metric-card"

import type {
  BenchmarksResponse,
  ComparisonResult,
  BenchmarkFile,
  GistCrossoverPoint,
  CrossoverDriftAlert,
  BenchmarkHistoryEntry,
} from "@/app/api/admin/benchmarks/route"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.1)",
  padding: "8px 10px",
}

const STATUS_COLORS: Record<string, string> = {
  regression: "hsl(0, 72%, 51%)",
  improvement: "hsl(160, 84%, 39%)",
  unchanged: "hsl(240, 4%, 60%)",
  changed: "hsl(38, 92%, 50%)",
  new: "hsl(201, 90%, 48%)",
  removed: "hsl(240, 6%, 50%)",
}

const TYPE_LABELS: Record<string, string> = {
  geo: "Modelo CPU (Haversine + PostGIS)",
  cache: "Cache Performance",
  gist_index_analysis: "GiST Index Analysis",
  real_postgis: "PostGIS Real (DB)",
}

const TYPE_COLORS: Record<string, string> = {
  geo: "hsl(201, 90%, 48%)",
  cache: "hsl(38, 92%, 50%)",
  gist_index_analysis: "hsl(160, 84%, 39%)",
  real_postgis: "hsl(0, 72%, 51%)",
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function AdminBenchmarkDashboard() {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "benchmarks"],
    queryFn: () => apiGet<BenchmarksResponse>("/api/admin/benchmarks"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  // ── State hooks (must be before early returns for React rules-of-hooks) ──
  const [dateRange, setDateRange] = React.useState<{ start: string; end: string }>({
    start: "",
    end: "",
  })
  const [selectedTypes, setSelectedTypes] = React.useState<Set<string>>(new Set())
  const [metricMode, setMetricMode] = React.useState<"mean" | "ops" | "p95">("mean")
  const [timelineTab, setTimelineTab] = React.useState<"gist" | "geo" | "cache">("gist")

  // Compute default date range from data (derived, no setState in effect)
  const defaultDateRange = React.useMemo(() => {
    if (!data) return null
    const timestamps = Object.values(data.runs)
      .flat()
      .map((r) => r.meta?.timestamp)
      .filter(Boolean) as string[]
    if (timestamps.length === 0) return null
    const min = new Date(Math.min(...timestamps.map((t) => new Date(t).getTime())))
    const max = new Date(Math.max(...timestamps.map((t) => new Date(t).getTime())))
    return {
      start: min.toISOString().slice(0, 7) + "-01",
      end: max.toISOString().slice(0, 10),
    }
  }, [data])

  // Sync computed defaults to state once on first load.
  // Uses queueMicrotask to defer setState outside the effect's synchronous
  // body, satisfying react-hooks/set-state-in-effect.
  const initRef = React.useRef(false)
  React.useEffect(() => {
    if (initRef.current || !defaultDateRange) return
    initRef.current = true
    queueMicrotask(() => {
      setDateRange(defaultDateRange)
      setSelectedTypes(new Set(Object.keys(data?.runs ?? {})))
    })
  }, [defaultDateRange, data])

  // ── Error state ─────────────────────────────────────────────────────
  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar os benchmarks"
        description="Verifique se você está autenticado como administrador e se existem arquivos de benchmark em docs/benchmarks/."
        onRetry={() => void refetch()}
      />
    )
  }

  // ── Loading state ───────────────────────────────────────────────────
  if (isLoading || !data) {
    return <BenchmarkSkeleton />
  }

  const {
    summary,
    comparisons,
    runs,
    regressionCount,
    lastRun,
    gistCrossoverHistory,
    crossoverDriftAlerts,
    benchmarkHistory,
  } = data
  const hasComparisons = comparisons.length > 0
  const hasRegressions = regressionCount > 0

  // Filter runs by date range
  const filterTimestamp = (ts: string | undefined): boolean => {
    if (!ts || dateRange.start === "" || dateRange.end === "") return true // show all when uninitialized
    const t = new Date(ts).getTime()
    return t >= new Date(dateRange.start).getTime() && t <= new Date(dateRange.end).getTime()
  }

  const filteredRuns: Record<string, BenchmarkFile[]> = {}
  for (const [type, typeRuns] of Object.entries(runs)) {
    const filtered = typeRuns.filter((r) => filterTimestamp(r.meta?.timestamp))
    if (filtered.length > 0) filteredRuns[type] = filtered
  }

  // ── Trend data: extract mean/ops/p95 values for key benchmarks across historical runs ──
  const trendData = buildTrendData(filteredRuns)

  // ── Per-benchmark temporal data (all individual benchmark names) ──────────
  const perBenchTrend = buildPerBenchTrend(runs, filterTimestamp, selectedTypes)

  const toggleType = (type: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-xl font-bold tracking-tight">
            Monitoramento de Benchmarks
          </h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Comparação contínua de desempenho dos benchmarks de geolocalização
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
            aria-label="Atualizar benchmarks"
          >
            <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────── */}
      <section aria-label="KPIs de benchmark" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={FileJson}
          label="Total de Runs"
          value={String(summary.totalRuns)}
          subtitle={`${summary.totalComparisons} comparações`}
        />
        <KpiCard
          icon={hasRegressions ? AlertTriangle : CheckCircle2}
          label="Regressões"
          value={String(regressionCount)}
          subtitle={`Limiar: ${5}%`}
          trend={hasRegressions ? "up" : "down"}
        />
        <KpiCard
          icon={Clock}
          label="Último Run"
          value={lastRun ? new Date(lastRun).toLocaleDateString("pt-BR") : "—"}
          subtitle={lastRun ? new Date(lastRun).toLocaleTimeString("pt-BR") : "Nenhum"}
        />
        <KpiCard
          icon={Database}
          label="Tipos Monitorados"
          value={String(Object.keys(runs).length)}
          subtitle={Object.keys(runs)
            .map((t) => TYPE_LABELS[t] ?? t)
            .join(", ")}
        />
      </section>

      {/* ── Crossover Drift Alert Banner ──────────────────────────── */}
      {crossoverDriftAlerts && crossoverDriftAlerts.length > 0 ? (
        <CrossoverDriftBanner alerts={crossoverDriftAlerts} />
      ) : null}

      {/* ── Alert Banner ────────────────────────────────────────────── */}
      {hasRegressions ? (
        <section
          aria-label="Alertas de regressão"
          className="rounded-xl border border-red-200 bg-red-50/80 p-4 dark:border-red-900/30 dark:bg-red-950/10"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                {regressionCount} regressão(ões) detectada(s)
              </p>
              <p className="mt-0.5 text-xs text-red-700 dark:text-red-400">
                {regressionCount} benchmark(s) apresentaram aumento de latência acima de {5}% em
                relação ao baseline. Revise as alterações recentes na camada de geolocalização.
              </p>
            </div>
          </div>
        </section>
      ) : hasComparisons ? (
        <section
          aria-label="Status saudável"
          className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 dark:border-emerald-900/30 dark:bg-emerald-950/10"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" />
            <div>
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                Todos os benchmarks dentro do limite ({5}%)
              </p>
              <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                Nenhuma regressão de performance detectada. O sistema está estável.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Filters: Date Range + Benchmark Type + Metric Mode ───────── */}
      {Object.keys(runs).length > 0 && (
        <section aria-label="Filtros" className="border-border/50 bg-card rounded-xl border p-4">
          <div className="flex flex-wrap items-end gap-4">
            {/* Date range */}
            <div className="flex items-center gap-3">
              <CalendarDays className="text-muted-foreground size-4" />
              <div className="flex items-center gap-2">
                <label className="text-muted-foreground text-[10px]">De</label>
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
                  className="border-input/60 bg-background h-8 rounded-lg border px-2 text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-muted-foreground text-[10px]">Até</label>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
                  className="border-input/60 bg-background h-8 rounded-lg border px-2 text-xs"
                />
              </div>
            </div>

            {/* Type filter chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Filter className="text-muted-foreground size-3.5" />
              {Object.keys(runs).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[10px] font-medium transition-all",
                    selectedTypes.has(type)
                      ? "text-white shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-muted/70",
                  )}
                  style={
                    selectedTypes.has(type)
                      ? { backgroundColor: TYPE_COLORS[type] ?? "#888" }
                      : undefined
                  }
                >
                  {TYPE_LABELS[type] ?? type}
                </button>
              ))}
            </div>

            {/* Metric mode selector */}
            <div className="ml-auto flex items-center gap-1 rounded-lg border p-0.5">
              {[
                { key: "mean" as const, icon: Gauge, label: "Latência" },
                { key: "ops" as const, icon: Activity, label: "Throughput" },
                { key: "p95" as const, icon: MousePointerClick, label: "P95" },
              ].map(({ key, icon: Icon, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMetricMode(key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all",
                    metricMode === key
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Active filter summary */}
          <div className="text-muted-foreground mt-3 flex items-center gap-3 text-[10px]">
            <span>
              <span className="text-foreground font-medium">
                {Object.keys(filteredRuns).length}
              </span>
              {` / ${Object.keys(runs).length} tipos com dados no período`}
            </span>
            <span>
              <span className="text-foreground font-medium">{filteredRunCount(filteredRuns)}</span>
              {` runs no período`}
            </span>
            {(() => {
              const ts = Object.values(runs)
                .flat()
                .map((r) => r.meta?.timestamp)
                .filter(Boolean) as string[]
              if (ts.length === 0) return null
              const mi = new Date(Math.min(...ts.map((t: string) => new Date(t).getTime())))
              const ma = new Date(Math.max(...ts.map((t: string) => new Date(t).getTime())))
              const ds = mi.toISOString().slice(0, 7) + "-01"
              const de = ma.toISOString().slice(0, 10)
              if (dateRange.start === ds && dateRange.end === de) return null
              return (
                <button
                  type="button"
                  onClick={() => setDateRange({ start: ds, end: de })}
                  className="text-primary hover:text-primary/80 underline underline-offset-2 transition-colors"
                >
                  Limpar filtro de data
                </button>
              )
            })()}
          </div>
        </section>
      )}

      {/* ── Trend Chart (per-type aggregated) ────────────────────────── */}
      {trendData.length > 0 && (
        <section aria-label="Tendência temporal" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <MetricCard
            icon={
              metricMode === "ops" ? Activity : metricMode === "p95" ? MousePointerClick : BarChart3
            }
            title={
              metricMode === "ops"
                ? "Throughput por Run (ops/sec)"
                : metricMode === "p95"
                  ? "P95 por Run (µs)"
                  : "Latência Média por Run (µs)"
            }
          >
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={50}
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    label={{
                      value: metricMode === "ops" ? "ops/s" : metricMode === "p95" ? "µs" : "µs",
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                    }}
                    scale={metricMode === "ops" ? "auto" : "log"}
                    domain={["auto", "auto"]}
                  />
                  <RTooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number, n: string) => {
                      const label = TYPE_LABELS[n.replace(/_ops$|_p95$/, "")] ?? n
                      const suffix = metricMode === "ops" ? " ops/s" : " µs"
                      return [`${v.toFixed(v < 1 ? 2 : 1)}${suffix}`, label]
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                  {[...selectedTypes].map((type) => {
                    const dataKey =
                      metricMode === "ops"
                        ? `${type}_ops`
                        : metricMode === "p95"
                          ? `${type}_p95`
                          : type
                    return (
                      <Line
                        key={dataKey}
                        type="monotone"
                        dataKey={dataKey}
                        name={TYPE_LABELS[type] ?? type}
                        stroke={TYPE_COLORS[type] ?? "#888"}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                        connectNulls
                      />
                    )
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </MetricCard>

          {/* Per-benchmark temporal chart */}
          <MetricCard
            icon={
              metricMode === "ops" ? Activity : metricMode === "p95" ? MousePointerClick : BarChart3
            }
            title={
              metricMode === "ops"
                ? "Benchmarks Individuais (ops/sec)"
                : metricMode === "p95"
                  ? "Benchmarks Individuais P95 (µs)"
                  : "Benchmarks Individuais (µs)"
            }
          >
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={perBenchTrend} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={50}
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    label={{
                      value: metricMode === "ops" ? "ops/s" : "µs",
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                    }}
                    scale={metricMode === "ops" ? "auto" : "log"}
                    domain={["auto", "auto"]}
                  />
                  <RTooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number, n: string) => {
                      const suffix = metricMode === "ops" ? " ops/s" : " µs"
                      return [`${v.toFixed(v < 1 ? 2 : 1)}${suffix}`, n]
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                  {perBenchLines(perBenchTrend, metricMode)
                    .slice(0, 15)
                    .map((line) => (
                      <Line
                        key={line.dataKey}
                        type="monotone"
                        dataKey={line.dataKey}
                        name={line.name}
                        stroke={line.color}
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 3 }}
                        connectNulls
                      />
                    ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {perBenchLines(perBenchTrend, metricMode).length > 15 && (
              <p className="text-muted-foreground mt-1 text-[10px]">
                Mostrando 15 de {perBenchLines(perBenchTrend, metricMode).length} benchmarks
              </p>
            )}
          </MetricCard>
        </section>
      )}

      {/* ── Benchmark History Timeline (Tabbed) ────────────────────── */}
      {/* NOTE: 'pipeline' type not yet tracked — no pipeline JSON files
         exist in git history.  Add HISTORY_FILES entry in route.ts when
         pipeline benchmark snapshots become available. */}
      {(gistCrossoverHistory.length > 0 ||
        benchmarkHistory.geo?.length > 0 ||
        benchmarkHistory.cache?.length > 0) && (
        <>
          {/* Tab bar */}
          <div className="border-border/50 bg-card flex items-center rounded-t-xl border border-b-0 px-5">
            <button
              type="button"
              onClick={() => setTimelineTab("gist")}
              className={cn(
                "border-b-2 px-4 py-3 text-[11px] font-medium transition-colors",
                timelineTab === "gist"
                  ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              <GitCompareArrows className="mr-1.5 inline size-3.5" />
              GiST Crossover
              {gistCrossoverHistory.length > 0 && (
                <span className="text-muted-foreground ml-1.5 text-[9px]">
                  {gistCrossoverHistory.length}
                </span>
              )}
            </button>

            {benchmarkHistory.geo && benchmarkHistory.geo.length > 0 && (
              <button
                type="button"
                onClick={() => setTimelineTab("geo")}
                className={cn(
                  "border-b-2 px-4 py-3 text-[11px] font-medium transition-colors",
                  timelineTab === "geo"
                    ? "border-sky-500 text-sky-600 dark:text-sky-400"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                <MapPin className="mr-1.5 inline size-3.5" />
                Geo
                <span className="text-muted-foreground ml-1.5 text-[9px]">
                  {benchmarkHistory.geo.length}
                </span>
              </button>
            )}

            {benchmarkHistory.cache && benchmarkHistory.cache.length > 0 && (
              <button
                type="button"
                onClick={() => setTimelineTab("cache")}
                className={cn(
                  "border-b-2 px-4 py-3 text-[11px] font-medium transition-colors",
                  timelineTab === "cache"
                    ? "border-amber-500 text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                <Database className="mr-1.5 inline size-3.5" />
                Cache
                <span className="text-muted-foreground ml-1.5 text-[9px]">
                  {benchmarkHistory.cache.length}
                </span>
              </button>
            )}
          </div>

          {/* Tab content */}
          <div className="p-4">
            {timelineTab === "gist" && gistCrossoverHistory.length > 0 && (
              <GiSTCrossoverTimeline history={gistCrossoverHistory} />
            )}
            {timelineTab === "geo" && benchmarkHistory.geo && (
              <BenchmarkTimelineView
                type="geo"
                label="Geo Benchmarks"
                history={benchmarkHistory.geo}
                color="hsl(201, 90%, 48%)"
              />
            )}
            {timelineTab === "cache" && benchmarkHistory.cache && (
              <BenchmarkTimelineView
                type="cache"
                label="Cache Benchmarks"
                history={benchmarkHistory.cache}
                color="hsl(38, 92%, 50%)"
              />
            )}
          </div>
        </>
      )}

      {/* ── Comparisons ──────────────────────────────────────────────── */}
      {comparisons.map((comparison) => (
        <ComparisonSection key={comparison.type} comparison={comparison} />
      ))}

      {/* ── Historical Runs Table ────────────────────────────────────── */}
      {Object.entries(runs).length > 0 && (
        <section>
          <MetricCard icon={FileJson} title="Histórico de Runs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="pr-4 pb-2 font-medium">Data</th>
                    <th className="pr-4 pb-2 font-medium">Tipo</th>
                    <th className="pr-4 pb-2 font-medium">Benchmarks</th>
                    <th className="pr-4 pb-2 text-right font-medium">Plataforma</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(runs).flatMap(([type, typeRuns]) =>
                    typeRuns.map((run, idx) => (
                      <tr
                        key={`${type}-${idx}`}
                        className="hover:bg-muted/20 border-b last:border-0"
                      >
                        <td className="text-foreground py-2 pr-4 font-medium tabular-nums">
                          {run.meta?.timestamp
                            ? new Date(run.meta.timestamp).toLocaleString("pt-BR")
                            : "?"}
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: `${TYPE_COLORS[type] ?? "#888"}20`,
                              color: TYPE_COLORS[type] ?? "#888",
                            }}
                          >
                            {TYPE_LABELS[type] ?? type}
                          </span>
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{run.benchmarks.length}</td>
                        <td className="text-muted-foreground py-2 text-right tabular-nums">
                          {run.meta?.platform ?? "?"} · Node {run.meta?.nodeVersion ?? "?"}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </MetricCard>
        </section>
      )}

      {/* ── Empty state ──────────────────────────────────────────────── */}
      {!hasComparisons && Object.keys(runs).length === 0 ? (
        <section
          aria-label="Nenhum benchmark encontrado"
          className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16"
        >
          <FileJson className="text-muted-foreground/50 size-10" />
          <p className="text-muted-foreground text-sm font-medium">
            Nenhum arquivo de benchmark encontrado
          </p>
          <p className="text-muted-foreground max-w-md text-center text-xs">
            Execute um benchmark (ex.:{" "}
            <code className="bg-muted rounded px-1 py-0.5">bun run benchmark:geo</code>) para gerar
            o primeiro JSON em{" "}
            <code className="bg-muted rounded px-1 py-0.5">docs/benchmarks/</code>. Com pelo menos 2
            runs, o dashboard começará a monitorar regressões automaticamente.
          </p>
        </section>
      ) : null}

      {/* ── Summary Footer ───────────────────────────────────────────── */}
      <div className="border-border/50 bg-muted/30 text-muted-foreground rounded-lg border px-4 py-2 text-[10px]">
        Diretório de benchmarks: {summary.benchmarkDir} · Última atualização:{" "}
        {new Date(summary.lastUpdated).toLocaleString("pt-BR")} · Refetch automático: 60s · Limiar
        de regressão: {5}%
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Comparison Section
// ---------------------------------------------------------------------------

function ComparisonSection({ comparison }: { comparison: ComparisonResult }) {
  const [showAll, setShowAll] = React.useState(false)
  const typeLabel = TYPE_LABELS[comparison.type] ?? comparison.type

  // Show regressions first, then sorted by change magnitude
  const sortedDiffs = React.useMemo(() => {
    const regression = comparison.regressions
    const rest = comparison.diffs.filter((d) => d.status !== "regression")
    return [...regression, ...rest.sort((a, b) => Math.abs(b.mean.pct) - Math.abs(a.mean.pct))]
  }, [comparison])

  const displayed = showAll ? sortedDiffs : sortedDiffs.slice(0, 10)

  return (
    <section
      aria-label={`Comparação ${typeLabel}`}
      className="border-border/50 bg-card rounded-xl border"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
        <div className="flex items-center gap-2">
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: TYPE_COLORS[comparison.type] ?? "#888" }}
          />
          <h2 className="text-foreground text-sm font-semibold">{typeLabel}</h2>
          {comparison.regressions.length > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400">
              {comparison.regressions.length} regressões
            </span>
          )}
          {comparison.improvements.length > 0 && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
              {comparison.improvements.length} melhorias
            </span>
          )}
        </div>

        <div className="text-muted-foreground flex items-center gap-2 text-[10px]">
          <span>
            Baseline: {new Date(comparison.baselineTimestamp).toLocaleDateString("pt-BR")}
          </span>
          <span className="text-muted-foreground/50">→</span>
          <span>Latest: {new Date(comparison.latestTimestamp).toLocaleDateString("pt-BR")}</span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto p-3">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground border-b">
              <th className="pr-3 pb-2 font-medium">Benchmark</th>
              <th className="pr-3 pb-2 text-right font-medium">Baseline (µs)</th>
              <th className="pr-3 pb-2 text-right font-medium">Latest (µs)</th>
              <th className="pr-3 pb-2 text-right font-medium">Δ%</th>
              <th className="pr-3 pb-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((diff) => (
              <tr
                key={diff.label}
                className={cn(
                  "border-b transition-colors last:border-0",
                  diff.status === "regression"
                    ? "bg-red-50/50 hover:bg-red-50/80 dark:bg-red-950/10 dark:hover:bg-red-950/20"
                    : "hover:bg-muted/20",
                )}
              >
                <td className="text-foreground py-2 pr-3 font-medium">{diff.name}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {diff.mean.baseline.toFixed(1)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {diff.mean.current.toFixed(1)}
                </td>
                <td
                  className={cn(
                    "py-2 pr-3 text-right font-medium tabular-nums",
                    diff.mean.pct > 5 && "text-red-500",
                    diff.mean.pct < -5 && "text-emerald-500",
                  )}
                >
                  {diff.mean.pct > 0 ? "+" : ""}
                  {diff.mean.pct.toFixed(1)}%
                </td>
                <td className="py-2 text-right">
                  <StatusBadge status={diff.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {comparison.diffs.length > 10 && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-muted-foreground hover:text-foreground hover:bg-muted/30 mt-2 w-full rounded-md py-2 text-[10px] font-medium transition-colors"
          >
            {showAll ? "Mostrar menos" : `Mostrar todos (${comparison.diffs.length} benchmarks)`}
          </button>
        )}
      </div>

      {/* Footer stats */}
      <div className="border-t px-5 py-3">
        <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-[10px]">
          <span>Total: {comparison.totalBenchmarks}</span>
          <span className="text-red-500">Regressões: {comparison.regressions.length}</span>
          <span className="text-emerald-500">Melhorias: {comparison.improvements.length}</span>
          <span>
            Índice de saúde:{" "}
            {comparison.totalBenchmarks > 0
              ? `${(
                  ((comparison.totalBenchmarks - comparison.regressions.length) /
                    comparison.totalBenchmarks) *
                  100
                ).toFixed(0)}%`
              : "—"}
          </span>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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

// ── Crossover Drift Banner ──────────────────────────────────────────────

function CrossoverDriftBanner({ alerts }: { alerts: CrossoverDriftAlert[] }) {
  const [expanded, setExpanded] = React.useState(false)

  if (alerts.length === 0) return null

  // Group by gistFaster state change for summary
  const stateChanges = alerts.filter((a) => a.gistFasterStateChanged)
  const maxDrift = Math.max(...alerts.map((a) => a.stepDrift ?? 0), 0)

  return (
    <section
      aria-label="Alerta de deriva do crossover GiST"
      className="rounded-xl border border-violet-200 bg-violet-50/80 p-4 dark:border-violet-900/30 dark:bg-violet-950/10"
    >
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <GitCompareArrows className="mt-0.5 size-5 shrink-0 text-violet-500" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-violet-800 dark:text-violet-300">
              {alerts.length} alteração(ões) no raio de crossover GiST
            </p>
            <p className="mt-0.5 text-xs text-violet-700 dark:text-violet-400">
              {maxDrift > 0 ? `Deriva de até ${maxDrift} step(s) detectada. ` : ""}
              {stateChanges.length > 0
                ? `${stateChanges.length} densidade(s) com mudança de regime GiST (mais lento/rápido que full scan). `
                : ""}
              O raio de crossover mudou significativamente — pode indicar alteração no índice GiST,
              versão do PostGIS ou hardware.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 transition-colors hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-200"
          >
            {expanded ? "Ocultar" : "Detalhes"}
          </button>
        </div>

        {/* Expanded details table */}
        {expanded && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-violet-200 text-violet-600 dark:border-violet-800 dark:text-violet-400">
                  <th className="pr-3 pb-2 font-medium">Densidade</th>
                  <th className="pr-3 pb-2 text-right font-medium">Anterior</th>
                  <th className="pr-3 pb-2 text-right font-medium">Atual</th>
                  <th className="pr-3 pb-2 text-right font-medium">Steps</th>
                  <th className="pr-3 pb-2 text-center font-medium">Regime</th>
                  <th className="pb-2 font-medium">Commits</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert, idx) => (
                  <tr
                    key={`drift-${alert.density}-${idx}`}
                    className="border-b border-violet-100 last:border-0 dark:border-violet-800/30"
                  >
                    <td className="py-2 pr-3 font-medium tabular-nums">
                      {alert.density.toLocaleString()} prov
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {alert.previousRadiusKm != null ? `${alert.previousRadiusKm} km` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {alert.currentRadiusKm != null ? `${alert.currentRadiusKm} km` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium tabular-nums">
                      {alert.stepDrift != null ? (
                        <span className={alert.stepDrift > 1 ? "text-red-500" : "text-amber-500"}>
                          {alert.stepDrift}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-center">
                      {alert.gistFasterStateChanged ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                          Mudou
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-[10px]">Estável</span>
                      )}
                    </td>
                    <td className="py-2 font-mono text-[10px] tabular-nums">
                      <span className="cursor-help" title={`Anterior: ${alert.previousCommitHash}`}>
                        {alert.previousCommitHash.slice(0, 7)}
                      </span>
                      <span className="text-muted-foreground mx-1">→</span>
                      <span className="cursor-help" title={`Atual: ${alert.currentCommitHash}`}>
                        {alert.currentCommitHash.slice(0, 7)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "hsl(240, 4%, 60%)"

  const labels: Record<string, string> = {
    regression: "⚠ Regressão",
    improvement: "✅ Melhoria",
    unchanged: "— Estável",
    changed: "⚡ Alterado",
    new: "🆕 Novo",
    removed: "🗑 Removido",
  }

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: `${color}20`, color }}
    >
      {labels[status] ?? status}
    </span>
  )
}

// ── Helpers for filtered runs ────────────────────────────────────────────

function filteredRunCount(runs: Record<string, BenchmarkFile[]>): number {
  return Object.values(runs).reduce((a, r) => a + r.length, 0)
}

// ---------------------------------------------------------------------------
// Per-benchmark temporal trend builder
// ---------------------------------------------------------------------------

function buildPerBenchTrend(
  allRuns: Record<string, BenchmarksResponse["runs"][string]>,
  filterFn: (ts: string | undefined) => boolean,
  selectedTypes: Set<string>,
): Array<Record<string, number | string>> {
  // Collect all entries grouped by date
  const dateMap = new Map<
    string,
    { ts: number; vals: Record<string, { mean: number; ops: number; p95: number }> }
  >()

  for (const [type, typeRuns] of Object.entries(allRuns)) {
    if (!selectedTypes.has(type)) continue

    for (const run of typeRuns) {
      const ts = run.meta?.timestamp
      if (!ts || !filterFn(ts)) continue

      const d = new Date(ts)
      const dateKey = d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })

      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, { ts: d.getTime(), vals: {} })
      }
      const group = dateMap.get(dateKey)!

      for (const bench of run.benchmarks) {
        const key = `${type}::${bench.label}`
        if (!group.vals[key] || group.vals[key].mean === 0) {
          group.vals[key] = {
            mean: bench.mean,
            ops: bench.opsPerSec,
            p95: bench.p95 ?? bench.mean, // fallback to mean if no P95
          }
        }
      }
    }
  }

  // Convert to sorted array
  return [...dateMap.entries()]
    .sort(([, a], [, b]) => a.ts - b.ts)
    .map(([date, { vals }]) => {
      const row: Record<string, number | string> = { date }
      for (const [key, v] of Object.entries(vals)) {
        row[`${key}_mean`] = v.mean
        row[`${key}_ops`] = v.ops
        row[`${key}_p95`] = v.p95
      }
      return row
    })
}

/** Build line configs for per-benchmark chart */
function perBenchLines(
  data: Array<Record<string, number | string>>,
  metric: "mean" | "ops" | "p95",
): Array<{ dataKey: string; name: string; color: string }> {
  if (data.length === 0) return []

  const suffix = metric === "mean" ? "_mean" : metric === "ops" ? "_ops" : "_p95"
  const keys = Object.keys(data[0]).filter((k) => k.endsWith(suffix) && k !== "date")

  const TYPE_PALETTE = [
    "hsl(201, 90%, 48%)",
    "hsl(38, 92%, 50%)",
    "hsl(160, 84%, 39%)",
    "hsl(0, 72%, 51%)",
    "hsl(270, 76%, 53%)",
    "hsl(340, 82%, 52%)",
    "hsl(180, 80%, 40%)",
    "hsl(30, 90%, 55%)",
  ]

  return keys.map((dataKey, idx) => {
    // Extract readable name from key: "geo::haversine_100" → "geo: haversine 100"
    const [type, label] = dataKey.replace(suffix, "").split("::")
    const prettyName = label
      ? `${TYPE_LABELS[type] ?? type}: ${label.replace(/_/g, " ")}`
      : (TYPE_LABELS[type] ?? type)

    return {
      dataKey,
      name: prettyName,
      color: TYPE_PALETTE[idx % TYPE_PALETTE.length],
    }
  })
}

// ---------------------------------------------------------------------------
// Trend data builder (per-type aggregated)
// ---------------------------------------------------------------------------

function buildTrendData(
  runs: Record<string, BenchmarksResponse["runs"][string]>,
): Array<Record<string, number | string>> {
  // Collect all entries with timestamps
  interface TrendEntry {
    date: string
    timestamp: number
    type: string
    mean: number
    ops: number
    p95: number
  }

  const allEntries: TrendEntry[] = []

  for (const [type, typeRuns] of Object.entries(runs)) {
    for (const run of typeRuns) {
      const ts = run.meta?.timestamp
      if (!ts) continue

      // Use the first benchmark's mean as the representative value for this type
      const firstBench = run.benchmarks[0]
      if (!firstBench) continue

      const d = new Date(ts)
      allEntries.push({
        date: d.toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }),
        timestamp: d.getTime(),
        type,
        mean: firstBench.mean,
        ops: firstBench.opsPerSec,
        p95: firstBench.p95 ?? firstBench.mean,
      })
    }
  }

  // Sort by timestamp ascending (chronological)
  allEntries.sort((a, b) => a.timestamp - b.timestamp)

  // Group by date + type, keeping first occurrence's timestamp
  const grouped = new Map<
    string,
    { types: Record<string, { mean: number; ops: number; p95: number }>; ts: number }
  >()
  for (const entry of allEntries) {
    if (!grouped.has(entry.date)) {
      grouped.set(entry.date, { types: {}, ts: entry.timestamp })
    }
    const group = grouped.get(entry.date)!
    group.types[entry.type] = { mean: entry.mean, ops: entry.ops, p95: entry.p95 }
  }

  // Convert to array preserving chronological order (entries were already sorted)
  return [...grouped.entries()]
    .sort(([, a], [, b]) => a.ts - b.ts)
    .map(([date, { types }]) => {
      const row: Record<string, number | string> = { date }
      for (const [type, vals] of Object.entries(types)) {
        row[type] = vals.mean
        row[`${type}_ops`] = vals.ops
        row[`${type}_p95`] = vals.p95
      }
      return row
    })
}

// ---------------------------------------------------------------------------
// GiST Crossover Timeline
// ---------------------------------------------------------------------------

/**
 * GiSTCrossoverTimeline — Plots the evolution of the GiST index crossover
 * radius across weekly benchmark runs, extracted from git history of
 * geo-gist-baseline.json.
 *
 * Shows:
 *   - Crossover radius (km) per density over time
 *   - Best GiST/full ratio (%) per density over time
 *   - Commit hash tooltip for traceability
 */

const CROSSOVER_COLORS = ["hsl(160, 84%, 39%)", "hsl(201, 90%, 48%)", "hsl(38, 92%, 50%)"]

function GiSTCrossoverTimeline({ history }: { history: GistCrossoverPoint[] }) {
  const [selectedDensity, setSelectedDensity] = React.useState<number | "all">("all")

  // Group by density
  const densities = [...new Set(history.map((p) => p.density))].sort((a, b) => a - b)

  // Build chart data: group by timestamp, flatten for Recharts
  const timeGroups = new Map<
    string,
    {
      ts: number
      date: string
      commitHash: string
      values: Record<string, { radius: number | null; ratio: number | null }>
    }
  >()

  for (const point of history) {
    const d = new Date(point.timestamp)
    const dateKey = d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })

    if (!timeGroups.has(dateKey)) {
      timeGroups.set(dateKey, {
        ts: d.getTime(),
        date: dateKey,
        commitHash: point.commitHash,
        values: {},
      })
    }
    const group = timeGroups.get(dateKey)!
    group.values[`density_${point.density}`] = {
      radius: point.crossoverRadiusKm,
      ratio: point.bestRatioPct,
    }
  }

  const chartData = [...timeGroups.entries()]
    .sort(([, a], [, b]) => a.ts - b.ts)
    .map(([, group]) => {
      const row: Record<string, number | string | null> = {
        date: group.date,
        commitHash: group.commitHash,
      }
      for (const [key, v] of Object.entries(group.values)) {
        row[`${key}_radius`] = v.radius
        row[`${key}_ratio`] = v.ratio
      }
      return row
    })

  if (chartData.length === 0) return null

  // Filtered data for per-density view
  const filteredChartData =
    selectedDensity === "all"
      ? chartData
      : chartData.filter((row) => {
          const key = `density_${selectedDensity}`
          return row[`${key}_radius`] != null || row[`${key}_ratio`] != null
        })

  // ── 4-week rolling average crossover radius ──────────────────────
  const ROLLING_WINDOW = 4

  const rollingAvgKm = (() => {
    if (chartData.length === 0) return null

    if (selectedDensity === "all") {
      // Average of all densities: collect first non-null radius per point
      const recent = chartData.slice(-ROLLING_WINDOW).filter(Boolean)
      const values: number[] = []
      for (const row of recent) {
        for (const d of densities) {
          const v = row[`density_${d}_radius`]
          if (v != null && typeof v === "number") {
            values.push(v)
            break
          }
        }
      }
      if (values.length === 0) return null
      return +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)
    }

    // Single density selected: average last ROLLING_WINDOW non-null radius values
    const key = `density_${selectedDensity}_radius`
    const values = chartData
      .map((row) => row[key])
      .filter((v): v is number => v != null && typeof v === "number")
      .slice(-ROLLING_WINDOW)
    if (values.length === 0) return null
    return +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)
  })()

  // Show the last commit's hash
  const latestPoint = history.reduce((a, b) =>
    new Date(a.timestamp) > new Date(b.timestamp) ? a : b,
  )

  return (
    <section
      aria-label="Evolução do crossover GiST"
      className="border-border/50 bg-card rounded-xl border"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="size-5 text-emerald-500" />
          <h2 className="text-foreground text-sm font-semibold">Evolução do Crossover GiST</h2>
          <span className="text-muted-foreground rounded-full border px-2 py-0.5 font-mono text-[10px]">
            {chartData.length} snapshots
          </span>
        </div>

        {/* Density selector */}
        <div className="flex items-center gap-1.5">
          <MapPin className="text-muted-foreground size-3.5" />
          <button
            type="button"
            onClick={() => setSelectedDensity("all")}
            className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-medium transition-all",
              selectedDensity === "all"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
          >
            Todos
          </button>
          {densities.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setSelectedDensity(d)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[10px] font-medium transition-all",
                selectedDensity === d
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {d.toLocaleString()} prov
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 p-4 lg:grid-cols-2">
        {/* ── Crossover Radius Chart ───────────────────────────────── */}
        <MetricCard icon={MapPin} title="Raio de Crossover (km)">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={filteredChartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  label={{
                    value: "km",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" },
                  }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, n: string) => {
                    const density = n.match(/density_(\d+)/)?.[1]
                    return [
                      `${v} km`,
                      density ? `${Number(density).toLocaleString()} providers` : n,
                    ]
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                {selectedDensity === "all"
                  ? densities.map((d, idx) => (
                      <Line
                        key={`density_${d}`}
                        type="monotone"
                        dataKey={`density_${d}_radius`}
                        name={`${d.toLocaleString()} providers`}
                        stroke={CROSSOVER_COLORS[idx % CROSSOVER_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                        connectNulls={false}
                      />
                    ))
                  : (() => {
                      const d = selectedDensity
                      return (
                        <Line
                          type="monotone"
                          dataKey={`density_${d}_radius`}
                          name={`${d.toLocaleString()} providers`}
                          stroke={CROSSOVER_COLORS[0]}
                          strokeWidth={2.5}
                          dot={{ r: 5, fill: CROSSOVER_COLORS[0] }}
                          activeDot={{ r: 7 }}
                          connectNulls={false}
                        />
                      )
                    })()}
                {/* 4-week rolling average reference line */}
                {rollingAvgKm != null && (
                  <ReferenceLine
                    key={`rolling-avg-${rollingAvgKm}`}
                    y={rollingAvgKm}
                    stroke="hsl(270, 76%, 53%)"
                    strokeDasharray="6 3"
                    strokeWidth={2}
                    label={{
                      value: `Média 4 sem: ${rollingAvgKm} km`,
                      position: "insideTopRight",
                      fill: "hsl(270, 76%, 53%)",
                      fontSize: 9,
                    }}
                    className="animate-in fade-in duration-500"
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>

        {/* ── Best Ratio Chart ─────────────────────────────────────── */}
        <MetricCard icon={BarChart3} title="Melhor Razão GiST / Full Scan (%)">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={filteredChartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                <XAxis
                  dataKey="date"
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
                  domain={[0, 100]}
                  label={{
                    value: "%",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" },
                  }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, n: string) => {
                    const density = n.match(/density_(\d+)/)?.[1]
                    return [`${v}%`, density ? `${Number(density).toLocaleString()} providers` : n]
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                {/* Reference line at 100% = GiST same speed as full scan */}
                {/* Below 100% = GiST faster */}
                <ReferenceLine
                  y={100}
                  stroke="hsl(0, 72%, 51%)"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: "Full scan",
                    position: "right",
                    fill: "hsl(0, 72%, 51%)",
                    fontSize: 9,
                  }}
                />
                {selectedDensity === "all"
                  ? densities.map((d, idx) => (
                      <Line
                        key={`density_${d}_ratio`}
                        type="monotone"
                        dataKey={`density_${d}_ratio`}
                        name={`${d.toLocaleString()} providers`}
                        stroke={CROSSOVER_COLORS[idx % CROSSOVER_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                        connectNulls={false}
                      />
                    ))
                  : (() => {
                      const d = selectedDensity
                      return (
                        <Line
                          type="monotone"
                          dataKey={`density_${d}_ratio`}
                          name={`${d.toLocaleString()} providers`}
                          stroke={CROSSOVER_COLORS[1]}
                          strokeWidth={2.5}
                          dot={{ r: 5, fill: CROSSOVER_COLORS[1] }}
                          activeDot={{ r: 7 }}
                          connectNulls={false}
                        />
                      )
                    })()}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>
      </div>

      {/* Summary footer */}
      <div className="border-t px-5 py-3">
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-1 text-[10px]">
          <span>
            Baseline commits consultados:{" "}
            <span className="font-mono font-medium">{chartData.length}</span>
          </span>
          <span>
            Último snapshot:{" "}
            <span className="font-mono font-medium">
              {new Date(latestPoint.timestamp).toLocaleDateString("pt-BR")}
            </span>
            <span className="ml-1 font-mono text-[9px]">({latestPoint.commitHash})</span>
          </span>
          <span>Densidades monitoradas: {densities.map((d) => d.toLocaleString()).join(", ")}</span>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Benchmark Timeline View (Geo / Cache)
// ---------------------------------------------------------------------------

/**
 * BenchmarkTimelineView — Renders a per-benchmark evolution chart and
 * snapshot table from git history entries (e.g. geo or cache benchmark
 * JSON files extracted from git).
 */
function BenchmarkTimelineView({
  type,
  label,
  history,
  color,
}: {
  type: string
  label: string
  history: BenchmarkHistoryEntry[]
  color: string
}) {
  // Build chart data: group by date, then per benchmark label
  const chartData = React.useMemo(() => {
    const dateMap = new Map<
      string,
      { ts: number; vals: Record<string, { mean: number; ops: number; p95: number }> }
    >()

    for (const entry of history) {
      const ts = entry.timestamp
      if (!ts) continue

      const d = new Date(ts)
      const dateKey = d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })

      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, { ts: d.getTime(), vals: {} })
      }
      const group = dateMap.get(dateKey)!

      for (const bench of entry.data.benchmarks) {
        if (!group.vals[bench.label] || group.vals[bench.label].mean === 0) {
          group.vals[bench.label] = {
            mean: bench.mean,
            ops: bench.opsPerSec,
            p95: bench.p95 ?? bench.mean,
          }
        }
      }
    }

    return [...dateMap.entries()]
      .sort(([, a], [, b]) => a.ts - b.ts)
      .map(([date, { vals }]) => {
        const row: Record<string, number | string> = { date }
        for (const [key, v] of Object.entries(vals)) {
          row[`${key}_mean`] = v.mean
          row[`${key}_ops`] = v.ops
          row[`${key}_p95`] = v.p95
        }
        return row
      })
  }, [history])

  // Determine which lines to render
  const lines = React.useMemo(() => {
    if (chartData.length === 0) return []
    const suffix = "_mean"
    const keys = Object.keys(chartData[0]).filter((k) => k.endsWith(suffix) && k !== "date")

    const PALETTE = [
      "hsl(201, 90%, 48%)",
      "hsl(38, 92%, 50%)",
      "hsl(160, 84%, 39%)",
      "hsl(0, 72%, 51%)",
    ]

    return keys.map((dataKey, idx) => ({
      dataKey,
      name: dataKey.replace(suffix, "").replace(/_/g, " "),
      color: PALETTE[idx % PALETTE.length],
    }))
  }, [chartData])

  if (chartData.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-12">
        <FileJson className="size-8 opacity-50" />
        <p className="text-sm">Nenhum snapshot histórico encontrado para {label}.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Chart */}
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={50}
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              label={{
                value: "µs",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
              }}
              scale="log"
              domain={["auto", "auto"]}
            />
            <RTooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: number, n: string) => [`${v.toFixed(v < 1 ? 2 : 1)} µs`, n]}
            />
            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
            {lines.slice(0, 12).map((line) => (
              <Line
                key={line.dataKey}
                type="monotone"
                dataKey={line.dataKey}
                name={line.name}
                stroke={line.color}
                strokeWidth={1.5}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        {lines.length > 12 && (
          <p className="text-muted-foreground mt-1 text-[10px]">
            Mostrando 12 de {lines.length} benchmarks
          </p>
        )}
      </div>

      {/* Snapshot table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground border-b">
              <th className="pr-3 pb-2 font-medium">Snapshot</th>
              <th className="pr-3 pb-2 font-medium">Commit</th>
              <th className="pr-3 pb-2 text-right font-medium">Benchmarks</th>
              <th className="pr-3 pb-2 text-right font-medium">Latência Média</th>
              <th className="pb-2 text-right font-medium">Throughput</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry, idx) => {
              const avg =
                entry.data.benchmarks.length > 0
                  ? entry.data.benchmarks.reduce((a, b) => a + b.mean, 0) /
                    entry.data.benchmarks.length
                  : 0
              const throughput =
                entry.data.benchmarks.length > 0
                  ? entry.data.benchmarks.reduce((a, b) => a + b.opsPerSec, 0) /
                    entry.data.benchmarks.length
                  : 0
              return (
                <tr
                  key={`${entry.commitHash}-${idx}`}
                  className="hover:bg-muted/20 border-b last:border-0"
                >
                  <td className="text-foreground py-2 pr-3 font-medium tabular-nums">
                    {new Date(entry.timestamp).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[10px]">
                    <span className="cursor-help" title={`Commit completo: ${entry.commitHash}`}>
                      {entry.commitHash}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {entry.data.benchmarks.length}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{avg.toFixed(1)} µs</td>
                  <td className="py-2 text-right tabular-nums">{throughput.toFixed(0)} ops/s</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="text-muted-foreground flex items-center gap-4 text-[10px]">
        <span>
          Total de snapshots: <span className="font-medium">{history.length}</span>
        </span>
        <span>
          Período: {new Date(history[0].timestamp).toLocaleDateString("pt-BR")} →{" "}
          {new Date(history[history.length - 1].timestamp).toLocaleDateString("pt-BR")}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function BenchmarkSkeleton() {
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
              <Skeleton className="h-[250px] w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>

      <div className="bg-card rounded-xl border">
        <div className="border-b px-5 py-4">
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="p-4">
          <Skeleton className="h-48 w-full rounded-md" />
        </div>
      </div>
    </div>
  )
}
