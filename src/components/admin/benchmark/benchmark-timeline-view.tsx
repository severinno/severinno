"use client"

import * as React from "react"
import { FileJson } from "lucide-react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { TOOLTIP_STYLE } from "../admin-chart-theme"
import type { BenchmarkHistoryEntry } from "@/app/api/admin/benchmarks/route"

/**
 * BenchmarkTimelineView — Renders a per-benchmark evolution chart and
 * snapshot table from git history entries (e.g. geo or cache benchmark
 * JSON files extracted from git).
 */
export function BenchmarkTimelineView({
  type: _type,
  label,
  history,
  color: _color,
}: {
  type: string
  label: string
  history: BenchmarkHistoryEntry[]
  color: string
}) {
  // Build chart data: group by date, then per benchmark label
  const chartData = React.useMemo(() => {
    const dateMap = new Map<
      string,
      { ts: number; vals: Record<string, { mean: number; ops: number; p95: number }> }
    >()

    for (const entry of history) {
      const ts = entry.timestamp
      if (!ts) continue

      const d = new Date(ts)
      const dateKey = d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })

      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, { ts: d.getTime(), vals: {} })
      }
      const group = dateMap.get(dateKey)!

      for (const bench of entry.data.benchmarks) {
        if (!group.vals[bench.label] || group.vals[bench.label].mean === 0) {
          group.vals[bench.label] = {
            mean: bench.mean,
            ops: bench.opsPerSec,
            p95: bench.p95 ?? bench.mean,
          }
        }
      }
    }

    return [...dateMap.entries()]
      .sort(([, a], [, b]) => a.ts - b.ts)
      .map(([date, { vals }]) => {
        const row: Record<string, number | string> = { date }
        for (const [key, v] of Object.entries(vals)) {
          row[`${key}_mean`] = v.mean
          row[`${key}_ops`] = v.ops
          row[`${key}_p95`] = v.p95
        }
        return row
      })
  }, [history])

  // Determine which lines to render
  const lines = React.useMemo(() => {
    if (chartData.length === 0) return []
    const suffix = "_mean"
    const keys = Object.keys(chartData[0]).filter((k) => k.endsWith(suffix) && k !== "date")

    const PALETTE = [
      "hsl(201, 90%, 48%)",
      "hsl(38, 92%, 50%)",
      "hsl(160, 84%, 39%)",
      "hsl(0, 72%, 51%)",
    ]

    return keys.map((dataKey, idx) => ({
      dataKey,
      name: dataKey.replace(suffix, "").replace(/_/g, " "),
      color: PALETTE[idx % PALETTE.length],
    }))
  }, [chartData])

  if (chartData.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-12">
        <FileJson className="size-8 opacity-50" />
        <p className="text-sm">Nenhum snapshot histórico encontrado para {label}.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Chart */}
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={50}
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              label={{
                value: "µs",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
              }}
              scale="log"
              domain={["auto", "auto"]}
            />
            <RTooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: number, n: string) => [`${v.toFixed(v < 1 ? 2 : 1)} µs`, n]}
            />
            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
            {lines.slice(0, 12).map((line) => (
              <Line
                key={line.dataKey}
                type="monotone"
                dataKey={line.dataKey}
                name={line.name}
                stroke={line.color}
                strokeWidth={1.5}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        {lines.length > 12 && (
          <p className="text-muted-foreground mt-1 text-[10px]">
            Mostrando 12 de {lines.length} benchmarks
          </p>
        )}
      </div>

      {/* Snapshot table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground border-b">
              <th className="pr-3 pb-2 font-medium">Snapshot</th>
              <th className="pr-3 pb-2 font-medium">Commit</th>
              <th className="pr-3 pb-2 text-right font-medium">Benchmarks</th>
              <th className="pr-3 pb-2 text-right font-medium">Latência Média</th>
              <th className="pb-2 text-right font-medium">Throughput</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry, idx) => {
              const avg =
                entry.data.benchmarks.length > 0
                  ? entry.data.benchmarks.reduce((a, b) => a + b.mean, 0) /
                    entry.data.benchmarks.length
                  : 0
              const throughput =
                entry.data.benchmarks.length > 0
                  ? entry.data.benchmarks.reduce((a, b) => a + b.opsPerSec, 0) /
                    entry.data.benchmarks.length
                  : 0
              return (
                <tr
                  key={`${entry.commitHash}-${idx}`}
                  className="hover:bg-muted/20 border-b last:border-0"
                >
                  <td className="text-foreground py-2 pr-3 font-medium tabular-nums">
                    {new Date(entry.timestamp).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[10px]">
                    <span className="cursor-help" title={`Commit completo: ${entry.commitHash}`}>
                      {entry.commitHash}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {entry.data.benchmarks.length}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{avg.toFixed(1)} µs</td>
                  <td className="py-2 text-right tabular-nums">{throughput.toFixed(0)} ops/s</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="text-muted-foreground flex items-center gap-4 text-[10px]">
        <span>
          Total de snapshots: <span className="font-medium">{history.length}</span>
        </span>
        <span>
          Período: {new Date(history[0].timestamp).toLocaleDateString("pt-BR")} →{" "}
          {new Date(history[history.length - 1].timestamp).toLocaleDateString("pt-BR")}
        </span>
      </div>
    </div>
  )
}
