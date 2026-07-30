"use client"

/**
 * AdminRedisDiagnosticsDashboard — Redis diagnostics panel
 *
 * Exibe informações do Redis:
 *   - Hit/miss ratio com gráfico donut (reusa o mesmo padrão do cache dashboard)
 *   - Cluster mode vs standalone
 *   - Lista de nós do cluster (host:port, key count, sample keys)
 *   - Distribuição de slots entre nós
 *   - Top keys por nó / amostra de chaves
 *
 * Data source: GET /api/admin/redis-diagnostics
 */

import * as React from "react"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  HardDrive,
  List,
  Map as MapIcon,
  Minus,
  Server,
  Timer,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { MetricCard } from "@/components/admin/admin-metric-card"

import type { RedisDiagnosticsResponse } from "@/app/api/admin/redis-diagnostics/route"

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
  node: "hsl(210, 80%, 55%)",
  slot: "hsl(280, 65%, 58%)",
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatCount(n: number): string {
  return n.toLocaleString("pt-BR")
}

function formatSlotRange(start: number, end: number): string {
  return `${start} – ${end}`
}

function slotCoverage(slots: Array<{ start: number; end: number }>): string {
  if (slots.length === 0) return "—"
  const total = slots.reduce((acc, s) => acc + (s.end - s.start + 1), 0)
  return `${((total / 16384) * 100).toFixed(1)}%`
}

const NODE_PALETTE = [
  "hsl(210, 80%, 55%)",
  "hsl(160, 84%, 39%)",
  "hsl(280, 65%, 58%)",
  "hsl(35, 90%, 50%)",
  "hsl(0, 72%, 51%)",
  "hsl(190, 70%, 45%)",
]

// ── Main component ───────────────────────────────────────────────────────

