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
  Activity,
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
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { apiGet } from "@/lib/api"
import { cn } from "@/lib/utils"
import { DashboardHeader, ErrorState, KpiCard, MetricCard } from "./_shared"
import { TOOLTIP_STYLE } from "./admin-chart-theme"
import {
  buildTrendData,
  buildPerBenchTrend,
  perBenchLines,
  isTimestampInRange,
  filteredRunCount,
  BENCHMARK_TYPE_LABELS,
} from "@/lib/benchmark-data"

import type { BenchmarksResponse, BenchmarkFile } from "@/app/api/admin/benchmarks/route"

import {
  BenchmarkSkeleton,
  ComparisonSection,
  CrossoverDriftBanner,
  GiSTCrossoverTimeline,
  BenchmarkTimelineView,
  TYPE_COLORS,
} from "./benchmark"

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
  const filterTimestamp = (ts: string | undefined): boolean =>
    isTimestampInRange(ts, dateRange.start, dateRange.end)

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
      <DashboardHeader
        title="Monitoramento de Benchmarks"
        description="Comparação contínua de desempenho dos benchmarks de geolocalização"
        isFetching={isFetching}
        onRefresh={() => void refetch()}
        dataUpdatedAt={dataUpdatedAt}
        refreshLabel="Atualizar benchmarks"
      />

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
          trend={hasRegressions ? "down" : "up"}
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
            .map((t) => BENCHMARK_TYPE_LABELS[t] ?? t)
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
                  {BENCHMARK_TYPE_LABELS[type] ?? type}
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
                      const label = BENCHMARK_TYPE_LABELS[n.replace(/_ops$|_p95$/, "")] ?? n
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
                        name={BENCHMARK_TYPE_LABELS[type] ?? type}
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
                            {BENCHMARK_TYPE_LABELS[type] ?? type}
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

// Re-exports for modularity and backwards-compatibility
export {
  BenchmarkSkeleton,
  ComparisonSection,
  CrossoverDriftBanner,
  GiSTCrossoverTimeline,
  BenchmarkTimelineView,
} from "./benchmark"
