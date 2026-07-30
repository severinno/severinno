"use client"

/**
 * AdminGeoRateLimitStatus — Rate limit diagnostics dashboard
 *
 * Exibe o estado atual do rate limiter de geolocalização:
 *   - Configuração por endpoint (max req/min)
 *   - IPs mais ativos por endpoint (top 5)
 *   - Allow/Block ratio com contadores acumulados
 *   - Total de IPs trackeados
 *
 * Data source: GET /api/admin/geo-rate-limit-status
 */

import * as React from "react"
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Globe,
  Network,
  Search,
  Shield,
  Timer,
  Wifi,
  WifiOff,
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
import { MetricCard, KpiCard } from "@/components/admin/admin-metric-card"

import type { RateLimitStatusResponse } from "@/app/api/admin/geo-rate-limit-status/route"

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
  search: "hsl(210, 80%, 55%)",
  cep: "hsl(160, 84%, 39%)",
  reverse: "hsl(280, 65%, 58%)",
}

const ENDPOINT_LABELS: Record<string, string> = {
  search: "Nominatim Search",
  cep: "ViaCEP",
  reverse: "Nominatim Reverse",
}

const ENDPOINT_ICONS: Record<string, React.ElementType> = {
  search: Globe,
  cep: Search,
  reverse: Network,
}

// ── Format helpers ────────────────────────────────────────────────────────

