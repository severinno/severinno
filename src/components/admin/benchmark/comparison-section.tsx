"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { BENCHMARK_TYPE_LABELS } from "@/lib/benchmark-data"
import type { ComparisonResult } from "@/app/api/admin/benchmarks/route"
import { TYPE_COLORS, StatusBadge } from "./constants"

export function ComparisonSection({ comparison }: { comparison: ComparisonResult }) {
  const [showAll, setShowAll] = React.useState(false)
  const typeLabel = BENCHMARK_TYPE_LABELS[comparison.type] ?? comparison.type

  // Show regressions first, then sorted by change magnitude
  const sortedDiffs = React.useMemo(() => {
    const regression = comparison.regressions
    const rest = comparison.diffs.filter((d) => d.status !== "regression")
    return [...regression, ...rest.sort((a, b) => Math.abs(b.mean.pct) - Math.abs(a.mean.pct))]
  }, [comparison])

  const displayed = showAll ? sortedDiffs : sortedDiffs.slice(0, 10)

  return (
    <section
      aria-label={`Comparação ${typeLabel}`}
      className="border-border/50 bg-card rounded-xl border"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
        <div className="flex items-center gap-2">
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: TYPE_COLORS[comparison.type] ?? "#888" }}
          />
          <h2 className="text-foreground text-sm font-semibold">{typeLabel}</h2>
          {comparison.regressions.length > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400">
              {comparison.regressions.length} regressões
            </span>
          )}
          {comparison.improvements.length > 0 && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
              {comparison.improvements.length} melhorias
            </span>
          )}
        </div>

        <div className="text-muted-foreground flex items-center gap-2 text-[10px]">
          <span>
            Baseline: {new Date(comparison.baselineTimestamp).toLocaleDateString("pt-BR")}
          </span>
          <span className="text-muted-foreground/50">→</span>
          <span>Latest: {new Date(comparison.latestTimestamp).toLocaleDateString("pt-BR")}</span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto p-3">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground border-b">
              <th className="pr-3 pb-2 font-medium">Benchmark</th>
              <th className="pr-3 pb-2 text-right font-medium">Baseline (µs)</th>
              <th className="pr-3 pb-2 text-right font-medium">Latest (µs)</th>
              <th className="pr-3 pb-2 text-right font-medium">Δ%</th>
              <th className="pr-3 pb-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((diff) => (
              <tr
                key={diff.label}
                className={cn(
                  "border-b transition-colors last:border-0",
                  diff.status === "regression"
                    ? "bg-red-50/50 hover:bg-red-50/80 dark:bg-red-950/10 dark:hover:bg-red-950/20"
                    : "hover:bg-muted/20",
                )}
              >
                <td className="text-foreground py-2 pr-3 font-medium">{diff.name}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {diff.mean.baseline.toFixed(1)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {diff.mean.current.toFixed(1)}
                </td>
                <td
                  className={cn(
                    "py-2 pr-3 text-right font-medium tabular-nums",
                    diff.mean.pct > 5 && "text-red-500",
                    diff.mean.pct < -5 && "text-emerald-500",
                  )}
                >
                  {diff.mean.pct > 0 ? "+" : ""}
                  {diff.mean.pct.toFixed(1)}%
                </td>
                <td className="py-2 text-right">
                  <StatusBadge status={diff.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {comparison.diffs.length > 10 && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-muted-foreground hover:text-foreground hover:bg-muted/30 mt-2 w-full rounded-md py-2 text-[10px] font-medium transition-colors"
          >
            {showAll ? "Mostrar menos" : `Mostrar todos (${comparison.diffs.length} benchmarks)`}
          </button>
        )}
      </div>

      {/* Footer stats */}
      <div className="border-t px-5 py-3">
        <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-[10px]">
          <span>Total: {comparison.totalBenchmarks}</span>
          <span className="text-red-500">Regressões: {comparison.regressions.length}</span>
          <span className="text-emerald-500">Melhorias: {comparison.improvements.length}</span>
          <span>
            Índice de saúde:{" "}
            {comparison.totalBenchmarks > 0
              ? `${(
                  ((comparison.totalBenchmarks - comparison.regressions.length) /
                    comparison.totalBenchmarks) *
                  100
                ).toFixed(0)}%`
              : "—"}
          </span>
        </div>
      </div>
    </section>
  )
}
