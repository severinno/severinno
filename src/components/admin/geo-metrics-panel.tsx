/**
 * GeoMetricsPanel — real-time geo performance dashboard.
 *
 * Shows: latency P50/P95/P99, cache hit ratio, fallback rate, circuit breaker status.
 * Polls /api/geo/debug every 10s for live updates.
 */
"use client"

import { useState, useEffect } from "react"

type GeoMetrics = {
  latency: Record<string, { p50: number; p95: number; p99: number; count: number }>
  cache: { hits: number; misses: number; hitRatio: number | null }
  fallbacks: Record<string, number>
  circuitBreakers: Record<string, { state: string; failures: number }>
  timestamp: string
}

function formatMs(ms: number): string {
  if (ms < 1) return "<1ms"
  if (ms < 100) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function StatusBadge({ value }: { value: string }) {
  const colors: Record<string, string> = {
    closed: "bg-green-100 text-green-800",
    open: "bg-red-100 text-red-800",
    "half-open": "bg-yellow-100 text-yellow-800",
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[value] ?? "bg-gray-100 text-gray-800"}`}>
      {value}
    </span>
  )
}

export function GeoMetricsPanel() {
  const [metrics, setMetrics] = useState<GeoMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchMetrics() {
      try {
        const res = await fetch("/api/geo/debug")
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setMetrics(data)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch")
      } finally {
        setLoading(false)
      }
    }

    fetchMetrics()
    const interval = setInterval(fetchMetrics, 10_000)
    return () => clearInterval(interval)
  }, [])

  if (loading) return <div className="p-4 text-gray-500">Carregando métricas geo...</div>
  if (error) return <div className="p-4 text-red-500">Erro: {error}</div>
  if (!metrics) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Geo Performance</h3>
        <span className="text-xs text-gray-400">
          Atualizado: {new Date(metrics.timestamp).toLocaleTimeString("pt-BR")}
        </span>
      </div>

      {/* Latency Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(metrics.latency).map(([service, data]) => (
          <div key={service} className="bg-white rounded-lg border p-4">
            <div className="text-sm font-medium text-gray-600 capitalize">{service}</div>
            <div className="mt-2 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">P50</span>
                <span className="font-mono">{formatMs(data.p50)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">P95</span>
                <span className="font-mono">{formatMs(data.p95)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">P99</span>
                <span className="font-mono">{formatMs(data.p99)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>Requests</span>
                <span>{data.count.toLocaleString()}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Cache & Fallbacks */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm font-medium text-gray-600">Cache Hit Ratio</div>
          <div className="mt-2 text-2xl font-bold">
            {metrics.cache.hitRatio !== null
              ? `${(metrics.cache.hitRatio * 100).toFixed(1)}%`
              : "N/A"}
          </div>
          <div className="mt-1 text-xs text-gray-400">
            {metrics.cache.hits.toLocaleString()} hits / {metrics.cache.misses.toLocaleString()} misses
          </div>
        </div>

        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm font-medium text-gray-600">Fallback Rate</div>
          <div className="mt-2 space-y-1">
            {Object.entries(metrics.fallbacks).map(([op, count]) => (
              <div key={op} className="flex justify-between text-xs">
                <span className="text-gray-500 capitalize">{op}</span>
                <span className="font-mono">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Circuit Breakers */}
      <div className="bg-white rounded-lg border p-4">
        <div className="text-sm font-medium text-gray-600 mb-3">Circuit Breakers</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(metrics.circuitBreakers).map(([name, cb]) => (
            <div key={name} className="flex items-center justify-between p-2 bg-gray-50 rounded">
              <span className="text-xs font-medium capitalize">{name}</span>
              <StatusBadge value={cb.state} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
