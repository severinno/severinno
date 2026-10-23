"use client"

import { useQuery } from "@tanstack/react-query"
import { apiGet } from "@/lib/api"
import { triggerHaptic } from "@/lib/haptics"
import { RotateCw } from "lucide-react"
import { cn } from "@/lib/utils"

// ── Types ──────────────────────────────────────────────────────────────────

type CircuitBreakerStats = {
  name: string
  state: "closed" | "open" | "half-open"
  failures: number
  successes: number
  lastFailureAt: string | null
  openedAt: string | null
}

type GeoOperationStats = {
  calls: number
  fallbacks: number
  fallbackRate: number | null
}

type LatencyMetrics = {
  p50: number
  p95: number
  p99: number
  count: number
  errorRate: number
  errorCount: number
}

type DebugData = {
  server: { uptime: number; platform: string; nodeVersion: string; timestamp: string }
  redis: { available: boolean; hits: number; misses: number; hitRatio: number | null }
  circuitBreakers: Record<string, CircuitBreakerStats>
  geoMetrics: {
    calls: Record<string, GeoOperationStats>
    latency: Record<string, LatencyMetrics>
    latencyWindowSeconds: number
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function stateColor(state: string): string {
  switch (state) {
    case "closed":
      return "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-900/30 dark:bg-emerald-950/30 dark:text-emerald-400"
    case "open":
      return "border-red-200 bg-red-50 text-red-600 dark:border-red-900/30 dark:bg-red-950/30 dark:text-red-400"
    case "half-open":
      return "border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-900/30 dark:bg-amber-950/30 dark:text-amber-400"
    default:
      return "border-border/50 bg-muted/40 text-muted-foreground"
  }
}

function stateIcon(state: string): string {
  switch (state) {
    case "closed":
      return "🟢"
    case "open":
      return "🔴"
    case "half-open":
      return "🟡"
    default:
      return "⚪"
  }
}

function formatMs(ms: number): string {
  if (ms < 1) return "<1ms"
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── Component ──────────────────────────────────────────────────────────────

export function GeoDebugDashboard() {
  const { data, isLoading, isError, error, isFetching, refetch, dataUpdatedAt } =
    useQuery<DebugData>({
      queryKey: ["admin", "geo", "debug"],
      queryFn: () => apiGet<DebugData>("/api/geo/debug"),
      refetchInterval: 30_000,
      staleTime: 10_000,
    })

  if (isLoading) {
    return <div className="text-muted-foreground p-3.5 text-xs">Carregando métricas geo...</div>
  }

  if (isError || !data) {
    return (
      <div className="p-3.5 text-xs text-red-500">
        Erro ao carregar métricas geo:{" "}
        {error instanceof Error ? error.message : "Falha na requisição"}
      </div>
    )
  }

  const { server, redis, circuitBreakers, geoMetrics } = data

  return (
    <div className="space-y-3.5 p-3.5">
      <div className="flex items-center justify-between border-b pb-2">
        <h2 className="text-foreground text-base font-bold">🗺️ Geo Debug Dashboard</h2>
        <div className="text-muted-foreground flex items-center gap-2 text-xs tabular-nums">
          {dataUpdatedAt ? (
            <span>Atualizado: {new Date(dataUpdatedAt).toLocaleTimeString("pt-BR")}</span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection")
              void refetch()
            }}
            disabled={isFetching}
            className="text-primary hover:text-primary/80 transition-all active:scale-95 disabled:opacity-50"
            title="Atualizar"
            aria-label="Atualizar métricas"
          >
            <RotateCw className={cn("size-3.5", isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* ── Server Info ── */}
      <div className="border-border/50 bg-card rounded-lg border p-3.5 shadow-sm">
        <h3 className="text-foreground mb-2 text-sm font-semibold">Servidor</h3>
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <span className="text-muted-foreground">Uptime:</span>{" "}
            <span className="text-foreground tabular-nums">{formatUptime(server.uptime)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Plataforma:</span>{" "}
            <span className="text-foreground">{server.platform}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Node:</span>{" "}
            <span className="text-foreground tabular-nums">{server.nodeVersion}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Redis:</span>{" "}
            <span className="text-foreground">
              {redis.available ? "✅ Conectado" : "❌ Indisponível"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Circuit Breakers ── */}
      <div className="border-border/50 bg-card rounded-lg border p-3.5 shadow-sm">
        <h3 className="text-foreground mb-2.5 text-sm font-semibold">⚡ Circuit Breakers</h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {Object.values(circuitBreakers).map((cb) => (
            <div key={cb.name} className={`rounded-md border p-2.5 ${stateColor(cb.state)}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                  {stateIcon(cb.state)} {cb.name}
                </span>
                <span className="text-[10px] uppercase">{cb.state}</span>
              </div>
              <div className="mt-1 text-xs tabular-nums opacity-75">
                Falhas: {cb.failures} | Sucessos: {cb.successes}
                {cb.lastFailureAt && (
                  <span>
                    {" "}
                    | Última falha: {new Date(cb.lastFailureAt).toLocaleTimeString("pt-BR")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Geo Call Stats ── */}
      <div className="border-border/50 bg-card rounded-lg border p-3.5 shadow-sm">
        <h3 className="text-foreground mb-2.5 text-sm font-semibold">📊 Chamadas Geo</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-border/50 text-muted-foreground border-b text-left">
              <th className="pb-2">Operação</th>
              <th className="pb-2 text-right">Chamadas</th>
              <th className="pb-2 text-right">Fallbacks</th>
              <th className="pb-2 text-right">Taxa Fallback</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(geoMetrics.calls).map(([op, stats]) => (
              <tr key={op} className="border-border/50 border-b last:border-0">
                <td className="text-foreground py-1.5 font-medium">{op}</td>
                <td className="text-foreground py-1.5 text-right tabular-nums">{stats.calls}</td>
                <td className="text-foreground py-1.5 text-right tabular-nums">
                  {stats.fallbacks}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {stats.fallbackRate !== null ? (
                    <span
                      className={
                        stats.fallbackRate > 10
                          ? "text-red-600 dark:text-red-400"
                          : stats.fallbackRate > 5
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-emerald-600 dark:text-emerald-400"
                      }
                    >
                      {stats.fallbackRate}%
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Latency Metrics ── */}
      <div className="border-border/50 bg-card rounded-lg border p-3.5 shadow-sm">
        <h3 className="text-foreground mb-2.5 text-sm font-semibold">
          ⏱️ Latência por Serviço (últimos {geoMetrics.latencyWindowSeconds}s)
        </h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-border/50 text-muted-foreground border-b text-left">
              <th className="pb-2">Serviço</th>
              <th className="pb-2 text-right">P50</th>
              <th className="pb-2 text-right">P95</th>
              <th className="pb-2 text-right">P99</th>
              <th className="pb-2 text-right">Requisições</th>
              <th className="pb-2 text-right">Erros</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(geoMetrics.latency).map(([name, metrics]) => (
              <tr key={name} className="border-border/50 border-b last:border-0">
                <td className="text-foreground py-1.5 font-medium">{name}</td>
                <td className="text-foreground py-1.5 text-right tabular-nums">
                  {formatMs(metrics.p50)}
                </td>
                <td className="text-foreground py-1.5 text-right tabular-nums">
                  {formatMs(metrics.p95)}
                </td>
                <td className="text-foreground py-1.5 text-right tabular-nums">
                  {formatMs(metrics.p99)}
                </td>
                <td className="text-foreground py-1.5 text-right tabular-nums">{metrics.count}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {metrics.errorCount > 0 ? (
                    <span className="text-red-600 dark:text-red-400">
                      {metrics.errorCount} ({(metrics.errorRate * 100).toFixed(1)}%)
                    </span>
                  ) : (
                    <span className="text-emerald-600 dark:text-emerald-400">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Cache Stats ── */}
      <div className="border-border/50 bg-card rounded-lg border p-3.5 shadow-sm">
        <h3 className="text-foreground mb-2.5 text-sm font-semibold">💾 Cache</h3>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-muted-foreground">Hits:</span>{" "}
            <span className="font-medium text-emerald-600 tabular-nums dark:text-emerald-400">
              {redis.hits}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Misses:</span>{" "}
            <span className="font-medium text-red-600 tabular-nums dark:text-red-400">
              {redis.misses}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Hit Ratio:</span>{" "}
            <span className="text-foreground font-medium tabular-nums">
              {redis.hitRatio !== null ? `${(redis.hitRatio * 100).toFixed(1)}%` : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
