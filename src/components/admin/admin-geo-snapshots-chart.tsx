"use client"

/**
 * AdminGeoSnapshotsChart — Evolução Temporal das Métricas Geo
 *
 * Consome GET /api/admin/geo-snapshots-summary e plota gráficos de
 * área/linha com a evolução de P50, P95 e P99 ao longo do tempo
 * para Nominatim, ViaCEP e PostGIS.
 *
 * Exibe:
 *   1. KPIs: total de snapshots, buckets diários, range de datas
 *   2. Daily chart (área) — P50/P95/P99 por serviço
 *   3. Weekly chart (área) — visão semanal consolidada
 *   4. Seletor de dias: 7, 14, 30, 90, todos
 */

import * as React from "react"
import { Activity, BarChart3, CalendarDays, Database, History, MapPin, Search } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { apiGet } from "@/lib/api"
import { cn } from "@/lib/utils"
import { DashboardHeader, ErrorState, MetricCard } from "./_shared"
import { TOOLTIP_STYLE } from "./admin-chart-theme"
import { Skeleton } from "@/components/ui/skeleton"

import type { SnapshotsSummaryResponse, TimeBucket, GeoServiceName } from "@/types/geo"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVICES: GeoServiceName[] = ["nominatim", "viacep", "postgis"]

const SERVICE_CONFIG: Record<GeoServiceName, { icon: React.ElementType; label: string }> = {
  nominatim: { icon: Search, label: "Nominatim (OSM)" },
  viacep: { icon: MapPin, label: "ViaCEP" },
  postgis: { icon: Database, label: "PostGIS" },
}

const PERCENTILE_CONFIG = {
  p50: { label: "P50", color: "hsl(160, 84%, 39%)" },
  p95: { label: "P95", color: "hsl(38, 92%, 50%)" },
  p99: { label: "P99", color: "hsl(0, 72%, 51%)" },
} as const

type PercentileKey = keyof typeof PERCENTILE_CONFIG

const DAY_PRESETS = [
  { value: 7, label: "7 dias" },
  { value: 14, label: "14 dias" },
  { value: 30, label: "30 dias" },
  { value: 90, label: "90 dias" },
  { value: 0, label: "Todos" },
] as const

// ---------------------------------------------------------------------------
// Chart tooltip style
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a timestamp (ms) to a readable date string. */
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  })
}

/** Format milliseconds for display. */
function fmtMs(ms: number): string {
  if (ms < 1) return "< 1ms"
  return `${Math.round(ms)}ms`
}

/** Build chart data rows from TimeBucket array — one row per bucket. */
function buildChartData(
  buckets: TimeBucket[],
  service: GeoServiceName,
  percentile: PercentileKey,
): Array<{ date: string; ts: number; value: number }> {
  return buckets
    .filter((b) => b.services[service] != null)
    .map((b) => ({
      date: fmtDate(b.timestamp),
      ts: b.timestamp,
      value: Math.round(b.services[service]![percentile]),
    }))
}

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------

