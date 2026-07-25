"use client"

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { formatBRL } from "@/lib/format"

const CHART_TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.15)",
} as const

export function ClientMonthlyChart({ data }: { data: Array<{ month: string; total: number }> }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}k` : `R$ ${v}`} />
          <Tooltip formatter={(v: number) => formatBRL(v)} labelFormatter={(l: string) => `Mês: ${l}`} cursor={{ fill: "oklch(0.55 0.15 160 / 0.08)" }} contentStyle={CHART_TOOLTIP_STYLE} />
          <Bar dataKey="total" fill="oklch(0.55 0.15 160)" radius={[6, 6, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
