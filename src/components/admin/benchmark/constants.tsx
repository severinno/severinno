"use client"

import * as React from "react"

export const STATUS_COLORS: Record<string, string> = {
  regression: "hsl(0, 72%, 51%)",
  improvement: "hsl(160, 84%, 39%)",
  unchanged: "hsl(240, 4%, 60%)",
  changed: "hsl(38, 92%, 50%)",
  new: "hsl(201, 90%, 48%)",
  removed: "hsl(240, 6%, 50%)",
}

export const TYPE_COLORS: Record<string, string> = {
  geo: "hsl(201, 90%, 48%)",
  cache: "hsl(38, 92%, 50%)",
  gist_index_analysis: "hsl(160, 84%, 39%)",
  real_postgis: "hsl(0, 72%, 51%)",
}

export const CROSSOVER_COLORS = ["hsl(160, 84%, 39%)", "hsl(201, 90%, 48%)", "hsl(38, 92%, 50%)"]

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "hsl(240, 4%, 60%)"

  const labels: Record<string, string> = {
    regression: "⚠ Regressão",
    improvement: "✅ Melhoria",
    unchanged: "— Estável",
    changed: "⚡ Alterado",
    new: "🆕 Novo",
    removed: "🗑 Removido",
  }

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: `${color}20`, color }}
    >
      {labels[status] ?? status}
    </span>
  )
}