function GeoSkeleton() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {/* KPI skeletons */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card border-border/50 rounded-xl border p-4">
            <Skeleton className="mb-2 h-3 w-20" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="mt-1 h-3 w-24" />
          </div>
        ))}
      </div>

      {/* Chart skeletons */}
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="bg-card border-border/50 rounded-xl border p-5">
          <Skeleton className="mb-4 h-5 w-48" />
          <Skeleton className="h-[260px] w-full rounded-lg" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({
  icon: Icon,
  label,
  value,
  subtitle,
}: {
  icon: React.ElementType
  label: string
  value: string
  subtitle?: string
}) {
  return (
    <div className="bg-card border-border/50 flex items-start gap-3 rounded-xl border p-4">
      <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
        <Icon className="text-muted-foreground size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
          {label}
        </p>
        <p className="text-foreground mt-0.5 text-lg font-bold tabular-nums">{value}</p>
        {subtitle && (
          <p className="text-muted-foreground mt-0.5 truncate text-[11px]">{subtitle}</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Metric Card
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AdminGeoSnapshotsChart() {
  const [days, setDays] = React.useState(30)

  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "geo-snapshots-summary", days],
    queryFn: () =>
      apiGet<SnapshotsSummaryResponse>(
        `/api/admin/geo-snapshots-summary${days > 0 ? `?days=${days}` : ""}`,
      ),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  // ── Error state ──────────────────────────────────────────────────
  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o resumo de snapshots geo"
        description="Verifique se você está autenticado como administrador."
        onRetry={() => void refetch()}
      />
    )
  }

  // ── Loading state ────────────────────────────────────────────────
  if (isLoading || !data) {
    return <GeoSkeleton />
  }

  const { daily, weekly, totals } = data

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <DashboardHeader
        title="Evolução Temporal - Snapshots Geo"
        description="Médias diárias e semanais de P50/P95/P99 dos serviços de geolocalização"
        isFetching={isFetching}
        onRefresh={() => void refetch()}
        dataUpdatedAt={dataUpdatedAt}
        refreshLabel="Atualizar"
        prefixContent={
          <div className="bg-muted/50 inline-flex items-center gap-1 rounded-lg border p-0.5">
            {DAY_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setDays(p.value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-all",
                  days === p.value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <section aria-label="Resumo dos snapshots" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={History}
          label="Snapshots"
          value={totals.totalSnapshots.toLocaleString("pt-BR")}
          subtitle="Arquivos no disco"
        />
        <KpiCard
          icon={CalendarDays}
          label="Buckets Diários"
          value={String(totals.dailyBuckets)}
          subtitle={`${daily.length > 0 ? fmtDate(daily[0]!.timestamp) : "—"} → ${daily.length > 0 ? fmtDate(daily[daily.length - 1]!.timestamp) : "—"}`}
        />
        <KpiCard
          icon={BarChart3}
          label="Buckets Semanais"
          value={String(totals.weeklyBuckets)}
          subtitle={`${weekly.length} semanas`}
        />
        <KpiCard
          icon={Activity}
          label="Serviços"
          value={String(SERVICES.length)}
          subtitle="Nominatim · ViaCEP · PostGIS"
        />
      </section>

      {/* ── Daily Charts (one per service) ────────────────────────── */}
      <section aria-label="Evolução diária" className="space-y-6">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-5 text-sky-500" />
          <h2 className="text-foreground text-lg font-semibold">Médias Diárias</h2>
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium">
            {daily.length} buckets
          </span>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {SERVICES.map((svc) => {
            const config = SERVICE_CONFIG[svc]
            const Icon = config.icon
            const hasData = daily.some((b) => b.services[svc] != null)
            if (!hasData) return null

            // Merge all three percentile datasets into one array with explicit keys
            const p50Data = buildChartData(daily, svc, "p50")
            const p95Data = buildChartData(daily, svc, "p95")
            const p99Data = buildChartData(daily, svc, "p99")

            const mergedData = p95Data.map((row, i) => ({
              date: row.date,
              ts: row.ts,
              p50: p50Data[i]?.value ?? 0,
              p95: p95Data[i]?.value ?? 0,
              p99: p99Data[i]?.value ?? 0,
            }))

            return (
              <MetricCard key={svc} icon={Icon} title={`${config.label} — P50/P95/P99 (ms)`}>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={mergedData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                      <defs>
                        {(["p50", "p95", "p99"] as const).map((pk) => (
                          <linearGradient
                            key={pk}
                            id={`grad-${svc}-${pk}`}
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor={PERCENTILE_CONFIG[pk].color}
                              stopOpacity={0.2}
                            />
                            <stop
                              offset="95%"
                              stopColor={PERCENTILE_CONFIG[pk].color}
                              stopOpacity={0.02}
                            />
                          </linearGradient>
                        ))}
                      </defs>

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
                          value: "ms",
                          angle: -90,
                          position: "insideLeft",
                          style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                        }}
                      />
                      <RTooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(v: number, n: string) => [
                          `${Math.round(v)}ms`,
                          n === "p50" ? "P50" : n === "p95" ? "P95" : "P99",
                        ]}
                      />
                      <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                      <Area
                        type="monotone"
                        dataKey="p50"
                        name="P50"
                        stroke={PERCENTILE_CONFIG.p50.color}
                        strokeWidth={2}
                        fill={`url(#grad-${svc}-p50)`}
                        dot={false}
                        activeDot={{ r: 4 }}
                        connectNulls
                      />
                      <Area
                        type="monotone"
                        dataKey="p95"
                        name="P95"
                        stroke={PERCENTILE_CONFIG.p95.color}
                        strokeWidth={2}
                        fill={`url(#grad-${svc}-p95)`}
                        dot={false}
                        activeDot={{ r: 4 }}
                        connectNulls
                      />
                      <Area
                        type="monotone"
                        dataKey="p99"
                        name="P99"
                        stroke={PERCENTILE_CONFIG.p99.color}
                        strokeWidth={2}
                        fill={`url(#grad-${svc}-p99)`}
                        dot={false}
                        activeDot={{ r: 4 }}
                        connectNulls
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Latest values summary */}
                {mergedData.length > 0 && (
                  <div className="text-muted-foreground mt-3 flex items-center gap-4 border-t pt-3 text-[10px]">
                    <span className="flex items-center gap-1">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: PERCENTILE_CONFIG.p50.color }}
                      />
                      P50: {fmtMs(mergedData[mergedData.length - 1]!.p50)}
                    </span>
                    <span className="flex items-center gap-1">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: PERCENTILE_CONFIG.p95.color }}
                      />
                      P95: {fmtMs(mergedData[mergedData.length - 1]!.p95)}
                    </span>
                    <span className="flex items-center gap-1">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: PERCENTILE_CONFIG.p99.color }}
                      />
                      P99: {fmtMs(mergedData[mergedData.length - 1]!.p99)}
                    </span>
                  </div>
                )}
              </MetricCard>
            )
          })}
        </div>
      </section>

      {/* ── Weekly Charts ──────────────────────────────────────────── */}
      {weekly.length > 0 && (
        <section aria-label="Evolução semanal" className="space-y-6">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-5 text-violet-500" />
            <h2 className="text-foreground text-lg font-semibold">Médias Semanais</h2>
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium">
              {weekly.length} semanas
            </span>
          </div>

          <div className="grid grid-cols-1 gap-6">
            {SERVICES.map((svc) => {
              const config = SERVICE_CONFIG[svc]
              const Icon = config.icon
              const hasWeekly = weekly.some((b) => b.services[svc] != null)
              if (!hasWeekly) return null

              const wP50 = buildChartData(weekly, svc, "p50")
              const wP95 = buildChartData(weekly, svc, "p95")
              const wP99 = buildChartData(weekly, svc, "p99")

              const mergedWeekly = wP95.map((row, i) => ({
                date: row.date,
                ts: row.ts,
                p50: wP50[i]?.value ?? 0,
                p95: wP95[i]?.value ?? 0,
                p99: wP99[i]?.value ?? 0,
              }))

              return (
                <MetricCard key={svc} icon={Icon} title={`${config.label} — Semanal (ms)`}>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={mergedWeekly}
                        margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
                      >
                        <defs>
                          {(["p50", "p95", "p99"] as const).map((pk) => (
                            <linearGradient
                              key={pk}
                              id={`grad-week-${svc}-${pk}`}
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="5%"
                                stopColor={PERCENTILE_CONFIG[pk].color}
                                stopOpacity={0.2}
                              />
                              <stop
                                offset="95%"
                                stopColor={PERCENTILE_CONFIG[pk].color}
                                stopOpacity={0.02}
                              />
                            </linearGradient>
                          ))}
                        </defs>

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
                        />
                        <RTooltip
                          contentStyle={TOOLTIP_STYLE}
                          formatter={(v: number, n: string) => [
                            `${Math.round(v)}ms`,
                            n === "p50" ? "P50" : n === "p95" ? "P95" : "P99",
                          ]}
                        />
                        <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                        <Area
                          type="monotone"
                          dataKey="p50"
                          name="P50"
                          stroke={PERCENTILE_CONFIG.p50.color}
                          strokeWidth={2}
                          fill={`url(#grad-week-${svc}-p50)`}
                          dot={false}
                          activeDot={{ r: 4 }}
                          connectNulls
                        />
                        <Area
                          type="monotone"
                          dataKey="p95"
                          name="P95"
                          stroke={PERCENTILE_CONFIG.p95.color}
                          strokeWidth={2}
                          fill={`url(#grad-week-${svc}-p95)`}
                          dot={false}
                          activeDot={{ r: 4 }}
                          connectNulls
                        />
                        <Area
                          type="monotone"
                          dataKey="p99"
                          name="P99"
                          stroke={PERCENTILE_CONFIG.p99.color}
                          strokeWidth={2}
                          fill={`url(#grad-week-${svc}-p99)`}
                          dot={false}
                          activeDot={{ r: 4 }}
                          connectNulls
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </MetricCard>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Info note ──────────────────────────────────────────────── */}
      {daily.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800/30 dark:bg-amber-950/20 dark:text-amber-300">
          <p className="font-medium">📭 Nenhum snapshot encontrado</p>
          <p className="mt-1">
            Os snapshots são gerados automaticamente quando o servidor processa chamadas de
            geolocalização. Volte após algumas requisições para ver os primeiros dados.
          </p>
        </div>
      )}

      {daily.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-800/30 dark:bg-blue-950/20 dark:text-blue-300">
          <p className="font-medium">
            📊 Snapshots persistidos em disco — {totals.snapshotDir.replace(process.cwd(), "")}
          </p>
          <p className="mt-1">
            Os snapshots são gerados a cada 30s (janela deslizante de 15 min) e persistidos em
            arquivos JSON. O cache Redis evita IO repetitivo nas consultas da dashboard.
          </p>
        </div>
      )}
    </div>
  )
}
