"use client"

/**
 * AdminBenchmarkEvolution — Evolução temporal dos 6 benchmarks de
 * geolocalização ao longo de todas as execuções disponíveis.
 *
 * Consome os dados de /api/admin/benchmarks (que lê os JSONs de
 * docs/benchmarks/) e plota:
 *   - Haversine JS: 100 / 1.000 / 10.000 providers (µs)
 *   - PostGIS [model]: 100 / 1.000 / 10.000 providers (µs)
 *   - Razão PostGIS / Haversine por escala
 *
 * KPIs mostram o valor mais recente de cada benchmark + tendência.
 */

import * as React from "react"
import {
  Activity,
  BarChart3,
  Database,
  FileJson,
  Gauge,
  GitCompareArrows,
  MousePointerClick,
  TrendingDown,
  TrendingUp,
  Zap,
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
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState, RefreshButton } from "./_shared"
import { TOOLTIP_STYLE } from "./admin-chart-theme"

import type { BenchmarksResponse, BenchmarkPoint } from "@/app/api/admin/benchmarks/route"

// ---------------------------------------------------------------------------
// Constants — 6 geo benchmarks
// ---------------------------------------------------------------------------

const GEO_LABELS = [
  "haversine_100",
  "haversine_1000",
  "haversine_10000",
  "postgis_model_100",
  "postgis_model_1000",
  "postgis_model_10000",
] as const

const GEO_DISPLAY_NAMES: Record<string, string> = {
  haversine_100: "Haversine 100",
  haversine_1000: "Haversine 1.000",
  haversine_10000: "Haversine 10.000",
  postgis_model_100: "PostGIS 100",
  postgis_model_1000: "PostGIS 1.000",
  postgis_model_10000: "PostGIS 10.000",
}

const HAVERSINE_LABELS = ["haversine_100", "haversine_1000", "haversine_10000"]
const POSTGIS_LABELS = ["postgis_model_100", "postgis_model_1000", "postgis_model_10000"]

const HAV_COLORS = ["hsl(38, 92%, 50%)", "hsl(30, 90%, 55%)", "hsl(20, 85%, 50%)"]
const PG_COLORS = ["hsl(201, 90%, 48%)", "hsl(190, 80%, 42%)", "hsl(210, 85%, 40%)"]

const METRIC_KEYS = ["mean", "ops", "p95"] as const
type MetricKey = (typeof METRIC_KEYS)[number]

const METRIC_LABELS: Record<MetricKey, string> = {
  mean: "Latência Média (µs)",
  ops: "Throughput (ops/s)",
  p95: "P95 (µs)",
}

