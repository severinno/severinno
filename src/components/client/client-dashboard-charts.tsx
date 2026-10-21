"use client"

import * as React from "react"
import { TrendingUp, Wallet } from "lucide-react"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts"

import { Card, CardContent } from "@/components/ui/card"
import { formatBRL } from "@/lib/format"

// Emerald family palette for the category donut.
export const PIE_COLORS = [
  "var(--chart-1)", // emerald-600
  "oklch(0.7 0.16 162)", // emerald-400
  "oklch(0.62 0.12 184)", // teal-400
  "oklch(0.6 0.13 200)", // teal-500
  "oklch(0.55 0.14 215)", // cyan-600
  "oklch(0.75 0.15 140)", // lime-500
  "oklch(0.68 0.14 85)", // amber-500
  "oklch(0.62 0.18 350)", // rose-500
] as const

export const CHART_TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 8px 24px -4px rgb(0 0 0 / 0.12)",
} as const

export interface ClientDashboardChartsProps {
  monthlyData: Array<{ label: string; total: number }>
  spendingByCategory: Array<{ name: string; value: number }>
}

export function ClientDashboardCharts({
  monthlyData,
  spendingByCategory,
}: ClientDashboardChartsProps) {
  return (
    <div className="grid gap-5 lg:grid-cols-5">
      {/* Monthly bookings */}
      <Card className="border-border/60 bg-card rounded-2xl border shadow-2xs lg:col-span-3">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="bg-primary/10 text-primary border-primary/20 flex size-8 items-center justify-center rounded-xl border shadow-2xs">
                <TrendingUp className="size-4" />
              </span>
              <div>
                <p className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                  Evolução de Agendamentos
                </p>
                <p className="text-foreground text-sm font-bold">
                  Histórico mensal (últimos 6 meses)
                </p>
              </div>
            </div>
          </div>
          <div className="h-56 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-bookings" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                  allowDecimals={false}
                />
                <Tooltip
                  formatter={(v: number) => [`${v} agendamento${v !== 1 ? "s" : ""}`, "Total"]}
                  cursor={{ stroke: "var(--primary)", strokeWidth: 1, strokeDasharray: "3 3" }}
                  contentStyle={CHART_TOOLTIP_STYLE}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="var(--primary)"
                  strokeWidth={2.5}
                  fill="url(#grad-bookings)"
                  activeDot={{
                    r: 5,
                    fill: "var(--primary)",
                    stroke: "var(--background)",
                    strokeWidth: 2,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Spending per category pie */}
      <Card className="border-border/60 bg-card rounded-2xl border shadow-2xs lg:col-span-2">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="bg-primary/10 text-primary border-primary/20 flex size-8 items-center justify-center rounded-xl border shadow-2xs">
                <Wallet className="size-4" />
              </span>
              <div>
                <p className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                  Distribuição de Gastos
                </p>
                <p className="text-foreground text-sm font-bold">Por categoria de serviço</p>
              </div>
            </div>
          </div>
          {spendingByCategory.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center gap-2 text-center">
              <span className="bg-muted text-muted-foreground border-border/50 flex size-12 items-center justify-center rounded-2xl border">
                <Wallet className="size-5" />
              </span>
              <p className="text-muted-foreground text-sm font-medium">
                Sem gastos confirmados ainda.
              </p>
              <p className="text-muted-foreground/75 max-w-xs text-xs">
                Quando você concluir e pagar por serviços, a distribuição por categoria aparecerá
                aqui.
              </p>
            </div>
          ) : (
            <div className="h-48 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={spendingByCategory}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    stroke="var(--background)"
                    strokeWidth={2}
                  >
                    {spendingByCategory.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number, n: string) => [formatBRL(v), n]}
                    contentStyle={CHART_TOOLTIP_STYLE}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          {spendingByCategory.length > 0 ? (
            <ul className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {spendingByCategory.slice(0, 6).map((c, i) => (
                <li key={c.name} className="flex items-center gap-2 text-xs">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      background: PIE_COLORS[i % PIE_COLORS.length],
                    }}
                  />
                  <span className="text-muted-foreground truncate">{c.name}</span>
                  <span className="text-foreground ml-auto shrink-0 font-bold tabular-nums">
                    {formatBRL(c.value)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
