"use client"

/**
 * AdminGatewayDashboard — Gateway de pagamento dashboard.
 *
 * Data source: GET /api/admin/gateway/stats?period=30d
 *
 * Features:
 * - Summary cards: Total volume, paid, conversion rate, average ticket
 * - Revenue by status (donut chart)
 * - Monthly volume bar chart
 * - Transaction volume over time (area chart)
 * - Conversion rate trend (line chart)
 * - Payment method distribution
 * - Stats table
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Banknote, DollarSign, Loader2, Percent, RotateCw, TrendingUp, Zap } from "lucide-react"

import { apiGet } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ErrorState, TableSkeleton } from "./_shared"
import { TOOLTIP_STYLE } from "./admin-chart-theme"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = "7d" | "30d" | "90d" | "12m" | "all"

type StatusStat = {
  status: string
  total: number // in cents
  count: number
}

type MonthlyItem = {
  month: string
  label: string
  total: number
  count: number
  paid: number
  paidCount: number
}

type MethodStat = {
  method: string
  total: number
  count: number
}

type TrendItem = {
  month: string
  label: string
  conversion: number
  volume: number
  transactions: number
}

type GatewayStatsResponse = {
  period: Period
  totalVolume: number
  totalCount: number
  paidCount: number
  conversionRate: number
  averageTicket: number
  byStatus: StatusStat[]
  monthly: MonthlyItem[]
  methodDistribution: MethodStat[]
  trend: TrendItem[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "12m", label: "12 meses" },
  { value: "all", label: "Todo período" },
]

const STATUS_PIE_COLORS: Record<string, string> = {
  paid: "hsl(160, 84%, 39%)",
  waitingPayment: "hsl(38, 92%, 50%)",
  expired: "hsl(0, 72%, 51%)",
  canceled: "hsl(215, 16%, 47%)",
  refunded: "hsl(271, 81%, 56%)",
  chargeback: "hsl(346, 77%, 50%)",
  overdue: "hsl(20, 90%, 48%)",
  processing: "hsl(221, 83%, 53%)",
}

const STATUS_LABELS: Record<string, string> = {
  paid: "Pago",
  waitingPayment: "Aguardando",
  expired: "Expirado",
  canceled: "Cancelado",
  refunded: "Estornado",
  chargeback: "Chargeback",
  overdue: "Vencido",
  processing: "Processando",
}

const CHART_COLORS = [
  "hsl(160, 84%, 39%)",
  "hsl(221, 83%, 53%)",
  "hsl(271, 81%, 56%)",
  "hsl(38, 92%, 50%)",
  "hsl(346, 77%, 50%)",
  "hsl(215, 16%, 47%)",
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100)
}

function formatCompactBRL(cents: number): string {
  const value = cents / 100
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}k`
  return formatBRL(cents)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminGatewayDashboard() {
  const [period, setPeriod] = React.useState<Period>("30d")

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["admin", "gateway", "stats", period],
    queryFn: () => apiGet<GatewayStatsResponse>("/api/admin/gateway/stats", { period }),
    staleTime: 30_000,
  })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar os dados do gateway"
        description="Verifique a conexão com a API Lytex e tente novamente."
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <div className="bg-muted h-8 w-48 animate-pulse rounded" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-muted h-28 animate-pulse rounded-xl" />
          ))}
        </div>
        <TableSkeleton rows={6} cols={4} />
      </div>
    )
  }

  const {
    totalVolume,
    totalCount,
    paidCount,
    conversionRate,
    averageTicket,
    byStatus,
    monthly,
    methodDistribution,
    trend,
  } = data

  // Paid value from actual data (more accurate than proportional)
  const paidTotalValue = byStatus.find((s) => s.status === "paid")?.total ?? 0

  // Compute chart-friendly byStatus (exclude statuses with 0 count)
  const statusChartData = byStatus.filter((s) => s.count > 0)

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Gateway de Pagamento</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Métricas agregadas do Lytex — receita, volume de transações e conversão
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isFetching && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Atualizar"
          >
            <RotateCw className={cn("size-4", isFetching && "animate-spin")} />
          </Button>

          <div className="bg-muted/50 inline-flex h-8 items-center rounded-lg border p-0.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPeriod(opt.value)}
                className={cn(
                  "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
                  period === opt.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <section
        aria-label="Métricas do gateway"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          icon={DollarSign}
          label="Volume total"
          value={formatBRL(totalVolume)}
          sub={`${totalCount} fatura${totalCount !== 1 ? "s" : ""}`}
          accent="emerald"
        />
        <StatCard
          icon={TrendingUp}
          label="Pagas"
          value={formatBRL(paidTotalValue)}
          sub={`${paidCount} de ${totalCount} fatura${totalCount !== 1 ? "s" : ""}`}
          accent="primary"
        />
        <StatCard
          icon={Percent}
          label="Taxa de conversão"
          value={`${conversionRate}%`}
          sub={`${paidCount} pagas / ${totalCount} total`}
          accent="violet"
        />
        <StatCard
          icon={Zap}
          label="Ticket médio"
          value={formatBRL(averageTicket)}
          sub="por transação"
          accent="cyan"
        />
      </section>

      {/* Charts row 1: Monthly volume + Status distribution */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Monthly volume bar chart */}
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">Volume mensal</h2>
            <p className="text-muted-foreground text-xs">Valor total das faturas geradas por mês</p>
          </div>
          <div className="p-4">
            <MonthlyVolumeChart data={monthly} />
          </div>
        </div>

        {/* Status distribution donut */}
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">Distribuição por status</h2>
            <p className="text-muted-foreground text-xs">
              Volume financeiro agregado por status da fatura
            </p>
          </div>
          <div className="p-4">
            <StatusPieChart data={statusChartData} />
          </div>
        </div>
      </section>

      {/* Charts row 2: Transaction volume + Conversion trend */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Transaction volume area chart */}
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">Volume de transações</h2>
            <p className="text-muted-foreground text-xs">
              Quantidade de transações ao longo do tempo
            </p>
          </div>
          <div className="p-4">
            <TransactionVolumeChart data={monthly} />
          </div>
        </div>

        {/* Conversion rate trend line chart */}
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">Conversão ao longo do tempo</h2>
            <p className="text-muted-foreground text-xs">
              Taxa de conversão (pagas / total) por mês
            </p>
          </div>
          <div className="p-4">
            <ConversionTrendChart data={trend} />
          </div>
        </div>
      </section>

      {/* Payment method distribution + Detailed table */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Payment method bar chart */}
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">Métodos de pagamento</h2>
            <p className="text-muted-foreground text-xs">Volume por método de pagamento</p>
          </div>
          <div className="p-4">
            <MethodChart data={methodDistribution} />
          </div>
        </div>

        {/* Status breakdown table */}
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">Detalhamento por status</h2>
            <p className="text-muted-foreground text-xs">
              Volume e quantidade por status da fatura
            </p>
          </div>
          <div className="overflow-x-auto p-4 pt-2">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="pb-2 font-semibold tracking-wide uppercase">Status</th>
                  <th className="pb-2 text-right font-semibold tracking-wide uppercase">Faturas</th>
                  <th className="pb-2 text-right font-semibold tracking-wide uppercase">Volume</th>
                  <th className="pb-2 text-right font-semibold tracking-wide uppercase">%</th>
                </tr>
              </thead>
              <tbody>
                {byStatus.map((s) => {
                  const pct = totalVolume > 0 ? ((s.total / totalVolume) * 100).toFixed(1) : "0"
                  return (
                    <tr key={s.status} className="border-border/30 border-b last:border-0">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor:
                                STATUS_PIE_COLORS[s.status] ?? "hsl(var(--muted-foreground))",
                            }}
                          />
                          <span className="font-medium">{STATUS_LABELS[s.status] ?? s.status}</span>
                        </div>
                      </td>
                      <td className="text-muted-foreground py-2.5 text-right tabular-nums">
                        {s.count}
                      </td>
                      <td className="py-2.5 text-right font-semibold tabular-nums">
                        {formatCompactBRL(s.total)}
                      </td>
                      <td className="text-muted-foreground py-2.5 text-right tabular-nums">
                        {pct}%
                      </td>
                    </tr>
                  )
                })}
                {/* Total row */}
                <tr className="font-semibold">
                  <td className="text-foreground pt-2.5">Total</td>
                  <td className="pt-2.5 text-right tabular-nums">{totalCount}</td>
                  <td className="text-foreground pt-2.5 text-right tabular-nums">
                    {formatCompactBRL(totalVolume)}
                  </td>
                  <td className="pt-2.5 text-right tabular-nums">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Summary quick stats */}
      <div className="border-border/50 from-primary/5 rounded-xl border bg-gradient-to-r to-emerald-500/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Banknote className="text-primary size-5" />
            <span>Resumo do período:</span>
          </div>
          <div className="flex flex-wrap gap-6">
            <div className="text-center">
              <p className="text-lg font-bold tabular-nums">{formatCompactBRL(totalVolume)}</p>
              <p className="text-muted-foreground text-[10px] tracking-wide uppercase">
                Volume total
              </p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold tabular-nums">{totalCount}</p>
              <p className="text-muted-foreground text-[10px] tracking-wide uppercase">Faturas</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold tabular-nums">{conversionRate}%</p>
              <p className="text-muted-foreground text-[10px] tracking-wide uppercase">Conversão</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold tabular-nums">
                {formatCompactBRL(averageTicket * 100)}
              </p>
              <p className="text-muted-foreground text-[10px] tracking-wide uppercase">
                Ticket médio
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof DollarSign
  label: string
  value: string
  sub: string
  accent: "emerald" | "primary" | "violet" | "cyan"
}) {
  const accentStyles: Record<string, string> = {
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    primary: "bg-primary/10 text-primary",
    violet: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  }

  return (
    <div className="border-border/50 bg-card hover:border-primary/20 rounded-xl border p-5 transition-colors">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex size-10 items-center justify-center rounded-lg",
            accentStyles[accent],
          )}
        >
          <Icon className="size-5" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-0.5 text-xs font-medium tracking-wider uppercase">
        {label}
      </p>
      <p className="text-muted-foreground/70 mt-0.5 text-[10px]">{sub}</p>
    </div>
  )
}