function formatCount(n: number): string {
  return n.toLocaleString("pt-BR")
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 5) return "agora"
  if (seconds < 60) return `${seconds}s atrás`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min atrás`
  return `${Math.floor(minutes / 60)}h atrás`
}

// ── Main component ───────────────────────────────────────────────────────

export function AdminGeoRateLimitStatus() {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "geo-rate-limit-status"],
    queryFn: () => apiGet<RateLimitStatusResponse>("/api/admin/geo-rate-limit-status"),
    staleTime: 10_000,
    refetchInterval: 15_000,
  })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar status do rate limiter"
        description="Verifique se você está autenticado como administrador."
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return <RateLimitSkeleton />
  }

  const {
    config,
    redisAvailable,
    totalTrackedIPs,
    endpoints,
    memoryStoreSize,
    counters,
    timestamp,
  } = data

  // Total allowed requests per minute across all endpoints
  const totalCapacity = Object.values(config).reduce((a, c) => a + c.max, 0)

  // Compute usage ratio (active IPs vs capacity)
  const usageRatio = totalTrackedIPs / totalCapacity

  // Per-endpoint tracked IPs for bar chart
  const endpointTrackedData = Object.entries(endpoints).map(([ep, ed]) => ({
    name: ENDPOINT_LABELS[ep] ?? ep,
    tracked: ed.trackedIPs,
    max: ed.config.max,
    fill: COLORS[ep as keyof typeof COLORS] ?? "hsl(0, 0%, 50%)",
  }))

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <DashboardHeader
        title="Status do Rate Limiter Geo"
        description={`${totalTrackedIPs} IPs trackeados em ${Object.keys(endpoints).length} endpoints`}
        isFetching={isFetching}
        onRefresh={() => void refetch()}
        dataUpdatedAt={dataUpdatedAt}
        refreshLabel="Atualizar"
        prefixContent={
          redisAvailable ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              <Wifi className="size-3" />
              Redis ativo
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              <WifiOff className="size-3" />
              Apenas memória
            </span>
          )
        }
      />

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <section aria-label="KPIs do Rate Limiter" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={Shield}
          label="Capacidade Total"
          value={formatCount(totalCapacity)}
          subtitle="req/min (todos os endpoints)"
        />
        <KpiCard
          icon={Activity}
          label="IPs Trackeados"
          value={formatCount(totalTrackedIPs)}
          subtitle={redisAvailable ? "Redis + in-memory" : "Apenas in-memory"}
          trend={usageRatio > 0.5 ? "up" : usageRatio < 0.1 ? "down" : undefined}
        />
        <KpiCard
          icon={Ban}
          label="Capacidade Restante"
          value={formatCount(Math.max(0, totalCapacity - totalTrackedIPs))}
          subtitle={
            totalTrackedIPs > 0 ? `${(usageRatio * 100).toFixed(1)}% utilizado` : "Sem carga atual"
          }
        />
        <KpiCard icon={Timer} label="Janela Deslizante" value="60s" subtitle="Por endpoint + IP" />
      </section>

      {/* ── Allow/Block Ratio + Tracked IPs by Endpoint ────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Allow/Block Hit Ratio donut */}
        <MetricCard icon={Shield} title="Allow / Block Ratio">
          <div className="flex items-center gap-6">
            <div className="h-[160px] w-[160px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: "Allowed", value: counters.allowed, color: COLORS.cep },
                      { name: "Blocked", value: counters.blocked, color: COLORS.reverse },
                    ].filter((d) => d.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {(
                      [
                        counters.allowed > 0 && { name: "Allowed", color: COLORS.cep },
                        counters.blocked > 0 && { name: "Blocked", color: COLORS.reverse },
                      ].filter(Boolean) as Array<{ name: string; color: string }>
                    ).map((entry) => (
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
                <span className="size-3 rounded-sm" style={{ backgroundColor: COLORS.cep }} />
                <span className="text-muted-foreground text-xs">Allowed</span>
                <span className="ml-auto text-xs font-medium tabular-nums">
                  {formatCount(counters.allowed)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="size-3 rounded-sm" style={{ backgroundColor: COLORS.reverse }} />
                <span className="text-muted-foreground text-xs">Blocked (429)</span>
                <span className="ml-auto text-xs font-medium tabular-nums">
                  {formatCount(counters.blocked)}
                </span>
              </div>
              {counters.total > 0 && (
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Block ratio</span>
                    <span
                      className={cn(
                        "font-medium",
                        counters.blockRatio != null && counters.blockRatio > 0.1
                          ? "text-red-500"
                          : "text-emerald-500",
                      )}
                    >
                      {counters.blockRatio != null
                        ? `${(counters.blockRatio * 100).toFixed(1)}%`
                        : "—"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Redis ativo</span>
                    <span className="font-medium">{redisAvailable ? "Sim" : "Não"}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Cache in-memory</span>
                    <span className="font-medium tabular-nums">
                      {formatCount(memoryStoreSize)} entries
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </MetricCard>

        {/* Tracked IPs by Endpoint bar chart */}
        <MetricCard icon={Network} title="IPs Trackeados por Endpoint">
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={endpointTrackedData}
                layout="vertical"
                margin={{ left: 120, right: 16, top: 8, bottom: 8 }}
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
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  width={120}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(
                    _v: number,
                    _n: string,
                    entry: { payload?: Record<string, unknown> },
                  ) => {
                    const p = (entry?.payload ?? {}) as { tracked?: number; max?: number }
                    return [
                      `${formatCount(p.tracked ?? 0)} IPs (max ${p.max ?? "—"} req/min)`,
                      "Tracked",
                    ]
                  }}
                />
                <Bar dataKey="tracked" name="IPs Trackeados" radius={[0, 3, 3, 0]} barSize={24}>
                  {endpointTrackedData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} strokeWidth={0} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            IPs únicos com requisições ativas na janela de 60s. Limite por IP:{" "}
            {Object.entries(config)
              .map(([ep, c]) => `${ENDPOINT_LABELS[ep] ?? ep}: ${c.max} req/min`)
              .join(", ")}
            .
          </p>
        </MetricCard>
      </div>

      {/* ── Per-Endpoint Tables ──────────────────────────────────────── */}
      <section aria-label="IPs mais ativos" className="space-y-6">
        <h3 className="text-lg font-semibold tracking-tight">🔝 IPs mais ativos</h3>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {Object.entries(endpoints).map(([ep, ed]) => {
            const Icon = ENDPOINT_ICONS[ep] ?? Globe
            return (
              <MetricCard
                key={ep}
                icon={Icon}
                title={`${ENDPOINT_LABELS[ep] ?? ep} — ${ed.trackedIPs} IPs únicos`}
              >
                {ed.topIPs.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <CheckCircle2 className="size-8 text-emerald-400" />
                    <p className="text-muted-foreground text-xs">Nenhum IP ativo neste endpoint</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {ed.topIPs.map((ipInfo, idx) => {
                      const usage = ipInfo.requests / ed.config.max
                      return (
                        <div
                          key={`${ep}-${ipInfo.ip}`}
                          className={cn(
                            "border-border/50 hover:bg-muted/30 flex items-center gap-3 rounded-lg border p-3 transition-colors",
                            idx === 0 &&
                              "border-amber-200 bg-amber-50/50 dark:border-amber-800/30 dark:bg-amber-950/10",
                          )}
                        >
                          {/* Rank badge */}
                          <span
                            className={cn(
                              "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                              idx === 0
                                ? "bg-amber-200 text-amber-800 dark:bg-amber-800/40 dark:text-amber-300"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {idx + 1}
                          </span>

                          {/* IP address */}
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-xs font-medium" title={ipInfo.ip}>
                              {ipInfo.ip.length > 24 ? `${ipInfo.ip.slice(0, 24)}…` : ipInfo.ip}
                            </p>
                            <div className="mt-1 flex items-center gap-2">
                              {/* Usage bar */}
                              <div className="bg-muted h-1.5 w-full max-w-[80px] overflow-hidden rounded-full">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all",
                                    usage > 0.8
                                      ? "bg-red-500"
                                      : usage > 0.5
                                        ? "bg-amber-500"
                                        : "bg-emerald-500",
                                  )}
                                  style={{ width: `${Math.min(usage * 100, 100)}%` }}
                                />
                              </div>
                              <span className="text-muted-foreground text-[10px] tabular-nums">
                                {ipInfo.requests}/{ed.config.max}
                              </span>
                            </div>
                          </div>

                          {/* Status badge */}
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                              ipInfo.remaining > 0
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                            )}
                          >
                            {ipInfo.remaining > 0 ? (
                              <>
                                <CheckCircle2 className="size-3" />
                                {ipInfo.remaining} restantes
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="size-3" />
                                Bloqueado
                              </>
                            )}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </MetricCard>
            )
          })}
        </div>
      </section>

      {/* ── Info note ───────────────────────────────────────────────── */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-800/30 dark:bg-blue-950/20 dark:text-blue-300">
        <p className="font-medium">🔍 Diagnóstico em tempo real</p>
        <p className="mt-1">
          Dados lidos <strong>apenas do cache in-memory</strong> — sem queries Redis, sem latência.
          A janela deslizante é de 60s para todos os endpoints.
          {redisAvailable
            ? " Redis está disponível e as requisições são trackeadas via sorted sets (distribuído)."
            : " Redis não está disponível — o rate limiting está rodando apenas em memória (process-local)."}
          Dados atualizados a cada 15s. Última atualização: {formatTimeAgo(timestamp)}.
        </p>
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function RateLimitSkeleton() {
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
      <div className="grid grid-cols-3 gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border">
            <div className="border-b px-5 py-4">
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, j) => (
                <Skeleton key={j} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default AdminGeoRateLimitStatus
