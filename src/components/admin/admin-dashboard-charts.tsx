"use client"

import * as React from "react"
import {
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
import type { BookingStatus, PaymentStatus } from "@/lib/constants"
import { TOOLTIP_STYLE } from "./admin-chart-theme"
import { PIE_COLORS } from "./admin-dashboard-types"

// ---------------------------------------------------------------------------
// Bar Chart — Bookings by status
// ---------------------------------------------------------------------------

export function BarChartSection({
  data,
}: {
  data: Array<{ status: BookingStatus; label: string; count: number }>
}) {
  if (data.every((d) => d.count === 0)) {
    return (
      <div className="text-muted-foreground flex h-[220px] items-center justify-center text-xs">
        Sem dados
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          allowDecimals={false}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
        />
        <RTooltip
          cursor={{ fill: "hsl(var(--accent) / 0.4)" }}
          formatter={(v: number, _name: string, props: { payload?: { label?: string } }) => [
            `${v} agendamentos`,
            props.payload?.label ?? _name,
          ]}
          contentStyle={TOOLTIP_STYLE}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={32}>
          {data.map((d) => (
            <Cell
              key={d.status}
              fill={d.count > 0 ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.1)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------------------
// Pie Chart — Revenue by payment status
// ---------------------------------------------------------------------------

export function PieChartSection({
  data,
}: {
  data: Array<{ status: PaymentStatus; label: string; value: number }>
}) {
  if (data.length === 0) {
    return (
      <div className="text-muted-foreground flex h-[220px] items-center justify-center text-xs">
        Sem dados
      </div>
    )
  }

  return (
    <div className="flex items-center gap-6">
      <div className="relative h-[180px] w-[180px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius={54}
              outerRadius={82}
              paddingAngle={2}
              stroke="hsl(var(--background))"
              strokeWidth={2}
            >
              {data.map((d) => (
                <Cell key={d.status} fill={PIE_COLORS[d.status]} />
              ))}
            </Pie>
            <RTooltip
              formatter={(v: number, n: string) => [formatBRL(v), n]}
              contentStyle={TOOLTIP_STYLE}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-foreground text-lg font-bold tabular-nums">
            {formatBRL(data.reduce((a, d) => a + d.value, 0))}
          </span>
          <span className="text-muted-foreground text-[10px] tracking-wide uppercase">Total</span>
        </div>
      </div>
      <ul className="flex flex-1 flex-col gap-2">
        {data.map((d) => (
          <li key={d.status} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: PIE_COLORS[d.status] }}
            />
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{d.label}</span>
            <span className="text-foreground shrink-0 text-xs font-medium tabular-nums">
              {formatBRL(d.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