function MonthlyVolumeChart({ data }: { data: MonthlyItem[] }) {
  if (data.length === 0 || data.every((d) => d.total === 0)) {
    return (
      <div className="text-muted-foreground flex h-[220px] items-center justify-center text-xs">
        Sem dados no período
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
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          interval={data.length > 12 ? 1 : 0}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(v: number) => formatCompactBRL(v)}
        />
        <RTooltip
          cursor={{ fill: "hsl(var(--accent) / 0.4)" }}
          formatter={(v: number) => [formatBRL(v), "Volume"]}
          labelFormatter={(l: string) => `Mês: ${l}`}
          contentStyle={TOOLTIP_STYLE}
        />
        <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={36} fill="hsl(var(--primary))" />
      </BarChart>
    </ResponsiveContainer>
  )
}

function StatusPieChart({ data }: { data: StatusStat[] }) {
  if (data.length === 0) {
    return (
      <div className="text-muted-foreground flex h-[220px] items-center justify-center text-xs">
        Sem dados no período
      </div>
    )
  }

  const totalValue = data.reduce((a, d) => a + d.total, 0)

  return (
    <div className="flex items-center gap-6">
      <div className="relative h-[180px] w-[180px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="total"
              nameKey="status"
              innerRadius={54}
              outerRadius={82}
              paddingAngle={2}
              stroke="hsl(var(--background))"
              strokeWidth={2}
            >
              {data.map((d) => (
                <Cell
                  key={d.status}
                  fill={STATUS_PIE_COLORS[d.status] ?? "hsl(var(--muted-foreground))"}
                />
              ))}
            </Pie>
            <RTooltip
              formatter={(v: number, n: string) => [formatBRL(v), STATUS_LABELS[n] ?? n]}
              contentStyle={TOOLTIP_STYLE}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold tabular-nums">{formatCompactBRL(totalValue)}</span>
          <span className="text-muted-foreground text-[10px] tracking-wide uppercase">Total</span>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-2">
        {data.map((d) => {
          const pct = totalValue > 0 ? ((d.total / totalValue) * 100).toFixed(1) : "0"
          return (
            <li key={d.status} className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: STATUS_PIE_COLORS[d.status] ?? "hsl(var(--muted-foreground))",
                }}
              />
              <span className="text-muted-foreground min-w-0 flex-1 text-xs">
                {STATUS_LABELS[d.status] ?? d.status}
              </span>
              <span className="text-foreground text-xs font-medium tabular-nums">
                {formatCompactBRL(d.total)}
              </span>
              <span className="text-muted-foreground text-[11px] tabular-nums">({pct}%)</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function TransactionVolumeChart({ data }: { data: MonthlyItem[] }) {
  if (data.length === 0 || data.every((d) => d.count === 0)) {
    return (
      <div className="text-muted-foreground flex h-[220px] items-center justify-center text-xs">
        Sem dados no período
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ left: -12, right: 0, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="txVolume" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(190, 85%, 45%)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="hsl(190, 85%, 45%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          interval={data.length > 12 ? 1 : 0}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={32}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
        />
        <RTooltip
          formatter={(v: number, n: string) => [v, n === "count" ? "Transações" : "Valor"]}
          labelFormatter={(l: string) => `Mês: ${l}`}
          contentStyle={TOOLTIP_STYLE}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="hsl(190, 85%, 45%)"
          strokeWidth={2}
          fill="url(#txVolume)"
          dot={{ r: 3, fill: "hsl(190, 85%, 45%)", stroke: "white", strokeWidth: 2 }}
          activeDot={{ r: 5, fill: "hsl(190, 85%, 45%)", stroke: "white", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function ConversionTrendChart({ data }: { data: TrendItem[] }) {
  if (data.length === 0 || data.every((d) => d.conversion === 0)) {
    return (
      <div className="text-muted-foreground flex h-[220px] items-center justify-center text-xs">
        Sem dados no período
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ left: -12, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          interval={data.length > 12 ? 1 : 0}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={36}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(v: number) => `${v}%`}
          domain={[0, 100]}
        />
        <RTooltip
          formatter={(v: number) => [`${v}%`, "Conversão"]}
          labelFormatter={(l: string) => `Mês: ${l}`}
          contentStyle={TOOLTIP_STYLE}
        />
        <Line
          type="monotone"
          dataKey="conversion"
          stroke="hsl(271, 81%, 56%)"
          strokeWidth={2}
          dot={{ r: 3, fill: "hsl(271, 81%, 56%)", stroke: "white", strokeWidth: 2 }}
          activeDot={{ r: 5, fill: "hsl(271, 81%, 56%)", stroke: "white", strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function MethodChart({ data }: { data: MethodStat[] }) {
  if (data.length === 0 || data.every((d) => d.total === 0)) {
    return (
      <div className="text-muted-foreground flex h-[220px] items-center justify-center text-xs">
        Sem dados no período
      </div>
    )
  }

  const totalValue = data.reduce((a, d) => a + d.total, 0)

  return (
    <div className="flex flex-col gap-4">
      {/* Horizontal bar for each method */}
      <div className="space-y-3">
        {data.map((d, i) => {
          const pct = totalValue > 0 ? (d.total / totalValue) * 100 : 0
          return (
            <div key={d.method} className="flex items-center gap-3">
              <span className="text-muted-foreground w-20 text-xs font-medium">{d.method}</span>
              <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max(pct, 2)}%`,
                    backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                  }}
                />
              </div>
              <span className="text-foreground w-24 text-right text-xs font-medium tabular-nums">
                {formatCompactBRL(d.total)}
              </span>
              <span className="text-muted-foreground w-12 text-right text-[11px] tabular-nums">
                {pct.toFixed(1)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
