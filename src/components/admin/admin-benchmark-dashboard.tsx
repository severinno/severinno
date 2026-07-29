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
  CheckCircle2,
  Clock,
  Database,
  FileJson,
  TrendingDown,
  TrendingUp,
  Activity,
  RefreshCw,
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

import type {
  BenchmarksResponse,
  ComparisonResult,
  BenchmarkDiffEntry,
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

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar os benchmarks"
        description="Verifique se você está autenticado como administrador e se existem arquivos de benchmark em docs/benchmarks/."
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return <BenchmarkSkeleton />
  }

  const { summary, comparisons, runs, regressionCount, lastRun } = data
  const hasComparisons = comparisons.length > 0
  const hasRegressions = regressionCount > 0

  // ── Trend data: extract mean values for key benchmarks across historical runs ──
  const trendData = buildTrendData(runs)

  // ── Aggregate all diffs for the regressions table ──
  const allRegressions = comparisons.flatMap((c) =>
    c.regressions.map((r) => ({ ...r, type: c.type })),
  )

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

      {/* ── Trend Chart ─────────────────────────────────────────────── */}
      {trendData.length > 0 && (
        <section aria-label="Tendência temporal" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <MetricCard icon={BarChart3} title="Latência Média por Run (µs)">
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
                      value: "µs",
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                    }}
                  />
                  <RTooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                  {Object.keys(TYPE_COLORS).map((type) => (
                    <Line
                      key={type}
                      type="monotone"
                      dataKey={type}
                      name={TYPE_LABELS[type]}
                      stroke={TYPE_COLORS[type]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </MetricCard>

          <MetricCard icon={Activity} title="ops/sec por Run">
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
                      value: "ops/s",
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                    }}
                  />
                  <RTooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                  {Object.keys(TYPE_COLORS).map((type) => (
                    <Line
                      key={type}
                      type="monotone"
                      dataKey={`${type}_ops`}
                      name={TYPE_LABELS[type]}
                      stroke={TYPE_COLORS[type]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </MetricCard>
        </section>
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

// ---------------------------------------------------------------------------
// Trend data builder
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
      })
    }
  }

  // Sort by timestamp ascending (chronological)
  allEntries.sort((a, b) => a.timestamp - b.timestamp)

  // Group by date + type, keeping first occurrence's timestamp
  const grouped = new Map<
    string,
    { types: Record<string, { mean: number; ops: number }>; ts: number }
  >()
  for (const entry of allEntries) {
    if (!grouped.has(entry.date)) {
      grouped.set(entry.date, { types: {}, ts: entry.timestamp })
    }
    const group = grouped.get(entry.date)!
    group.types[entry.type] = { mean: entry.mean, ops: entry.ops }
  }

  // Convert to array preserving chronological order (entries were already sorted)
  return [...grouped.entries()]
    .sort(([, a], [, b]) => a.ts - b.ts)
    .map(([date, { types }]) => {
      const row: Record<string, number | string> = { date }
      for (const [type, vals] of Object.entries(types)) {
        row[type] = vals.mean
        row[`${type}_ops`] = vals.ops
      }
      return row
    })
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
