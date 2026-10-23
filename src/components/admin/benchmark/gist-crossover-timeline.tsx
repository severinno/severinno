"use client"

import * as React from "react"
import { GitCompareArrows, MapPin } from "lucide-react"
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
import { MetricCard } from "../_shared"
import { TOOLTIP_STYLE } from "../admin-chart-theme"
import { CROSSOVER_COLORS } from "./constants"
import type { GistCrossoverPoint } from "@/app/api/admin/benchmarks/route"

/**
 * GiSTCrossoverTimeline — Plots the evolution of the GiST index crossover
 * radius across weekly benchmark runs, extracted from git history of
 * geo-gist-baseline.json.
 *
 * Shows:
 *   - Crossover radius (km) per density over time
 *   - Best GiST/full ratio (%) per density over time
 *   - Commit hash tooltip for traceability
 */
export function GiSTCrossoverTimeline({ history }: { history: GistCrossoverPoint[] }) {
  const [selectedDensity, setSelectedDensity] = React.useState<number | "all">("all")

  // Group by density
  const densities = [...new Set(history.map((p) => p.density))].sort((a, b) => a - b)

  // Build chart data: group by timestamp, flatten for Recharts
  const timeGroups = new Map<
    string,
    {
      ts: number
      date: string
      commitHash: string
      values: Record<string, { radius: number | null; ratio: number | null }>
    }
  >()

  for (const point of history) {
    const d = new Date(point.timestamp)
    const dateKey = d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })

    if (!timeGroups.has(dateKey)) {
      timeGroups.set(dateKey, {
        ts: d.getTime(),
        date: dateKey,
        commitHash: point.commitHash,
        values: {},
      })
    }
    const group = timeGroups.get(dateKey)!
    group.values[`density_${point.density}`] = {
      radius: point.crossoverRadiusKm,
      ratio: point.bestRatioPct,
    }
  }

  const chartData = [...timeGroups.entries()]
    .sort(([, a], [, b]) => a.ts - b.ts)
    .map(([, group]) => {
      const row: Record<string, number | string | null> = {
        date: group.date,
        commitHash: group.commitHash,
      }
      for (const [key, v] of Object.entries(group.values)) {
        row[`${key}_radius`] = v.radius
        row[`${key}_ratio`] = v.ratio
      }
      return row
    })

  if (chartData.length === 0) return null

  // Filtered data for per-density view
  const filteredChartData =
    selectedDensity === "all"
      ? chartData
      : chartData.filter((row) => {
          const key = `density_${selectedDensity}`
          return row[`${key}_radius`] != null || row[`${key}_ratio`] != null
        })

  // ── 4-week rolling average crossover radius ──────────────────────
  const ROLLING_WINDOW = 4

  const rollingAvgKm = (() => {
    if (chartData.length === 0) return null

    if (selectedDensity === "all") {
      // Average of all densities: collect first non-null radius per point
      const recent = chartData.slice(-ROLLING_WINDOW).filter(Boolean)
      const values: number[] = []
      for (const row of recent) {
        for (const d of densities) {
          const v = row[`density_${d}_radius`]
          if (v != null && typeof v === "number") {
            values.push(v)
            break
          }
        }
      }
      if (values.length === 0) return null
      return +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)
    }

    // Single density selected: average last ROLLING_WINDOW non-null radius values
    const key = `density_${selectedDensity}_radius`
    const values = chartData
      .map((row) => row[key])
      .filter((v): v is number => v != null && typeof v === "number")
      .slice(-ROLLING_WINDOW)
    if (values.length === 0) return null
    return +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)
  })()

  // Show the last commit's hash
  const latestPoint = history.reduce((a, b) =>
    new Date(a.timestamp) > new Date(b.timestamp) ? a : b,
  )

  return (
    <section
      aria-label="Evolução do crossover GiST"
      className="border-border/50 bg-card rounded-xl border"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="size-5 text-emerald-500" />
          <h2 className="text-foreground text-sm font-semibold">Evolução do Crossover GiST</h2>
          <span className="text-muted-foreground rounded-full border px-2 py-0.5 font-mono text-[10px]">
            {chartData.length} snapshots
          </span>
        </div>

        {/* Density selector */}
        <div className="flex items-center gap-1.5">
          <MapPin className="text-muted-foreground size-3.5" />
          <button
            type="button"
            onClick={() => setSelectedDensity("all")}
            className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-medium transition-all",
              selectedDensity === "all"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
          >
            Todos
          </button>
          {densities.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setSelectedDensity(d)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[10px] font-medium transition-all",
                selectedDensity === d
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {d.toLocaleString()} prov
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 p-4 lg:grid-cols-2">
        {/* ── Crossover Radius Chart ───────────────────────────────── */}
        <MetricCard icon={MapPin} title="Raio de Crossover (km)">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={filteredChartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
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
                  width={40}
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  label={{
                    value: "km",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" },
                  }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, n: string) => {
                    const density = n.match(/density_(\d+)/)?.[1]
                    return [
                      `${v} km`,
                      density ? `${Number(density).toLocaleString()} providers` : n,
                    ]
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                {selectedDensity === "all"
                  ? densities.map((d, idx) => (
                      <Line
                        key={`density_${d}`}
                        type="monotone"
                        dataKey={`density_${d}_radius`}
                        name={`${d.toLocaleString()} providers`}
                        stroke={CROSSOVER_COLORS[idx % CROSSOVER_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                        connectNulls={false}
                      />
                    ))
                  : (() => {
                      const d = selectedDensity
                      return (
                        <Line
                          type="monotone"
                          dataKey={`density_${d}_radius`}
                          name={`${d.toLocaleString()} providers`}
                          stroke={CROSSOVER_COLORS[0]}
                          strokeWidth={2.5}
                          dot={{ r: 5, fill: CROSSOVER_COLORS[0] }}
                          activeDot={{ r: 7 }}
                          connectNulls={false}
                        />
                      )
                    })()}
                {/* 4-week rolling average reference line */}
                {rollingAvgKm != null && (
                  <ReferenceLine
                    key={`rolling-avg-${rollingAvgKm}`}
                    y={rollingAvgKm}
                    stroke="hsl(var(--muted-foreground) / 0.6)"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    label={{
                      value: `Média 4-sem: ${rollingAvgKm} km`,
                      position: "insideTopRight",
                      fill: "hsl(var(--muted-foreground))",
                      fontSize: 9,
                    }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>

        {/* ── Best GiST/Full Ratio Chart ───────────────────────────── */}
        <MetricCard icon={GitCompareArrows} title="Melhor Razão GiST / Full Scan (%)">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={filteredChartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
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
                  width={40}
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  label={{
                    value: "%",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" },
                  }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, n: string) => {
                    const density = n.match(/density_(\d+)/)?.[1]
                    return [
                      `${v.toFixed(1)}%`,
                      density ? `${Number(density).toLocaleString()} providers` : n,
                    ]
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                {selectedDensity === "all"
                  ? densities.map((d, idx) => (
                      <Line
                        key={`density_${d}_ratio`}
                        type="monotone"
                        dataKey={`density_${d}_ratio`}
                        name={`${d.toLocaleString()} providers`}
                        stroke={CROSSOVER_COLORS[idx % CROSSOVER_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                        connectNulls={false}
                      />
                    ))
                  : (() => {
                      const d = selectedDensity
                      return (
                        <Line
                          type="monotone"
                          dataKey={`density_${d}_ratio`}
                          name={`${d.toLocaleString()} providers`}
                          stroke={CROSSOVER_COLORS[1]}
                          strokeWidth={2.5}
                          dot={{ r: 5, fill: CROSSOVER_COLORS[1] }}
                          activeDot={{ r: 7 }}
                          connectNulls={false}
                        />
                      )
                    })()}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>
      </div>

      {/* Summary footer */}
      <div className="border-t px-5 py-3">
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-1 text-[10px]">
          <span>
            Baseline commits consultados:{" "}
            <span className="font-mono font-medium">{chartData.length}</span>
          </span>
          <span>
            Último snapshot:{" "}
            <span className="font-mono font-medium">
              {new Date(latestPoint.timestamp).toLocaleDateString("pt-BR")}
            </span>
            <span className="ml-1 font-mono text-[9px]">({latestPoint.commitHash})</span>
          </span>
          <span>Densidades monitoradas: {densities.map((d) => d.toLocaleString()).join(", ")}</span>
        </div>
      </div>
    </section>
  )
}
