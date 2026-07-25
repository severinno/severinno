"use client"

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { formatBRL } from "@/lib/format"
import { PAYMENT_METHOD_LABELS } from "@/lib/constants"

type PaymentMethod = "PIX" | "CARD"

type MonthlyRevenue = { month: string; label: string; total: number; count: number }
type MrrHistoryItem = { month: string; label: string; total: number }
type MethodStat = { method: string; total: number; count: number }

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.1)",
  padding: "8px 10px",
}

const PIE_COLORS: Record<PaymentMethod, string> = {
  PIX: "hsl(160, 84%, 39%)",
  CARD: "hsl(221, 83%, 53%)",
}

export function MonthlyRevenueChart({ data }: { data: MonthlyRevenue[] }) {
  if (data.length === 0 || data.every((d) => d.total === 0)) {
    return <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">Sem dados no período</div>
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={data.length > 12 ? 1 : 0} />
        <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}k` : `R$ ${v}`} />
        <RTooltip cursor={{ fill: "hsl(var(--accent) / 0.4)" }} formatter={(v: number) => [formatBRL(v), "Receita"]} labelFormatter={(l: string) => `Mês: ${l}`} contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={36} fill="hsl(var(--primary))" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function MrrTrendChart({ data }: { data: MrrHistoryItem[] }) {
  if (data.length === 0 || data.every((d) => d.total === 0)) {
    return <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">Sem dados de MRR no período</div>
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ left: -12, right: 0, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="mrrGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(270, 67%, 50%)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="hsl(270, 67%, 50%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={0} />
        <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}k` : `R$ ${v}`} />
        <RTooltip formatter={(v: number) => [formatBRL(v), "MRR"]} labelFormatter={(l: string) => `Mês: ${l}`} contentStyle={TOOLTIP_STYLE} />
        <Area type="monotone" dataKey="total" stroke="hsl(270, 67%, 50%)" strokeWidth={2} fill="url(#mrrGradient)" dot={{ r: 3, fill: "hsl(270, 67%, 50%)", stroke: "white", strokeWidth: 2 }} activeDot={{ r: 5, fill: "hsl(270, 67%, 50%)", stroke: "white", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function MonthlyTicketChart({ data }: { data: MonthlyRevenue[] }) {
  const ticketData = data.filter((d) => d.count > 0).map((d) => ({ ...d, average: Math.round(d.total / d.count) }))
  if (ticketData.length === 0) {
    return <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">Sem dados no período</div>
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={ticketData} margin={{ left: -12, right: 0, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={0} />
        <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}k` : `R$ ${v}`} />
        <RTooltip cursor={{ fill: "hsl(var(--accent) / 0.4)" }} formatter={(v: number, n: string) => [formatBRL(v), n === "average" ? "Ticket médio" : "Receita"]} labelFormatter={(l: string) => `Mês: ${l}`} contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="average" radius={[4, 4, 0, 0]} maxBarSize={36} fill="hsl(190, 85%, 45%)" name="average" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function PaymentMethodChart({ data }: { data: MethodStat[] }) {
  if (data.length === 0 || data.every((d) => d.total === 0)) {
    return <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">Sem dados no período</div>
  }
  const totalValue = data.reduce((a, d) => a + d.total, 0)
  return (
    <div className="flex items-center gap-6">
      <div className="relative h-[180px] w-[180px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="total" nameKey="method" innerRadius={54} outerRadius={82} paddingAngle={2} stroke="hsl(var(--background))" strokeWidth={2}>
              {data.map((d) => (<Cell key={d.method} fill={PIE_COLORS[d.method as PaymentMethod] ?? "hsl(var(--muted-foreground))"} />))}
            </Pie>
            <RTooltip formatter={(v: number, n: string) => [formatBRL(v), PAYMENT_METHOD_LABELS[n as PaymentMethod] ?? n]} contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold tabular-nums text-foreground">{formatBRL(totalValue)}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</span>
        </div>
      </div>
      <ul className="flex flex-1 flex-col gap-3">
        {data.map((d) => {
          const method = d.method as PaymentMethod
          const pct = totalValue > 0 ? ((d.total / totalValue) * 100).toFixed(1) : "0"
          return (
            <li key={d.method} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: PIE_COLORS[method] ?? "hsl(var(--muted-foreground))" }} />
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">{PAYMENT_METHOD_LABELS[method] ?? method}</span>
              <span className="text-xs font-medium tabular-nums text-foreground">{formatBRL(d.total)}</span>
              <span className="text-[11px] text-muted-foreground tabular-nums">({pct}%)</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
