"use client"

/**
 * TimelineSection — P50 / P95 / P99 Historical Evolution Chart
 *
 * Plots the P50/P95/P99 latency for each geo service over time using
 * snapshots collected by the server-side metrics system.
 *
 * SSR-safe: uses localStorage for scale preference (client-only).
 * Extracted from admin-geo-metrics-dashboard.tsx for modularity.
 */

import * as React from "react"
import { LineChart as LineChartIcon } from "lucide-react"
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

import { cn } from "@/lib/utils"
import { MetricCard } from "@/components/admin/admin-metric-card"
import type { GeoMetricsResponse } from "@/app/api/admin/geo-metrics/route"

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

// ── Percentile colors ────────────────────────────────────────────────────

const COLOR_P50 = "hsl(160, 84%, 39%)"
const COLOR_P95 = "hsl(38, 92%, 50%)"
const COLOR_P99 = "hsl(0, 72%, 51%)"

// ── Props ────────────────────────────────────────────────────────────────

export type TimelineSectionProps = {
  history: NonNullable<GeoMetricsResponse["history"]>
  labels: Record<string, string>
  baselines: Record<string, number>
}

// ── Component ────────────────────────────────────────────────────────────

export function TimelineSection({ history, labels, baselines }: TimelineSectionProps) {
  // Compute the 2x P95 baseline per service for the ReferenceLine
  const baselineThresholds = Object.keys(history[0]?.services ?? {}).reduce<
    Record<string, number | null>
  >((acc, svc) => {
    const bl = baselines[svc]
    acc[svc] = bl != null ? Math.round(bl * 2) : null
    return acc
  }, {})

  // Build timeline data: one row per snapshot timestamp
  const timelineData: Array<Record<string, string | number>> = history.map((snap) => {
    const time = new Date(snap.timestamp)
    const row: Record<string, string | number> = {
      time: time.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      ts: snap.timestamp,
    }
    // Flatten for Recharts
    for (const [key, val] of Object.entries(snap.services)) {
      row[`${key}_p50`] = Math.round(val.p50)
      row[`${key}_p95`] = Math.round(val.p95)
      row[`${key}_p99`] = Math.round(val.p99)
    }
    return row
  })

  const serviceKeys = Object.keys(history[0]?.services ?? {})
  const [timelineUseLog, setTimelineUseLog] = React.useState(() => {
    if (typeof window === "undefined") return true
    const stored = localStorage.getItem("geo-scale-timeline")
    return stored !== null ? stored === "true" : true
  })

  return (
    <section aria-label="Evolução temporal" className="space-y-6">
      <div className="flex items-center gap-2">
        <LineChartIcon className="size-5 text-violet-500" />
        <h2 className="text-foreground text-lg font-semibold">
          Evolução Temporal — P50 / P95 / P99
        </h2>
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium">
          {history.length} snapshots
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground text-[9px]">
            {timelineUseLog ? "Log" : "Linear"}
          </span>
          <button
            type="button"
            onClick={() => {
              const next = !timelineUseLog
              localStorage.setItem("geo-scale-timeline", String(next))
              setTimelineUseLog(next)
            }}
            className={cn(
              "relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
              timelineUseLog ? "bg-primary border-primary" : "bg-muted border-border",
            )}
            role="switch"
            aria-checked={timelineUseLog}
            aria-label="Alternar escala Log/Linear"
          >
            <span
              className={cn(
                "inline-block size-3 rounded-full bg-white shadow-sm transition-transform",
                timelineUseLog ? "translate-x-[14px]" : "translate-x-[1px]",
              )}
            />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {serviceKeys.map((svc) => {
          const svcLabel = labels[svc] ?? svc
          const dataHasSamples = timelineData.some((d) => Number(d[`${svc}_p50`] ?? 0) > 0)
          if (!dataHasSamples) return null

          return (
            <MetricCard key={svc} icon={LineChartIcon} title={`${svcLabel} — P50 / P95 / P99 (ms)`}>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timelineData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                    <XAxis
                      dataKey="time"
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
                      scale={timelineUseLog ? "log" : "linear"}
                      domain={timelineUseLog ? ["auto", "auto"] : [0, "auto"]}
                    />
                    <RTooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(v: number, n: string) => {
                        const label =
                          n === `${svc}_p50` ? "P50" : n === `${svc}_p95` ? "P95" : "P99"
                        return [`${Math.round(v)}ms`, label]
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                    {/* Reference line: 2x P95 baseline for this service */}
                    {baselineThresholds[svc] != null && (
                      <ReferenceLine
                        y={baselineThresholds[svc]!}
                        stroke="hsl(0, 72%, 51%)"
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                        label={{
                          value: "2× baseline",
                          position: "right",
                          fill: "hsl(0, 72%, 51%)",
                          fontSize: 9,
                        }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey={`${svc}_p50`}
                      name="P50"
                      stroke={COLOR_P50}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey={`${svc}_p95`}
                      name="P95"
                      stroke={COLOR_P95}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey={`${svc}_p99`}
                      name="P99"
                      stroke={COLOR_P99}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </MetricCard>
          )
        })}
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-800/30 dark:bg-blue-950/20 dark:text-blue-300">
        <p className="font-medium">⏱ Cada snapshot é coletado automaticamente a cada poll (30s)</p>
        <p className="mt-1">
          O histórico é mantido em memória no servidor (últimos {history.length} snapshots). Os
          snapshots são resetados com cada restart do servidor.
        </p>
      </div>
    </section>
  )
}
