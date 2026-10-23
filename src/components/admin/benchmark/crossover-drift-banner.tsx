"use client"

import * as React from "react"
import { GitCompareArrows } from "lucide-react"
import type { CrossoverDriftAlert } from "@/app/api/admin/benchmarks/route"

export function CrossoverDriftBanner({ alerts }: { alerts: CrossoverDriftAlert[] }) {
  const [expanded, setExpanded] = React.useState(false)

  if (alerts.length === 0) return null

  // Group by gistFaster state change for summary
  const stateChanges = alerts.filter((a) => a.gistFasterStateChanged)
  const maxDrift = Math.max(...alerts.map((a) => a.stepDrift ?? 0), 0)

  return (
    <section
      aria-label="Alerta de deriva do crossover GiST"
      className="rounded-xl border border-violet-200 bg-violet-50/80 p-4 dark:border-violet-900/30 dark:bg-violet-950/10"
    >
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <GitCompareArrows className="mt-0.5 size-5 shrink-0 text-violet-500" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-violet-800 dark:text-violet-300">
              {alerts.length} alteração(ões) no raio de crossover GiST
            </p>
            <p className="mt-0.5 text-xs text-violet-700 dark:text-violet-400">
              {maxDrift > 0 ? `Deriva de até ${maxDrift} step(s) detectada. ` : ""}
              {stateChanges.length > 0
                ? `${stateChanges.length} densidade(s) com mudança de regime GiST (mais lento/rápido que full scan). `
                : ""}
              O raio de crossover mudou significativamente — pode indicar alteração no índice GiST,
              versão do PostGIS ou hardware.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 transition-colors hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-200"
          >
            {expanded ? "Ocultar" : "Detalhes"}
          </button>
        </div>

        {/* Expanded details table */}
        {expanded && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-violet-200 text-violet-600 dark:border-violet-800 dark:text-violet-400">
                  <th className="pr-3 pb-2 font-medium">Densidade</th>
                  <th className="pr-3 pb-2 text-right font-medium">Anterior</th>
                  <th className="pr-3 pb-2 text-right font-medium">Atual</th>
                  <th className="pr-3 pb-2 text-right font-medium">Steps</th>
                  <th className="pr-3 pb-2 text-center font-medium">Regime</th>
                  <th className="pb-2 font-medium">Commits</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert, idx) => (
                  <tr
                    key={`drift-${alert.density}-${idx}`}
                    className="border-b border-violet-100 last:border-0 dark:border-violet-800/30"
                  >
                    <td className="py-2 pr-3 font-medium tabular-nums">
                      {alert.density.toLocaleString()} prov
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {alert.previousRadiusKm != null ? `${alert.previousRadiusKm} km` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {alert.currentRadiusKm != null ? `${alert.currentRadiusKm} km` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium tabular-nums">
                      {alert.stepDrift != null ? (
                        <span className={alert.stepDrift > 1 ? "text-red-500" : "text-amber-500"}>
                          {alert.stepDrift}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-center">
                      {alert.gistFasterStateChanged ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                          Mudou
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-[10px]">Estável</span>
                      )}
                    </td>
                    <td className="py-2 font-mono text-[10px] tabular-nums">
                      <span className="cursor-help" title={`Anterior: ${alert.previousCommitHash}`}>
                        {alert.previousCommitHash.slice(0, 7)}
                      </span>
                      <span className="text-muted-foreground mx-1">→</span>
                      <span className="cursor-help" title={`Atual: ${alert.currentCommitHash}`}>
                        {alert.currentCommitHash.slice(0, 7)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
