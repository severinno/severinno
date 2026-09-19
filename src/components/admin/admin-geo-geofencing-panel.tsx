/**
 * AdminGeoGeofencingPanel — Real-time geofencing + timezone metrics.
 *
 * Shows: enter/exit events, WhatsApp delivery rate, lock contentions,
 * timezone distribution, OSRM fallbacks.
 * Polls /api/admin/geo-metrics every 15s for live updates.
 */
"use client"

import { useState, useEffect } from "react"

type GeofencingData = {
  geofencing: {
    enterEvents: number
    exitEvents: number
    whatsappSent: number
    whatsappFailed: number
    lockContentions: number
    engineErrors: number
    osrmFallbackTriggers: number
  }
  timezone: {
    lookups: number
    fallbackToBrasilia: number
    byTimezone: Record<string, number>
  }
  uptime: number
}

function MetricCard({
  label,
  value,
  color = "text-gray-900",
}: {
  label: string
  value: string | number
  color?: string
}) {
  return (
    <div className="rounded-lg border bg-white p-3 shadow-sm">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
    </div>
  )
}

function RateBar({ sent, failed }: { sent: number; failed: number }) {
  const total = sent + failed
  const rate = total > 0 ? ((sent / total) * 100).toFixed(1) : "—"
  const pct = total > 0 ? (sent / total) * 100 : 0

  return (
    <div className="rounded-lg border bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">WhatsApp Delivery</span>
        <span className="text-sm font-bold text-gray-900">{rate}%</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-gray-100">
        <div
          className="h-2 rounded-full bg-green-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-xs text-gray-500">
        <span>{sent} enviado</span>
        <span>{failed} falhou</span>
      </div>
    </div>
  )
}

function TimezoneList({ byTimezone }: { byTimezone: Record<string, number> }) {
  const sorted = Object.entries(byTimezone)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)

  if (sorted.length === 0) {
    return <div className="text-sm text-gray-400">Nenhum lookup registrado</div>
  }

  const maxCount = sorted[0]?.[1] ?? 1

  return (
    <div className="space-y-1.5">
      {sorted.map(([tz, count]) => (
        <div key={tz} className="flex items-center gap-2">
          <span className="w-24 truncate text-xs text-gray-600" title={tz}>
            {tz}
          </span>
          <div className="h-1.5 flex-1 rounded-full bg-gray-100">
            <div
              className="h-1.5 rounded-full bg-blue-500"
              style={{ width: `${(count / maxCount) * 100}%` }}
            />
          </div>
          <span className="w-8 text-right text-xs font-medium text-gray-700">{count}</span>
        </div>
      ))}
    </div>
  )
}

export default function AdminGeoGeofencingPanel() {
  const [data, setData] = useState<GeofencingData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const poll = async () => {
      try {
        const res = await fetch("/api/admin/geo-metrics")
        if (!res.ok) throw new Error(`${res.status}`)
        const json = await res.json()
        if (active) {
          setData(json.observability)
          setError(null)
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Erro ao carregar")
      }
    }
    poll()
    const interval = setInterval(poll, 15_000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Erro ao carregar métricas: {error}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="animate-pulse rounded-lg border bg-white p-6 shadow-sm">
        <div className="h-4 w-48 rounded bg-gray-200" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 rounded bg-gray-100" />
          ))}
        </div>
      </div>
    )
  }

  const { geofencing: g, timezone: tz } = data
  const uptimeH = (data.uptime / 3600).toFixed(1)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Geofencing & Timezone</h3>
        <span className="text-xs text-gray-400">Uptime: {uptimeH}h</span>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Entradas" value={g.enterEvents} color="text-green-600" />
        <MetricCard label="Saídas" value={g.exitEvents} color="text-orange-600" />
        <MetricCard
          label="Lock Contentions"
          value={g.lockContentions}
          color={g.lockContentions > 0 ? "text-red-600" : "text-gray-900"}
        />
        <MetricCard
          label="Engine Errors"
          value={g.engineErrors}
          color={g.engineErrors > 0 ? "text-red-600" : "text-gray-900"}
        />
      </div>

      {/* WhatsApp Delivery Rate */}
      <RateBar sent={g.whatsappSent} failed={g.whatsappFailed} />

      {/* OSRM Fallbacks */}
      {g.osrmFallbackTriggers > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700">
          OSRM Fallbacks: <strong>{g.osrmFallbackTriggers}</strong> chamadas usaram Haversine
        </div>
      )}

      {/* Timezone Distribution */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Timezone Distribution</span>
          <span className="text-xs text-gray-400">
            {tz.lookups} lookups · {tz.fallbackToBrasilia} fallbacks
          </span>
        </div>
        <TimezoneList byTimezone={tz.byTimezone} />
      </div>
    </div>
  )
}