const METRIC_Y_LABELS: Record<MetricKey, string> = {
  mean: "µs",
  ops: "ops/s",
  p95: "µs",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build chronological evolution data for the 6 geo benchmarks. */
function buildEvolutionData(
  runs: Record<string, BenchmarksResponse["runs"][string]>,
  metric: MetricKey,
): Array<Record<string, number | string>> {
  const dateMap = new Map<string, { ts: number; vals: Record<string, number> }>()

  for (const [, typeRuns] of Object.entries(runs)) {
    for (const run of typeRuns) {
      const ts = run.meta?.timestamp
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

      for (const bench of run.benchmarks) {
        if (GEO_LABELS.includes(bench.label as (typeof GEO_LABELS)[number])) {
          const v =
            metric === "mean"
              ? bench.mean
              : metric === "ops"
                ? bench.opsPerSec
                : (bench.p95 ?? bench.mean)
          group.vals[bench.label] = v
        }
      }
    }
  }

  return [...dateMap.entries()]
    .sort(([, a], [, b]) => a.ts - b.ts)
    .map(([date, { vals }]) => ({ date, ...vals }))
}

/** Compute evolution for the ratio PostGIS/Haversine per provider count. */
function buildRatioData(
  runs: Record<string, BenchmarksResponse["runs"][string]>,
): Array<Record<string, number | string>> {
  const dateMap = new Map<string, { ts: number; vals: Record<string, number> }>()

  for (const [, typeRuns] of Object.entries(runs)) {
    for (const run of typeRuns) {
      const ts = run.meta?.timestamp
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

      const benchMap = new Map(run.benchmarks.map((b) => [b.label, b]))

      for (const n of [100, 1000, 10000]) {
        const hav = benchMap.get(`haversine_${n}`)
        const pg = benchMap.get(`postgis_model_${n}`)
        if (hav && pg && hav.mean > 0) {
          group.vals[`ratio_${n}`] = +(pg.mean / hav.mean).toFixed(1)
        }
      }
    }
  }

  return [...dateMap.entries()]
    .sort(([, a], [, b]) => a.ts - b.ts)
    .map(([date, { vals }]) => ({ date, ...vals }))
}

/** Get the latest value for a benchmark label from all runs. */
function getLatestValue(
  runs: Record<string, BenchmarksResponse["runs"][string]>,
  label: string,
  metric: MetricKey,
): number | null {
  let latest: number | null = null
  let latestTs = 0

  for (const [, typeRuns] of Object.entries(runs)) {
    for (const run of typeRuns) {
      const ts = run.meta?.timestamp ? new Date(run.meta.timestamp).getTime() : 0
      if (ts <= latestTs) continue

      for (const bench of run.benchmarks) {
        if (bench.label === label) {
          latest =
            metric === "mean"
              ? bench.mean
              : metric === "ops"
                ? bench.opsPerSec
                : (bench.p95 ?? bench.mean)
          latestTs = ts
        }
      }
    }
  }

  return latest
}

/** Compute trend direction: +1 up, -1 down, 0 flat (acima de 5%).
 *  Para métrica 'ops', +1 é melhoria (verde); para 'mean'/'p95', +1 é regressão (vermelho). */
function computeTrend(
  runs: Record<string, BenchmarksResponse["runs"][string]>,
  label: string,
  metric: MetricKey,
): number {
  const values: Array<{ ts: number; v: number }> = []

  for (const [, typeRuns] of Object.entries(runs)) {
    for (const run of typeRuns) {
      const ts = run.meta?.timestamp ? new Date(run.meta.timestamp).getTime() : 0
      for (const bench of run.benchmarks) {
        if (bench.label === label) {
          const v =
            metric === "mean"
              ? bench.mean
              : metric === "ops"
                ? bench.opsPerSec
                : (bench.p95 ?? bench.mean)
          values.push({ ts, v })
        }
      }
    }
  }

  values.sort((a, b) => a.ts - b.ts)
  if (values.length < 2) return 0

  const first = values[0].v
  const last = values[values.length - 1].v
  if (first === 0) return 0
  const pct = ((last - first) / first) * 100
  if (Math.abs(pct) < 5) return 0

  // Para ops, maior = melhor (inverter a direção para o ícone)
  if (metric === "ops") return pct > 0 ? -1 : 1
  return pct > 0 ? 1 : -1
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AdminBenchmarkEvolution() {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "benchmarks", "evolution"],
    queryFn: () => apiGet<BenchmarksResponse>("/api/admin/benchmarks"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const [metric, setMetric] = React.useState<MetricKey>("mean")
  const [hoveredBench, setHoveredBench] = React.useState<string | null>(null)

  // ── Error ──────────────────────────────────────────────────────────
  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar a evolução dos benchmarks"
        description="Verifique se você está autenticado como administrador e se existem arquivos de benchmark em docs/benchmarks/."
        onRetry={() => void refetch()}
      />
    )
  }

  // ── Loading ────────────────────────────────────────────────────────
  if (isLoading || !data) {
    return <EvolutionSkeleton />
  }

  const { runs } = data
  const hasGeoData = Object.values(runs).some((typeRuns) =>
    typeRuns.some((r) =>
      r.benchmarks.some((b) => GEO_LABELS.includes(b.label as (typeof GEO_LABELS)[number])),
    ),
  )

  if (!hasGeoData) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <HeaderSection
          isFetching={isFetching}
          dataUpdatedAt={dataUpdatedAt}
          onRefresh={() => void refetch()}
        />
        <section
          aria-label="Nenhum benchmark geo encontrado"
          className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16"
        >
          <BarChart3 className="text-muted-foreground/50 size-10" />
          <p className="text-muted-foreground text-sm font-medium">
            Nenhum benchmark de geolocalização encontrado
          </p>
          <p className="text-muted-foreground max-w-md text-center text-xs">
            Execute <code className="bg-muted rounded px-1 py-0.5">bun run benchmark:geo</code> para
            gerar dados. Com pelo menos 2 execuções, a evolução temporal será exibida aqui.
          </p>
        </section>
      </div>
    )
  }

  const evolutionData = buildEvolutionData(runs, metric)
  const ratioData = buildRatioData(runs)

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <HeaderSection
        isFetching={isFetching}
        dataUpdatedAt={dataUpdatedAt}
        onRefresh={() => void refetch()}
      />

      {/* ── Metric Selector ─────────────────────────────────────────── */}
      <section
        aria-label="Seletor de métrica"
        className="border-border/50 bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-4"
      >
        <div className="flex items-center gap-2">
          <Gauge className="text-primary size-4" />
          <h2 className="text-foreground text-sm font-semibold">Evolução dos 6 Benchmarks Geo</h2>
          <span className="text-muted-foreground ml-1 rounded-full border px-2 py-0.5 font-mono text-[10px]">
            {evolutionData.length} snapshots
          </span>
        </div>

        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          {METRIC_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setMetric(key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all",
                metric === key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {key === "mean" ? (
                <BarChart3 className="size-3" />
              ) : key === "ops" ? (
                <Activity className="size-3" />
              ) : (
                <MousePointerClick className="size-3" />
              )}
              {key === "mean" ? "Latência" : key === "ops" ? "Throughput" : "P95"}
            </button>
          ))}
        </div>
      </section>

      {/* ── KPI Cards (latest values) ───────────────────────────────── */}
      <section aria-label="Valores mais recentes" className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {GEO_LABELS.map((label) => {
          const v = getLatestValue(runs, label, metric)
          const trend = computeTrend(runs, label, metric)
          if (v == null) return null
          return (
            <div
              key={label}
              className={cn(
                "border-border/50 bg-card hover:border-primary/20 rounded-xl border p-4 transition-colors",
                hoveredBench === label && "ring-primary/30 ring-2",
              )}
              onMouseEnter={() => setHoveredBench(label)}
              onMouseLeave={() => setHoveredBench(null)}
            >
              <div className="flex items-start justify-between">
                <p className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
                  {GEO_DISPLAY_NAMES[label]}
                </p>
                {trend !== 0 &&
                  (trend > 0 ? (
                    <TrendingUp className="size-3.5 text-red-500" />
                  ) : (
                    <TrendingDown className="size-3.5 text-emerald-500" />
                  ))}
              </div>
              <p className="mt-1 text-lg font-bold tracking-tight tabular-nums">
                {metric === "ops" ? v.toLocaleString() : v.toFixed(v < 1 ? 2 : 1)}
              </p>
              <p className="text-muted-foreground text-[10px]">
                {metric === "ops" ? "ops/s" : "µs"}
              </p>
            </div>
          )
        })}
      </section>

      {/* ── Evolution Charts ────────────────────────────────────────── */}
      {evolutionData.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Haversine Evolution */}
          <ChartCard
            icon={Zap}
            title={`Haversine JS — ${METRIC_LABELS[metric]}`}
            subtitle="Evolução do algoritmo Haversine em 3 escalas de provedores"
          >
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={evolutionData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
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
                    width={55}
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    label={{
                      value: METRIC_Y_LABELS[metric],
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                    }}
                    scale={metric === "ops" ? "auto" : "log"}
                    domain={["auto", "auto"]}
                  />
                  <RTooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number, n: string) => {
                      const suffix = metric === "ops" ? " ops/s" : " µs"
                      return [
                        `${metric === "ops" ? v.toLocaleString() : v.toFixed(v < 1 ? 2 : 1)}${suffix}`,
                        GEO_DISPLAY_NAMES[n] ?? n,
                      ]
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                  {HAVERSINE_LABELS.map((label, idx) => (
                    <Line
                      key={label}
                      type="monotone"
                      dataKey={label}
                      name={GEO_DISPLAY_NAMES[label]}
                      stroke={HAV_COLORS[idx]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{
                        r: 5,
                        onMouseEnter: () => setHoveredBench(label),
                        onMouseLeave: () => setHoveredBench(null),
                      }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          {/* PostGIS Evolution */}
          <ChartCard
            icon={Database}
            title={`PostGIS [model] — ${METRIC_LABELS[metric]}`}
            subtitle="Evolução do modelo PostGIS em 3 escalas de provedores"
          >
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={evolutionData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
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
                    width={55}
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    label={{
                      value: METRIC_Y_LABELS[metric],
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                    }}
                    scale={metric === "ops" ? "auto" : "log"}
                    domain={["auto", "auto"]}
                  />
                  <RTooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number, n: string) => {
                      const suffix = metric === "ops" ? " ops/s" : " µs"
                      return [
                        `${metric === "ops" ? v.toLocaleString() : v.toFixed(v < 1 ? 2 : 1)}${suffix}`,
                        GEO_DISPLAY_NAMES[n] ?? n,
                      ]
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                  {POSTGIS_LABELS.map((label, idx) => (
                    <Line
                      key={label}
                      type="monotone"
                      dataKey={label}
                      name={GEO_DISPLAY_NAMES[label]}
                      stroke={PG_COLORS[idx]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{
                        r: 5,
                        onMouseEnter: () => setHoveredBench(label),
                        onMouseLeave: () => setHoveredBench(null),
                      }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      )}

      {/* ── Ratio Comparison Chart ──────────────────────────────────── */}
      {ratioData.length > 0 && (
        <ChartCard
          icon={GitCompareArrows}
          title="Razão PostGIS / Haversine"
          subtitle="Quantas vezes o PostGIS é mais lento que o Haversine em cada escala. < 70× = GiST filtering compensou."
        >
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ratioData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
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
                  label={{
                    value: "× mais lento",
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
                    const scale = n.replace("ratio_", "")
                    return [`${v.toFixed(1)}×`, `${Number(scale).toLocaleString()} providers`]
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                {/* Reference line at 70×: typical Haversine single-call advantage */}
                <ReferenceLine
                  y={70}
                  stroke="hsl(38, 92%, 50%)"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: "Haversine 70×",
                    position: "right",
                    fill: "hsl(38, 92%, 50%)",
                    fontSize: 9,
                  }}
                />
                {[100, 1000, 10000].map((n, idx) => (
                  <Line
                    key={`ratio_${n}`}
                    type="monotone"
                    dataKey={`ratio_${n}`}
                    name={`${n.toLocaleString()} providers`}
                    stroke={PG_COLORS[idx]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[10px]">
            <span>🔹 Abaixo de 70× = GiST compensou (filtrou antes de calcular)</span>
            <span>🔸 Acima de 70× = Haversine puro seria mais rápido</span>
          </div>
        </ChartCard>
      )}

      {/* ── Raw Data Table ──────────────────────────────────────────── */}
      {evolutionData.length > 0 && (
        <section>
          <ChartCard icon={FileJson} title="Dados brutos (média µs)">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="pr-3 pb-2 font-medium">Data</th>
                    {GEO_LABELS.map((label) => (
                      <th key={label} className="pr-3 pb-2 text-right font-medium">
                        {GEO_DISPLAY_NAMES[label]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {evolutionData.map((row) => (
                    <tr
                      key={row.date as string}
                      className="hover:bg-muted/20 border-b last:border-0"
                    >
                      <td className="text-foreground py-1.5 pr-3 font-medium tabular-nums">
                        {row.date as string}
                      </td>
                      {GEO_LABELS.map((label) => {
                        const v = row[label]
                        return (
                          <td
                            key={label}
                            className="text-muted-foreground py-1.5 pr-3 text-right tabular-nums"
                          >
                            {v != null
                              ? metric === "ops"
                                ? Number(v).toLocaleString()
                                : Number(v).toFixed(1)
                              : "—"}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </section>
      )}

      {/* ── Footer Info ─────────────────────────────────────────────── */}
      <div className="border-border/50 bg-muted/30 text-muted-foreground rounded-lg border px-4 py-2 text-[10px]">
        Fonte: docs/benchmarks/*.json · {evolutionData.length} snapshots · Última atualização:{" "}
        {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleString("pt-BR") : "—"}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HeaderSection({
  isFetching,
  dataUpdatedAt,
  onRefresh,
}: {
  isFetching: boolean
  dataUpdatedAt: number
  onRefresh: () => void
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-foreground text-xl font-bold tracking-tight">
          Evolução dos Benchmarks Geo
        </h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Visualização temporal dos 6 benchmarks de geolocalização ao longo de todas as execuções
        </p>
      </div>

      <div className="flex items-center gap-3">
        {dataUpdatedAt ? (
          <span className="text-muted-foreground text-xs">
            Atualizado {new Date(dataUpdatedAt).toLocaleTimeString("pt-BR")}
          </span>
        ) : null}
        <RefreshButton isFetching={isFetching} onRefresh={onRefresh} />
      </div>
    </div>
  )
}

function ChartCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ElementType
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="border-border/50 bg-card rounded-xl border">
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <Icon className="text-primary size-4" />
        <div>
          <h2 className="text-foreground text-sm font-semibold">{title}</h2>
          {subtitle ? <p className="text-muted-foreground mt-0.5 text-[10px]">{subtitle}</p> : null}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function EvolutionSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border p-4">
            <Skeleton className="mb-1 h-3 w-20" />
            <Skeleton className="h-6 w-14" />
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
              <Skeleton className="h-[280px] w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>

      <div className="bg-card rounded-xl border">
        <div className="border-b px-5 py-4">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="p-4">
          <Skeleton className="h-[280px] w-full rounded-md" />
        </div>
      </div>
    </div>
  )
}
