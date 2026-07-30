"use client"

/**
 * AdminGeoCacheDashboard — Redis Geo Cache Diagnostics
 *
 * Exibe métricas em tempo real do cache Redis de geolocalização:
 *   - Hit/miss ratio com gráfico donut
 *   - Top queries mais cacheadas (searches + CEPs)
 *   - Heatmap de uso por endpoint (Nominatim, ViaCEP, PostGIS)
 *   - TTL restante para chaves comuns do cache
 *   - Diagnóstico do in-memory store fallback
 *
 * Data source: GET /api/admin/geo-cache-diagnostics
 */

import * as React from "react"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  Globe,
  HardDrive,
  MapPin,
  Search,
  Server,
  Timer,
  TrendingDown,
  TrendingUp,
  List,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { apiGet } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { DashboardHeader } from "@/components/admin/admin-dashboard-header"
import { ErrorState } from "@/components/admin/admin-shared"

import type { GeoCacheDiagnosticsResponse } from "@/app/api/admin/geo-cache-diagnostics/route"
import { MetricCard } from "@/components/admin/admin-metric-card"

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

const COLORS = {
  hit: "hsl(160, 84%, 39%)",
  miss: "hsl(0, 72%, 51%)",
  nominatim: "hsl(210, 80%, 55%)",
  viacep: "hsl(280, 65%, 58%)",
  postgis: "hsl(35, 90%, 50%)",
  p50: "hsl(160, 84%, 39%)",
  p95: "hsl(38, 92%, 50%)",
  p99: "hsl(0, 72%, 51%)",
}

const SERVICE_ICONS: Record<string, React.ElementType> = {
  nominatim: Search,
  viacep: MapPin,
  postgis: Database,
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  return ms < 1 ? "<1ms" : `${Math.round(ms)}ms`
}

function formatSeconds(sec: number | null): string {
  if (sec == null) return "—"
  if (sec > 86400) return `${Math.round(sec / 86400)}d`
  if (sec > 3600) return `${Math.round(sec / 3600)}h`
  if (sec > 60) return `${Math.round(sec / 60)}min`
  return `${sec}s`
}

function formatCount(n: number): string {
  return n.toLocaleString("pt-BR")
}

// ── Main component ───────────────────────────────────────────────────────