export function AdminRedisDiagnosticsDashboard() {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "redis-diagnostics"],
    queryFn: () => apiGet<RedisDiagnosticsResponse>("/api/admin/redis-diagnostics"),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar diagnóstico do Redis"
        description="Verifique se você está autenticado como administrador e se o servidor está rodando."
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return <RedisDiagnosticsSkeleton />
  }

  const {
    clusterMode,
    clusterNodes,
    slotDistribution,
    standalone,
    hitRatio,
    hits,
    misses,
    memoryStoreSize,
    available,
    activeTier,
    degradationCount,
  } = data

  // Hit ratio data for donut chart
  const hitRatioData = [
    { name: "Hits", value: hits, color: COLORS.hit },
    { name: "Misses", value: misses, color: COLORS.miss },
  ].filter((d) => d.value > 0)

  const hitRatioPct = hitRatio != null ? `${(hitRatio * 100).toFixed(1)}%` : "—"

  // Total key count across all cluster nodes
  const totalClusterKeys = clusterNodes.reduce((a, n) => a + n.dbSize, 0)

  // Slot distribution data for chart
  const slotChartData = slotDistribution.map((s, i) => ({
    name: `${s.node.host}:${s.node.port}`,
    slots: s.end - s.start + 1,
    range: formatSlotRange(s.start, s.end),
    fill: NODE_PALETTE[i % NODE_PALETTE.length],
  }))

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <DashboardHeader
        title="Diagnóstico do Redis"
        description={`${clusterMode ? "Cluster Mode" : "Standalone"} — ${clusterMode ? `${clusterNodes.length} nós` : "instância única"}`}
        isFetching={isFetching}
        onRefresh={() => void refetch()}
        dataUpdatedAt={dataUpdatedAt}
        refreshLabel="Atualizar diagnóstico"
        prefixContent={
          available ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              <CheckCircle2 className="size-3" />
              Online
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
              <AlertTriangle className="size-3" />
              Offline
            </span>
          )
        }
      />

      {/* ── Active Tier Banner ───────────────────────────────────── */}
      {activeTier !== "cluster" && (
        <div
          className={cn(
            "rounded-xl border px-5 py-3 text-xs",
            activeTier === "standalone"
              ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/30 dark:bg-amber-950/20 dark:text-amber-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800/30 dark:bg-red-950/20 dark:text-red-300",
          )}
        >
          <span className="font-semibold">
            {activeTier === "standalone" ? "⚠️ Modo degradado" : "🔴 Cache apenas em memória"}
          </span>
          <span className="ml-2">
            {activeTier === "standalone"
              ? `O cluster falhou e o Redis está rodando em modo standalone.`
              : `O Redis está indisponível — o cache está sendo mantido apenas em memória.`}
            {degradationCount > 0 && (
              <span className="ml-1">
                ({degradationCount} degradação{degradationCount !== 1 ? "ões" : ""} desde o início).
              </span>
            )}
          </span>
        </div>
      )}

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <section aria-label="KPIs do Redis" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={Activity}
          label="Hit Ratio"
          value={hitRatioPct}
          subtitle={`${formatCount(hits + misses)} total`}
          trend={
            hits + misses > 0 ? (hitRatio != null && hitRatio > 0.7 ? "up" : "down") : undefined
          }
        />
        <KpiCard
          icon={Database}
          label="Chaves no Redis"
          value={formatCount(clusterMode ? totalClusterKeys : (standalone?.dbSize ?? 0))}
          subtitle={clusterMode ? `Em ${clusterNodes.length} nós` : "Instância única"}
        />
        <KpiCard
          icon={HardDrive}
          label="Cache em Memória"
          value={formatCount(memoryStoreSize)}
          subtitle="Fallback in-memory"
        />
        <KpiCard
          icon={Server}
          label={clusterMode ? "Nós do Cluster" : "Modo"}
          value={clusterMode ? String(clusterNodes.length) : "Standalone"}
          subtitle={
            clusterMode ? `${clusterNodes.filter((n) => n.reachable).length} reachable` : undefined
          }
        />
      </section>

      {/* ── Hit/Miss Donut ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
                  {formatCount(hits)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="size-3 rounded-sm" style={{ backgroundColor: COLORS.miss }} />
                <span className="text-muted-foreground text-xs">Misses</span>
                <span className="ml-auto text-xs font-medium tabular-nums">
                  {formatCount(misses)}
                </span>
              </div>
              {hits + misses > 0 && (
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Redis disponível</span>
                    <span
                      className={cn("font-medium", available ? "text-emerald-500" : "text-red-500")}
                    >
                      {available ? "Sim" : "Não"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Modo</span>
                    <span className="font-medium">{clusterMode ? "Cluster" : "Standalone"}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </MetricCard>

        {/* ── Node Slot Distribution (Cluster Mode) ─────────────────── */}
        {clusterMode && slotChartData.length > 0 && (
          <MetricCard icon={MapIcon} title="Distribuição de Slots por Nó">
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={slotChartData}
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
                    domain={[0, 16384]}
                    tickFormatter={(v: number) => formatCount(v)}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    width={100}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <RTooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(
                      _v: number,
                      _n: string,
                      entry: { payload?: Record<string, unknown> },
                    ) => {
                      const p = (entry?.payload ?? {}) as { slots?: number; range?: string }
                      return [`${formatCount(p.slots ?? 0)} slots (${p.range ?? "—"})`, "Slots"]
                    }}
                  />
                  <Bar dataKey="slots" name="Slots" radius={[0, 3, 3, 0]} barSize={20}>
                    {slotChartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} strokeWidth={0} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              Cobertura total: {slotCoverage(slotDistribution)} dos 16384 slots
            </p>
          </MetricCard>
        )}

        {/* ── Standalone Info ───────────────────────────────────────── */}
        {!clusterMode && standalone && (
          <MetricCard icon={Database} title="Info da Instância">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b pb-2 text-xs">
                <span className="text-muted-foreground font-medium">Chaves totais</span>
                <span className="font-bold tabular-nums">{formatCount(standalone.dbSize)}</span>
              </div>
              <div className="flex items-center justify-between border-b pb-2 text-xs">
                <span className="text-muted-foreground font-medium">Cache em memória</span>
                <span className="font-bold tabular-nums">{formatCount(memoryStoreSize)}</span>
              </div>
              <div className="flex items-center justify-between border-b pb-2 text-xs">
                <span className="text-muted-foreground font-medium">Hit ratio</span>
                <span className="font-bold tabular-nums">{hitRatioPct}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-medium">Status</span>
                <span className={cn("font-bold", available ? "text-emerald-500" : "text-red-500")}>
                  {available ? "Online" : "Offline"}
                </span>
              </div>
            </div>
          </MetricCard>
        )}
      </div>

      {/* ── Cluster Nodes Table ─────────────────────────────────────── */}
      {clusterMode && clusterNodes.length > 0 && (
        <MetricCard icon={Server} title="Nós do Cluster">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="pr-4 pb-2 font-medium">Nó</th>
                  <th className="pr-4 pb-2 text-right font-medium">Chaves</th>
                  <th className="pr-4 pb-2 text-center font-medium">Status</th>
                  <th className="pb-2 font-medium">Amostra de Chaves</th>
                </tr>
              </thead>
              <tbody>
                {clusterNodes.map((node) => (
                  <tr key={`${node.host}:${node.port}`} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 font-mono text-[11px]">
                      {node.host}:{node.port}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">
                      {formatCount(node.dbSize)}
                    </td>
                    <td className="py-2.5 pr-4 text-center">
                      {node.reachable ? (
                        <span className="inline-flex items-center gap-1 text-emerald-500">
                          <CheckCircle2 className="size-3" />
                          <span className="text-[10px]">OK</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-500">
                          <Minus className="size-3" />
                          <span className="text-[10px]">Offline</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {node.sampleKeys.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          node.sampleKeys.map((key) => (
                            <span
                              key={key}
                              className="bg-muted rounded-md px-2 py-0.5 font-mono text-[10px]"
                              title={key}
                            >
                              {key.length > 32 ? `${key.slice(0, 32)}…` : key}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground mt-3 text-[10px]">
            Amostra de até 20 chaves por nó via SCAN. Chaves totais: {formatCount(totalClusterKeys)}{" "}
            em {clusterNodes.length} nós.
          </p>
        </MetricCard>
      )}

      {/* ── Sample Keys (Standalone) ────────────────────────────────── */}
      {!clusterMode && standalone && standalone.sampleKeys.length > 0 && (
        <MetricCard icon={List} title="Amostra de Chaves (KEYS *)">
          <div className="flex flex-wrap gap-1.5">
            {standalone.sampleKeys.map((key) => (
              <span
                key={key}
                className="bg-muted hover:bg-muted/80 rounded-md px-2.5 py-1 font-mono text-[10px] transition-colors"
                title={key}
              >
                {key.length > 48 ? `${key.slice(0, 48)}…` : key}
              </span>
            ))}
          </div>
          <p className="text-muted-foreground mt-3 text-[10px]">
            Amostra de até 100 chaves via KEYS (primeiras 100 de {formatCount(standalone.dbSize)}).
          </p>
        </MetricCard>
      )}

      {/* ── Slot Distribution Detail (Cluster Mode) ─────────────────── */}
      {clusterMode && slotDistribution.length > 0 && (
        <MetricCard icon={MapIcon} title="Distribuição de Slots — Detalhado">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {slotDistribution.map((slot, i) => {
              const slotCount = slot.end - slot.start + 1
              const pct = ((slotCount / 16384) * 100).toFixed(1)
              return (
                <div
                  key={`${slot.node.host}:${slot.node.port}-${slot.start}`}
                  className="border-border/50 hover:bg-muted/30 rounded-lg border p-4 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="size-3 rounded-sm"
                      style={{ backgroundColor: NODE_PALETTE[i % NODE_PALETTE.length] }}
                    />
                    <span className="text-xs font-semibold">
                      {slot.node.host}:{slot.node.port}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Range</span>
                      <span className="font-mono tabular-nums">
                        {formatSlotRange(slot.start, slot.end)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Slots</span>
                      <span className="font-medium tabular-nums">{formatCount(slotCount)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Cobertura</span>
                      <span className="font-medium tabular-nums">{pct}%</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </MetricCard>
      )}

      {/* ── Info note ───────────────────────────────────────────────── */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-800/30 dark:bg-blue-950/20 dark:text-blue-300">
        <p className="font-medium">🔍 Diagnóstico em tempo real</p>
        <p className="mt-1">
          Hit/miss ratio acumula desde o último restart do servidor.
          {clusterMode
            ? " Os dados de slot distribution e chaves por nó são coletados via CLUSTER SLOTS e SCAN em cada nó master."
            : " A amostra de chaves é coletada via KEYS (limitado a 100 chaves para segurança)."}
          Dados atualizados a cada 30s.
        </p>
      </div>
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────

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
            <TrendingUp className="size-4 text-emerald-500" />
          ) : (
            <TrendingDown className="size-4 text-red-500" />
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

// ── Skeleton ──────────────────────────────────────────────────────────────

function RedisDiagnosticsSkeleton() {
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

export default AdminRedisDiagnosticsDashboard
