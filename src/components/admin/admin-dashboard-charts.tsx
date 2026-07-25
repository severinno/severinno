"use client"

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts"
import { formatBRL } from "@/lib/format"


type PaymentStatus = "PAID" | "PENDING" | "REFUNDED"

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.1)",
  padding: "8px 10px",
}

const PIE_COLORS: Record<PaymentStatus, string> = {
  PAID: "hsl(160, 84%, 39%)",
  PENDING: "hsl(38, 92%, 50%)",
  REFUNDED: "hsl(240, 6%, 50%)",
}

export function BarChartSection({ data }: { data: Array<{ status: string; label: string; count: number }> }) {
  if (data.every((d) => d.count === 0)) {
    return <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">Sem dados</div>
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
        <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
        <RTooltip cursor={{ fill: "hsl(var(--accent) / 0.4)" }} formatter={(v: number, _name: string, props: { payload?: { label?: string } }) => [`${v} agendamentos`, props.payload?.label ?? _name]} contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={32}>
          {data.map((d) => (<Cell key={d.status} fill={d.count > 0 ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.1)"} />))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function PieChartSection({ data }: { data: Array<{ status: PaymentStatus; label: string; value: number }> }) {
  if (data.length === 0) {
    return <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">Sem dados</div>
  }
  return (
    <div className="flex items-center gap-6">
      <div className="relative h-[180px] w-[180px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius={54} outerRadius={82} paddingAngle={2} stroke="hsl(var(--background))" strokeWidth={2}>
              {data.map((d) => (<Cell key={d.status} fill={PIE_COLORS[d.status]} />))}
            </Pie>
            <RTooltip formatter={(v: number, n: string) => [formatBRL(v), n]} contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold tabular-nums text-foreground">{formatBRL(data.reduce((a, d) => a + d.value, 0))}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</span>
        </div>
      </div>
      <ul className="flex flex-1 flex-col gap-2">
        {data.map((d) => (
          <li key={d.status} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: PIE_COLORS[d.status] }} />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{d.label}</span>
            <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">{formatBRL(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
