"use client"

import { useEffect, useState, useCallback } from "react"

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
      return "text-green-600 bg-green-50"
    case "open":
      return "text-red-600 bg-red-50"
    case "half-open":
      return "text-yellow-600 bg-yellow-50"
    default:
      return "text-gray-600 bg-gray-50"
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
  const [data, setData] = useState<DebugData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/geo/debug")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      void fetchData()
    }, 30_000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) return <div className="p-6 text-gray-500">Carregando métricas geo...</div>
  if (error) return <div className="p-6 text-red-500">Erro: {error}</div>
  if (!data) return null

  const { server, redis, circuitBreakers, geoMetrics } = data

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">🗺️ Geo Debug Dashboard</h2>
        <div className="text-sm text-gray-500">
          {lastRefresh && `Atualizado: ${lastRefresh.toLocaleTimeString("pt-BR")}`}
          <button onClick={fetchData} className="ml-2 text-blue-600 hover:underline">
            🔄
          </button>
        </div>
      </div>

      {/* ── Server Info ── */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h3 className="mb-2 font-semibold">Servidor</h3>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Uptime:</span> {formatUptime(server.uptime)}
          </div>
          <div>
            <span className="text-gray-500">Plataforma:</span> {server.platform}
          </div>
          <div>
            <span className="text-gray-500">Node:</span> {server.nodeVersion}
          </div>
          <div>
            <span className="text-gray-500">Redis:</span>{" "}
            {redis.available ? "✅ Conectado" : "❌ Indisponível"}
          </div>
        </div>
      </div>

      {/* ── Circuit Breakers ── */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold">⚡ Circuit Breakers</h3>
        <div className="grid grid-cols-2 gap-3">
          {Object.values(circuitBreakers).map((cb) => (
            <div key={cb.name} className={`rounded-md border p-3 ${stateColor(cb.state)}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {stateIcon(cb.state)} {cb.name}
                </span>
                <span className="text-xs uppercase">{cb.state}</span>
              </div>
              <div className="mt-1 text-xs opacity-75">
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
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold">📊 Chamadas Geo</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="pb-2">Operação</th>
              <th className="pb-2 text-right">Chamadas</th>
              <th className="pb-2 text-right">Fallbacks</th>
              <th className="pb-2 text-right">Taxa Fallback</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(geoMetrics.calls).map(([op, stats]) => (
              <tr key={op} className="border-b last:border-0">
                <td className="py-2 font-medium">{op}</td>
                <td className="py-2 text-right">{stats.calls}</td>
                <td className="py-2 text-right">{stats.fallbacks}</td>
                <td className="py-2 text-right">
                  {stats.fallbackRate !== null ? (
                    <span
                      className={
                        stats.fallbackRate > 10
                          ? "text-red-600"
                          : stats.fallbackRate > 5
                            ? "text-yellow-600"
                            : "text-green-600"
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
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold">
          ⏱️ Latência por Serviço (últimos {geoMetrics.latencyWindowSeconds}s)
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
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
              <tr key={name} className="border-b last:border-0">
                <td className="py-2 font-medium">{name}</td>
                <td className="py-2 text-right">{formatMs(metrics.p50)}</td>
                <td className="py-2 text-right">{formatMs(metrics.p95)}</td>
                <td className="py-2 text-right">{formatMs(metrics.p99)}</td>
                <td className="py-2 text-right">{metrics.count}</td>
                <td className="py-2 text-right">
                  {metrics.errorCount > 0 ? (
                    <span className="text-red-600">
                      {metrics.errorCount} ({(metrics.errorRate * 100).toFixed(1)}%)
                    </span>
                  ) : (
                    <span className="text-green-600">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Cache Stats ── */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold">💾 Cache</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Hits:</span>{" "}
            <span className="font-medium text-green-600">{redis.hits}</span>
          </div>
          <div>
            <span className="text-gray-500">Misses:</span>{" "}
            <span className="font-medium text-red-600">{redis.misses}</span>
          </div>
          <div>
            <span className="text-gray-500">Hit Ratio:</span>{" "}
            <span className="font-medium">
              {redis.hitRatio !== null ? `${(redis.hitRatio * 100).toFixed(1)}%` : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