export function AdminGeoCacheDashboard() {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "geo-cache-diagnostics"],
    queryFn: () => apiGet<GeoCacheDiagnosticsResponse>("/api/admin/geo-cache-diagnostics"),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar diagnóstico do cache geo"
        description="Verifique se você está autenticado como administrador e se o servidor está rodando."
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return <CacheDiagnosticsSkeleton />
  }

  const {
    cacheStats,
    memoryDiag,
    queryLogDiag,
    warmConfig,
    topSearches,
    topCEPs,
    keyTTLs,
    heatmap,
    geoMetrics,
  } = data

  // Hit ratio data for donut chart
  const hitRatioData = [
    { name: "Hits", value: cacheStats.hits, color: COLORS.hit },
    { name: "Misses", value: cacheStats.misses, color: COLORS.miss },
  ].filter((d) => d.value > 0)

  const hitRatioPct =
    cacheStats.total > 0 ? ((cacheStats.hits / cacheStats.total) * 100).toFixed(1) : "—"

  // Total geo calls from the metrics window
  const totalCalls = Object.values(geoMetrics.services).reduce((a, s) => a + s.count, 0)

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <DashboardHeader
        title="Diagnóstico do Cache Geo"
        description="Hit/miss ratio, queries mais frequentes, e heatmap de uso do Redis"
        isFetching={isFetching}
        onRefresh={() => void refetch()}
        dataUpdatedAt={dataUpdatedAt}
        refreshLabel="Atualizar diagnóstico"
        prefixContent={
          cacheStats.redisAvailable === true ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              <CheckCircle2 className="size-3" />
              Redis
            </span>
          ) : cacheStats.redisAvailable === false ? (
            <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
              <AlertTriangle className="size-3" />
              Redis offline
            </span>
          ) : (
            <span className="bg-muted text-muted-foreground flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
              <Timer className="size-3" />
              Redis não testado
            </span>
          )
        }
      />

      {/* ── KPI Cards ───────────────────────────────────────────────── */}
      <section aria-label="KPIs do cache" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={Activity}
          label="Hit Ratio"
          value={hitRatioPct !== "—" ? `${hitRatioPct}%` : "—"}
          subtitle={`${formatCount(cacheStats.total)} total`}
          trend={
            cacheStats.total > 0
              ? cacheStats.hitRatio != null && cacheStats.hitRatio > 0.7
                ? "down"
                : "up"
              : undefined
          }
        />
        <KpiCard
          icon={Database}
          label="Chamadas (janela)"
          value={formatCount(totalCalls)}
          subtitle={`Últimos ${geoMetrics.windowSeconds / 60} min`}
          trend={totalCalls > 0 ? "up" : "down"}
        />
        <KpiCard
          icon={HardDrive}
          label="Cache em Memória"
          value={formatCount(memoryDiag.size)}
          subtitle={
            memoryDiag.maxAgeMs != null
              ? `Max TTL: ${formatSeconds(Math.round(memoryDiag.maxAgeMs / 1000))}`
              : "Sem TTL"
          }
        />
        <KpiCard
          icon={List}
          label="Queries Únicas no Log"
          value={formatCount(
            queryLogDiag.uniqueSearches + queryLogDiag.uniqueCEPs + queryLogDiag.uniqueReverses,
          )}
          subtitle={`${formatCount(queryLogDiag.totalSearches)} buscas totais`}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Hit/Miss Donut Chart ──────────────────────────────────── */}
        <MetricCard icon={BarChart3} title="Hit / Miss Ratio">
          <div className="flex items-center gap-6">
            <div className="h-[180px] w-[180px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={hitRatioData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {hitRatioData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} strokeWidth={0} />
                    ))}
                  </Pie>
                  <RTooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number, n: string) => [formatCount(v), n]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="size-3 rounded-sm" style={{ backgroundColor: COLORS.hit }} />
                <span className="text-muted-foreground text-xs">Hits</span>
                <span className="ml-auto text-xs font-medium tabular-nums">
                  {formatCount(cacheStats.hits)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="size-3 rounded-sm" style={{ backgroundColor: COLORS.miss }} />
                <span className="text-muted-foreground text-xs">Misses</span>
                <span className="ml-auto text-xs font-medium tabular-nums">
                  {formatCount(cacheStats.misses)}
                </span>
              </div>
              {cacheStats.total > 0 && (
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Redis disponível</span>
                    <span
                      className={cn(
                        "font-medium",
                        cacheStats.redisAvailable === true
                          ? "text-emerald-500"
                          : cacheStats.redisAvailable === false
                            ? "text-red-500"
                            : "text-muted-foreground",
                      )}
                    >
                      {cacheStats.redisAvailable === true
                        ? "Sim"
                        : cacheStats.redisAvailable === false
                          ? "Não"
                          : "Não testado"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Itens no cache</span>
                    <span className="font-medium tabular-nums">
                      {formatCount(cacheStats.memoryStoreSize)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </MetricCard>

        {/* ── Endpoint Heatmap ──────────────────────────────────────── */}
        <MetricCard icon={Globe} title="Uso por Endpoint (janela atual)">
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={heatmap}
                layout="vertical"
                margin={{ left: 80, right: 16, top: 8, bottom: 8 }}
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
                  tickFormatter={(v: number) => formatCount(v)}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  width={80}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, n: string) => [
                    formatCount(v),
                    n === "calls" ? "Chamadas" : "Erros",
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                <Bar dataKey="calls" name="Chamadas" radius={[0, 3, 3, 0]} barSize={16}>
                  {heatmap.map((entry) => (
                    <Cell
                      key={entry.service}
                      fill={COLORS[entry.service as keyof typeof COLORS] ?? COLORS.nominatim}
                    />
                  ))}
                </Bar>
                <Bar
                  dataKey="errors"
                  name="Erros"
                  radius={[0, 3, 3, 0]}
                  barSize={16}
                  fill={COLORS.miss}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>
      </div>

      {/* ── Top Queries ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Searches */}
        <MetricCard icon={Search} title="Top 10 Buscas (Nominatim)">
          {topSearches.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-xs">
              Nenhuma busca registrada ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {topSearches.map((s, i) => (
                <div
                  key={s.query}
                  className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                >
                  <span className="text-muted-foreground w-5 text-center text-xs font-medium">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate text-xs">{s.query}</span>
                  <span className="text-xs font-medium tabular-nums">{formatCount(s.count)}</span>
                  <span className="text-muted-foreground text-[10px]">chamadas</span>
                </div>
              ))}
            </div>
          )}
        </MetricCard>

        {/* Top CEPs */}
        <MetricCard icon={MapPin} title="Top 10 CEPs (ViaCEP)">
          {topCEPs.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-xs">
              Nenhum CEP registrado ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {topCEPs.map((c, i) => (
                <div
                  key={c.cep}
                  className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                >
                  <span className="text-muted-foreground w-5 text-center text-xs font-medium">
                    {i + 1}
                  </span>
                  <span className="flex-1 font-mono text-xs">{c.cep}</span>
                  <span className="text-xs font-medium tabular-nums">{formatCount(c.count)}</span>
                  <span className="text-muted-foreground text-[10px]">chamadas</span>
                </div>
              ))}
            </div>
          )}
        </MetricCard>
      </div>

      {/* ── Cache Keys TTL ──────────────────────────────────────────── */}
      {keyTTLs.length > 0 && (
        <MetricCard icon={Timer} title="TTL de Chaves Comuns no Redis">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="pr-4 pb-2 font-medium">Chave</th>
                  <th className="pr-4 pb-2 text-right font-medium">TTL</th>
                  <th className="pb-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {keyTTLs.map((entry) => (
                  <tr key={entry.key} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-[11px]">
                      {entry.key.length > 48 ? `${entry.key.slice(0, 48)}…` : entry.key}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {entry.ttlSeconds != null
                        ? formatSeconds(entry.ttlSeconds)
                        : "Expirada / ausente"}
                    </td>
                    <td className="py-2 text-right">
                      {entry.ttlSeconds != null && entry.ttlSeconds > 0 ? (
                        <span className="font-medium text-emerald-500">Cacheado</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MetricCard>
      )}

      {/* ── Service Detail Cards ────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {heatmap.map((entry) => {
          const Icon = SERVICE_ICONS[entry.service] ?? Globe
          return (
            <div
              key={entry.service}
              className="border-border/50 bg-card hover:border-primary/20 rounded-xl border transition-colors"
            >
              <div className="flex items-center gap-3 border-b px-5 py-4">
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg",
                    entry.errorRate < 0.05
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-sm font-semibold">{entry.label}</p>
                  <p className="text-muted-foreground text-[11px]">
                    {formatCount(entry.calls)} chamadas
                  </p>
                </div>
              </div>
              <div className="space-y-3 p-4">
                <LatencyBar label="P50" value={entry.p50} max={Math.max(entry.p99, 1)} />
                <LatencyBar label="P95" value={entry.p95} max={Math.max(entry.p99, 1)} />
                <LatencyBar label="P99" value={entry.p99} max={Math.max(entry.p99, 1)} />
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Erros</span>
                    <span
                      className={cn(
                        "font-medium tabular-nums",
                        entry.errorRate > 0.05
                          ? "text-red-500"
                          : entry.errorRate > 0.01
                            ? "text-amber-500"
                            : "text-emerald-500",
                      )}
                    >
                      {formatCount(entry.errors)}{" "}
                      <span className="text-muted-foreground text-[10px]">
                        ({(entry.errorRate * 100).toFixed(1)}%)
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </section>

      {/* ── Configuration ───────────────────────────────────────────── */}
      <MetricCard icon={Server} title="Configuração do Cache Warming">
        <div className="grid grid-cols-2 gap-6 text-xs lg:grid-cols-4">
          <div>
            <p className="text-muted-foreground font-medium">Cidades no warm</p>
            <p className="mt-1 font-bold tabular-nums">{warmConfig.cities}</p>
          </div>
          <div>
            <p className="text-muted-foreground font-medium">CEPs no warm</p>
            <p className="mt-1 font-bold tabular-nums">{warmConfig.ceps}</p>
          </div>
          <div>
            <p className="text-muted-foreground font-medium">Coordenadas no warm</p>
            <p className="mt-1 font-bold tabular-nums">{warmConfig.coords}</p>
          </div>
          <div>
            <p className="text-muted-foreground font-medium">Total de queries</p>
            <p className="mt-1 font-bold tabular-nums">{warmConfig.totalQueries}</p>
          </div>
        </div>
      </MetricCard>

      {/* ── Info note ────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-800/30 dark:bg-blue-950/20 dark:text-blue-300">
        <p className="font-medium">📊 Dados coletados em tempo real</p>
        <p className="mt-1">
          Hit/miss ratio acumula desde o último restart. O heatmap de endpoint reflete a janela
          deslizante de {geoMetrics.windowSeconds / 60} minutos. O log de queries frequentes é
          persistido em disco e sobrevive a restarts.
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

function LatencyBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const color = value > 1000 ? COLORS.p99 : value > 200 ? COLORS.p95 : COLORS.p50
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground w-8 text-right text-xs font-medium">{label}</span>
      <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            backgroundColor: color,
          }}
        />
      </div>
      <span className="w-14 text-right text-xs font-medium tabular-nums" style={{ color }}>
        {formatMs(value)}
      </span>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function CacheDiagnosticsSkeleton() {
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
              <Skeleton className="h-[200px] w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default AdminGeoCacheDashboard
