"use client"

/**
 * BenchmarkSection — Haversine JS vs PostGIS Real Benchmark Comparison
 *
 * Compares real-measured latency and throughput between the Haversine JS
 * fallback function and the PostGIS spatial query.
 *
 * SSR-safe: uses localStorage for scale preference (client-only).
 * Extracted from admin-geo-metrics-dashboard.tsx for modularity.
 */

import * as React from "react"
import { BarChart3, FileJson, GitCompareArrows, Microscope, Zap } from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { cn } from "@/lib/utils"
import { MetricCard } from "@/components/admin/admin-metric-card"
import {
  buildBenchmarkBarData,
  getMaxPostgisLatency,
  ratioColor,
  generateBenchmarkCsv,
  downloadFile,
  printBenchmarkReport,
} from "@/lib/benchmark-data"

import type { GeoMetricsResponse } from "@/app/api/admin/geo-metrics/route"
import { COLOR_P50, COLOR_P95, COLOR_P99, TOOLTIP_STYLE } from "./admin-chart-theme"

// ── Chart tooltip style ──────────────────────────────────────────────────

// ── Percentile colors ────────────────────────────────────────────────────

// ── Props ────────────────────────────────────────────────────────────────

export type BenchmarkSectionProps = {
  benchmark: NonNullable<GeoMetricsResponse["benchmark"]>
}

// ── Component ────────────────────────────────────────────────────────────

export function BenchmarkSection({ benchmark }: BenchmarkSectionProps) {
  const barData = buildBenchmarkBarData(benchmark)

  const maxLatency = getMaxPostgisLatency(barData)
  const [benchUseLog, setBenchUseLog] = React.useState(() => {
    if (typeof window === "undefined") return true
    const stored = localStorage.getItem("geo-scale-bench")
    return stored !== null ? stored === "true" : true
  })

  return (
    <section aria-label="Comparação de benchmark" className="space-y-6">
      <div className="flex items-center gap-2">
        <Microscope className="size-5 text-purple-500" />
        <h2 className="text-foreground text-lg font-semibold">
          Benchmark Real — Haversine JS vs PostGIS
        </h2>
      </div>

      {/* ── Export buttons + Scale toggle ──────────────────────────── */}
      <div className="flex items-center justify-end gap-2">
        {/* CSV */}
        <button
          type="button"
          onClick={() => {
            const csv = generateBenchmarkCsv(benchmark)
            const ts = new Date().toISOString().slice(0, 19).replace(/[:]/g, "-")
            downloadFile(csv, `benchmark-${ts}.csv`, "text/csv;charset=utf-8")
          }}
          className="bg-muted/50 text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[10px] font-medium transition-colors"
          aria-label="Exportar CSV"
        >
          <FileJson className="size-3" />
          CSV
        </button>

        {/* PDF / Print */}
        <button
          type="button"
          onClick={() => {
            printBenchmarkReport(benchmark)
          }}
          className="bg-muted/50 text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[10px] font-medium transition-colors"
          aria-label="Exportar PDF"
        >
          <FileJson className="size-3" />
          PDF
        </button>

        <span className="text-muted-foreground text-[10px]">
          Gráficos: {benchUseLog ? "Log" : "Linear"}
        </span>
        <button
          type="button"
          onClick={() => {
            const next = !benchUseLog
            localStorage.setItem("geo-scale-bench", String(next))
            setBenchUseLog(next)
          }}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
            benchUseLog ? "bg-primary border-primary" : "bg-muted border-border",
          )}
          role="switch"
          aria-checked={benchUseLog}
          aria-label="Alternar escala Log/Linear nos gráficos de benchmark"
        >
          <span
            className={cn(
              "inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
              benchUseLog ? "translate-x-[18px]" : "translate-x-[2px]",
            )}
          />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <MetricCard
          icon={GitCompareArrows}
          title={`Latência Média (µs) — Escala ${benchUseLog ? "Log" : "Linear"}`}
        >
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
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
                  scale={benchUseLog ? "log" : "linear"}
                  domain={benchUseLog ? [1, maxLatency * 2] : [0, "auto"]}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  width={100}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, n: string) => [
                    `${v.toFixed(1)}µs`,
                    n === "haversine" ? "Haversine JS" : "PostGIS",
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                <Bar
                  dataKey="haversine"
                  name="Haversine JS"
                  fill={COLOR_P50}
                  radius={[0, 3, 3, 0]}
                  barSize={12}
                />
                <Bar
                  dataKey="postgis"
                  name="PostGIS"
                  fill={COLOR_P99}
                  radius={[0, 3, 3, 0]}
                  barSize={12}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>

        {/* Use opsPerSec instead of mean for the throughput chart */}
        <MetricCard icon={Zap} title="Throughput (ops/sec)">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
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
                  scale={benchUseLog ? "log" : "linear"}
                  domain={benchUseLog ? undefined : [0, "auto"]}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  width={100}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, n: string) => [
                    `${v.toLocaleString()} ops/s`,
                    n === "haversine_ops" ? "Haversine JS" : n === "postgis_ops" ? "PostGIS" : n,
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                <Bar
                  dataKey="haversine_ops"
                  name="Haversine JS"
                  fill={COLOR_P50}
                  radius={[0, 3, 3, 0]}
                  barSize={12}
                />
                <Bar
                  dataKey="postgis_ops"
                  name="PostGIS"
                  fill={COLOR_P99}
                  radius={[0, 3, 3, 0]}
                  barSize={12}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>

        <MetricCard icon={BarChart3} title="Razão PostGIS / Haversine">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
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
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  width={100}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [`${v}×`, "Razão"]}
                />
                <Bar dataKey="ratio" name="Razão" radius={[0, 3, 3, 0]} barSize={20}>
                  {barData.map((entry) => (
                    <Cell key={entry.label} fill={ratioColor(entry.ratio)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="border-border/50 bg-muted/20 mt-3 rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">
              <span className="text-foreground font-medium">Análise:</span>{" "}
              {benchmark.analysis.note}
            </p>
            <p className="text-muted-foreground mt-1 text-[10px]">
              Benchmark executado em {benchmark.meta.platform} ({benchmark.meta.nodeVersion}) —{" "}
              centro em {benchmark.meta.centerLabel} —{" "}
              {new Date(benchmark.meta.timestamp).toLocaleDateString("pt-BR")}
            </p>
          </div>
        </MetricCard>
      </div>
    </section>
  )
}
