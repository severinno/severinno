"use client"

/**
 * AdminFinanceDashboard — Financial overview for the admin panel.
 *
 * Data source: GET /api/admin/finance?period=30d&page=1&limit=20
 *
 * Features:
 * - Summary cards: Total received, pending, refunded (with counts)
 * - Period selector: 7d / 30d / 90d / 12m / All
 * - Ticket médio + MRR metric cards
 * - Monthly revenue bar chart (paid only)
 * - MRR trend area chart (6-month window)
 * - Payment method distribution (pie chart)
 * - Monthly ticket average bar chart
 * - Transaction history table with pagination
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
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  ArrowDown,
  ArrowUp,
  Banknote,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CreditCard,
  DollarSign,
  Download,
  Handshake,
  Loader2,
  QrCode,
  Receipt,
  Ticket,
  TrendingDown,
  TrendingUp,
  UserCircle,
  Wallet,
} from "lucide-react"
import { RefreshButton } from "@/components/admin/admin-refresh-button"

import { useRealtimeFinance } from "@/hooks/use-realtime-finance"
import { RealtimeStatusBadge } from "@/components/shared/realtime-status-badge"
import { apiGet } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { PAYMENT_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ErrorState } from "@/components/admin/admin-shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PaymentStatus = "PAID" | "PENDING" | "REFUNDED"
type PaymentMethod = "PIX" | "CARD"
type Period = "7d" | "30d" | "90d" | "12m" | "all"

type FinanceSummary = {
  PAID: { total: number; count: number }
  PENDING: { total: number; count: number }
  REFUNDED: { total: number; count: number }
}

type MonthlyRevenue = {
  month: string
  label: string
  total: number
  count: number
}

type MethodStat = {
  method: string
  total: number
  count: number
}

type TransactionItem = {
  id: string
  bookingId: string
  amount: number
  method: string
  status: string
  transactionId: string | null
  createdAt: string
  updatedAt: string
  lytexId: string | null
  lytexStatus: string | null
  qrCode: string | null
  paidAt: string | null
  booking: {
    id: string
    scheduledAt: string
    status: string
    client: { id: string; name: string; email: string }
    provider: { id: string; name: string }
    service: { id: string; title: string }
  } | null
}

type MrrHistoryItem = {
  month: string
  label: string
  total: number
}

type MrrData = {
  current: number
  previous: number
  growth: number
  history: MrrHistoryItem[]
}

type ProviderStat = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  total: number
  count: number
  commission: number
  net: number
}

type FinanceResponse = {
  summary: FinanceSummary
  monthlyRevenue: MonthlyRevenue[]
  paymentMethods: MethodStat[]
  transactions: TransactionItem[]
  total: number
  page: number
  limit: number
  period: Period
  averageTicket: number
  commissionPercent: number
  providerStats: ProviderStat[]
  mrr: MrrData
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

const PIE_COLORS: Record<PaymentMethod, string> = {
  PIX: "hsl(160, 84%, 39%)",
  CARD: "hsl(221, 83%, 53%)",
}

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.1)",
  padding: "8px 10px",
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminFinanceDashboard() {
  const { isConnected, status } = useRealtimeFinance()

  const [period, setPeriod] = React.useState<Period>("30d")
  const [page, setPage] = React.useState(1)
  const [expandedProviders, setExpandedProviders] = React.useState<Set<string>>(new Set())
  const limit = 15

  // Collapse all when period changes
  React.useEffect(() => {
    setExpandedProviders(new Set())
  }, [period])

  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "finance", period, page],
    queryFn: () =>
      apiGet<FinanceResponse>("/api/admin/finance", {
        period,
        page,
        limit,
      }),
    staleTime: 30_000,
  })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar os dados financeiros"
        description="Verifique sua conexão e tente novamente."
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return <FinanceSkeleton />
  }

  const {
    summary,
    monthlyRevenue,
    paymentMethods,
    transactions,
    total,
    averageTicket,
    commissionPercent,
    providerStats,
    mrr,
  } = data

  const totalPages = Math.max(1, Math.ceil(total / limit))

  // Stat cards
  const statCards: Array<{
    status: PaymentStatus
    icon: typeof Wallet
    label: string
    value: number
    count: number
    accent: "emerald" | "amber" | "rose"
  }> = [
    {
      status: "PAID",
      icon: TrendingUp,
      label: "Recebido",
      value: summary.PAID.total,
      count: summary.PAID.count,
      accent: "emerald",
    },
    {
      status: "PENDING",
      icon: Receipt,
      label: "Pendente",
      value: summary.PENDING.total,
      count: summary.PENDING.count,
      accent: "amber",
    },
    {
      status: "REFUNDED",
      icon: TrendingDown,
      label: "Estornado",
      value: summary.REFUNDED.total,
      count: summary.REFUNDED.count,
      accent: "rose",
    },
  ]

  const grandTotal = summary.PAID.total + summary.PENDING.total
  const mrrUp = mrr.growth >= 0

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Financeiro</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Resumo de transações e faturamento da plataforma
          </p>
          <RealtimeStatusBadge status={status} isConnected={isConnected} className="mt-1.5" />
        </div>

        <div className="flex items-center gap-2">
          <ExportCSVButton period={period} />

          <RefreshButton isFetching={isFetching} onRefresh={() => void refetch()} />

          <div className="bg-muted/50 inline-flex h-8 items-center rounded-lg border p-0.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setPeriod(opt.value)
                  setPage(1)
                }}
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
      <section aria-label="Resumo financeiro" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {statCards.map((card) => (
          <StatCard
            key={card.status}
            icon={card.icon}
            label={card.label}
            value={formatBRL(card.value)}
            count={card.count}
            accent={card.accent}
          />
        ))}
      </section>

      {/* Grand total bar */}
      <div className="border-border/50 to-primary/5 rounded-xl border bg-gradient-to-r from-emerald-500/5 p-4">
        <div className="flex items-center justify-between">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <DollarSign className="size-5 text-emerald-600" />
            <span>Faturamento total (recebido + pendente)</span>
          </div>
          <p className="text-2xl font-bold tabular-nums">{formatBRL(grandTotal)}</p>
        </div>
      </div>

      {/* Charts */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Monthly revenue bar chart */}
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">Faturamento mensal</h2>
            <p className="text-muted-foreground text-xs">Pagamentos confirmados por mês</p>
          </div>
          <div className="p-4">
            <MonthlyRevenueChart data={monthlyRevenue} />
          </div>
        </div>

        {/* MRR trend line chart */}
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">MRR — Receita Recorrente</h2>
            <p className="text-muted-foreground text-xs">Média mensal dos últimos 6 meses</p>
          </div>
          <div className="p-4">
            <MrrTrendChart data={mrr.history} growth={mrr.growth} />
          </div>
        </div>
      </section>

      {/* Payment method + monthly ticket average */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Payment method pie chart */}
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">Forma de pagamento</h2>
            <p className="text-muted-foreground text-xs">Distribuição por método no período</p>
          </div>
          <div className="p-4">
            <PaymentMethodChart data={paymentMethods} />
          </div>
        </div>

        {/* Monthly ticket average chart */}
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">Ticket médio mensal</h2>
            <p className="text-muted-foreground text-xs">Valor médio por transação por mês</p>
          </div>
          <div className="p-4">
            <MonthlyTicketChart data={monthlyRevenue} />
          </div>
        </div>
      </section>

      {/* Per-provider statement */}
      <section>
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <Handshake className="text-muted-foreground size-4" />
              <div>
                <h2 className="text-sm font-semibold">Extrato por prestador</h2>
                <p className="text-muted-foreground text-xs">
                  Comissão da plataforma: {commissionPercent}% · {providerStats.length} prestador
                  {providerStats.length !== 1 ? "es" : ""} com transações no período
                </p>
              </div>
            </div>
            <ExportProvidersCSVButton period={period} />
          </div>

          {providerStats.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
              <Handshake className="text-muted-foreground/30 size-8" />
              <p className="text-muted-foreground text-sm">
                Nenhum prestador com pagamentos no período
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50 h-11">
                    <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                      Prestador
                    </TableHead>
                    <TableHead className="text-muted-foreground text-right text-xs font-semibold tracking-wide uppercase">
                      Transações
                    </TableHead>
                    <TableHead className="text-muted-foreground text-right text-xs font-semibold tracking-wide uppercase">
                      Total recebido
                    </TableHead>
                    <TableHead className="text-muted-foreground text-right text-xs font-semibold tracking-wide uppercase">
                      Comissão ({commissionPercent}%)
                    </TableHead>
                    <TableHead className="text-muted-foreground text-right text-xs font-semibold tracking-wide uppercase">
                      Repasse líquido
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providerStats.map((ps) => {
                    const expanded = expandedProviders.has(ps.id)
                    return (
                      <React.Fragment key={ps.id}>
                        <TableRow
                          className="hover:bg-muted/30 h-14 cursor-pointer transition-colors"
                          onClick={() =>
                            setExpandedProviders((prev) => {
                              const next = new Set(prev)
                              if (next.has(ps.id)) {
                                next.delete(ps.id)
                              } else {
                                next.add(ps.id)
                              }
                              return next
                            })
                          }
                        >
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                className="text-muted-foreground/50 hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded transition-colors"
                                aria-label={expanded ? "Recolher" : "Expandir"}
                              >
                                {expanded ? (
                                  <ChevronUp className="size-4" />
                                ) : (
                                  <ChevronDown className="size-4" />
                                )}
                              </button>
                              <div className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full">
                                <UserCircle className="size-5" />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{ps.name}</p>
                                <p className="text-muted-foreground truncate text-[11px]">
                                  {ps.email}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {ps.count}
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold tabular-nums">
                            {formatBRL(ps.total)}
                          </TableCell>
                          <TableCell className="text-right text-sm text-amber-600 tabular-nums dark:text-amber-400">
                            -{formatBRL(ps.commission)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
                            {formatBRL(ps.net)}
                          </TableCell>
                        </TableRow>
                        {expanded && (
                          <TableRow>
                            <TableCell colSpan={5} className="bg-muted/20 p-0">
                              <ProviderDetail providerId={ps.id} period={period} />
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Summary row */}
          {providerStats.length > 1 && (
            <div className="flex items-center justify-end gap-8 border-t px-5 py-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Total de repasses:</span>
                <span className="font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
                  {formatBRL(providerStats.reduce((s, p) => s + p.net, 0))}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Comissão total:</span>
                <span className="font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                  {formatBRL(providerStats.reduce((s, p) => s + p.commission, 0))}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Transaction history */}
      <section>
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">Histórico de transações</h2>
              <p className="text-muted-foreground text-xs">
                {total} transação{total !== 1 ? "ões" : ""} encontrada{total !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          {transactions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
              <Banknote className="text-muted-foreground/30 size-8" />
              <p className="text-muted-foreground text-sm">Nenhuma transação no período</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50 h-11">
                    <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                      Data
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                      Cliente
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                      Prestador
                    </TableHead>
                    <TableHead className="text-muted-foreground hidden text-xs font-semibold tracking-wide uppercase md:table-cell">
                      Serviço
                    </TableHead>
                    <TableHead className="text-muted-foreground text-right text-xs font-semibold tracking-wide uppercase">
                      Valor
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                      Método
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id} className="hover:bg-muted/30 h-14 transition-colors">
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
                        {formatDateShort(tx.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {tx.booking?.client?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{tx.booking?.provider?.name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground hidden max-w-[160px] truncate text-xs md:table-cell">
                        {tx.booking?.service?.title ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold whitespace-nowrap tabular-nums">
                        {formatBRL(tx.amount)}
                      </TableCell>
                      <TableCell>
                        <MethodBadge method={tx.method as PaymentMethod} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={tx.status as PaymentStatus} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-5 py-3">
              <p className="text-muted-foreground text-xs tabular-nums">
                Página {page} de {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-3.5" />
                  Anterior
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
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
  count,
  accent,
}: {
  icon: typeof Wallet
  label: string
  value: string
  count: number
  accent: "emerald" | "amber" | "rose"
}) {
  const accentStyles: Record<string, string> = {
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
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
        <span className="text-muted-foreground text-xs tabular-nums">
          {count} transação{count !== 1 ? "ões" : ""}
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs font-medium tracking-wider uppercase">
        {label}
      </p>
    </div>
  )
}

function MonthlyRevenueChart({ data }: { data: MonthlyRevenue[] }) {
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
          width={48}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(v: number) => (v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}k` : `R$ ${v}`)}
        />
        <RTooltip
          cursor={{ fill: "hsl(var(--accent) / 0.4)" }}
          formatter={(v: number, _name: string) => [formatBRL(v), "Receita"]}
          labelFormatter={(l: string) => `Mês: ${l}`}
          contentStyle={TOOLTIP_STYLE}
        />
        <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={36} fill="hsl(var(--primary))" />
      </BarChart>
    </ResponsiveContainer>
  )
}

function MrrTrendChart({ data, growth }: { data: MrrHistoryItem[]; growth: number }) {
  if (data.length === 0 || data.every((d) => d.total === 0)) {
    return (
      <div className="text-muted-foreground flex h-[220px] items-center justify-center text-xs">
        Sem dados de MRR no período
      </div>
    )
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
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          interval={0}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(v: number) => (v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}k` : `R$ ${v}`)}
        />
        <RTooltip
          formatter={(v: number) => [formatBRL(v), "MRR"]}
          labelFormatter={(l: string) => `Mês: ${l}`}
          contentStyle={TOOLTIP_STYLE}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke="hsl(270, 67%, 50%)"
          strokeWidth={2}
          fill="url(#mrrGradient)"
          dot={{ r: 3, fill: "hsl(270, 67%, 50%)", stroke: "white", strokeWidth: 2 }}
          activeDot={{ r: 5, fill: "hsl(270, 67%, 50%)", stroke: "white", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function MonthlyTicketChart({ data }: { data: MonthlyRevenue[] }) {
  // Calculate ticket médio per month
  const ticketData = data
    .filter((d) => d.count > 0)
    .map((d) => ({
      ...d,
      average: Math.round(d.total / d.count),
    }))

  if (ticketData.length === 0) {
    return (
      <div className="text-muted-foreground flex h-[220px] items-center justify-center text-xs">
        Sem dados no período
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={ticketData} margin={{ left: -12, right: 0, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          interval={0}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(v: number) => (v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}k` : `R$ ${v}`)}
        />
        <RTooltip
          cursor={{ fill: "hsl(var(--accent) / 0.4)" }}
          formatter={(v: number, n: string) => [
            formatBRL(v),
            n === "average" ? "Ticket médio" : "Receita",
          ]}
          labelFormatter={(l: string) => `Mês: ${l}`}
          contentStyle={TOOLTIP_STYLE}
        />
        <Bar
          dataKey="average"
          radius={[4, 4, 0, 0]}
          maxBarSize={36}
          fill="hsl(190, 85%, 45%)"
          name="average"
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

function PaymentMethodChart({ data }: { data: MethodStat[] }) {
  if (data.length === 0 || data.every((d) => d.total === 0)) {
    return (
      <div className="text-muted-foreground flex h-[220px] items-center justify-center text-xs">
        Sem dados no período
      </div>
    )
  }

  const totalValue = data.reduce((a, d) => a + d.total, 0)

  return (
    <div className="flex items-center gap-6">
      {/* Donut chart */}
      <div className="relative h-[180px] w-[180px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="total"
              nameKey="method"
              innerRadius={54}
              outerRadius={82}
              paddingAngle={2}
              stroke="hsl(var(--background))"
              strokeWidth={2}
            >
              {data.map((d) => (
                <Cell
                  key={d.method}
                  fill={PIE_COLORS[d.method as PaymentMethod] ?? "hsl(var(--muted-foreground))"}
                />
              ))}
            </Pie>
            <RTooltip
              formatter={(v: number, n: string) => [
                formatBRL(v),
                PAYMENT_METHOD_LABELS[n as PaymentMethod] ?? n,
              ]}
              contentStyle={TOOLTIP_STYLE}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-foreground text-lg font-bold tabular-nums">
            {formatBRL(totalValue)}
          </span>
          <span className="text-muted-foreground text-[10px] tracking-wide uppercase">Total</span>
        </div>
      </div>

      {/* Legend */}
      <ul className="flex flex-1 flex-col gap-3">
        {data.map((d) => {
          const method = d.method as PaymentMethod
          const pct = totalValue > 0 ? ((d.total / totalValue) * 100).toFixed(1) : "0"
          return (
            <li key={d.method} className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: PIE_COLORS[method] ?? "hsl(var(--muted-foreground))" }}
              />
              <span className="text-muted-foreground min-w-0 flex-1 text-xs">
                {PAYMENT_METHOD_LABELS[method] ?? method}
              </span>
              <span className="text-foreground text-xs font-medium tabular-nums">
                {formatBRL(d.total)}
              </span>
              <span className="text-muted-foreground text-[11px] tabular-nums">({pct}%)</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function MethodBadge({ method }: { method: PaymentMethod }) {
  const styles: Record<PaymentMethod, string> = {
    PIX: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    CARD: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  }
  const icons: Record<PaymentMethod, typeof QrCode> = {
    PIX: QrCode,
    CARD: CreditCard,
  }
  const Icon = icons[method]

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        styles[method],
      )}
    >
      <Icon className="size-3" />
      {PAYMENT_METHOD_LABELS[method]}
    </span>
  )
}

function StatusBadge({ status }: { status: PaymentStatus }) {
  const styles: Record<PaymentStatus, string> = {
    PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    REFUNDED: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        styles[status],
      )}
    >
      {PAYMENT_STATUS_LABELS[status]}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Provider transactions detail
// ---------------------------------------------------------------------------

type ProviderTxItem = {
  id: string
  bookingId: string
  amount: number
  method: string
  status: string
  createdAt: string
  paidAt: string | null
  lytexId: string | null
  booking: {
    id: string
    scheduledAt: string
    status: string
    client: { id: string; name: string; email: string }
    service: { id: string; title: string }
  } | null
}

type ProviderTxResponse = {
  transactions: ProviderTxItem[]
  summary: {
    transactions: number
    total: number
    commission: number
    net: number
  }
}

function ProviderDetail({ providerId, period }: { providerId: string; period: Period }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "finance", "provider", providerId, period],
    queryFn: () =>
      apiGet<ProviderTxResponse>("/api/admin/finance/provider-transactions", {
        providerId,
        period,
      }),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 px-5 py-6">
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
        <span className="text-muted-foreground text-xs">Carregando transações…</span>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="text-muted-foreground px-5 py-4 text-center text-xs">
        Não foi possível carregar as transações.
      </div>
    )
  }

  if (data.transactions.length === 0) {
    return (
      <div className="text-muted-foreground px-5 py-4 text-center text-xs">
        Nenhuma transação encontrada para este prestador no período.
      </div>
    )
  }

  return (
    <div className="px-2 pt-1 pb-3">
      <div className="border-border/30 overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30 h-9">
              <TableHead className="text-muted-foreground px-3 text-[10px] font-semibold tracking-wide uppercase">
                Data
              </TableHead>
              <TableHead className="text-muted-foreground px-3 text-[10px] font-semibold tracking-wide uppercase">
                Cliente
              </TableHead>
              <TableHead className="text-muted-foreground hidden px-3 text-[10px] font-semibold tracking-wide uppercase sm:table-cell">
                Serviço
              </TableHead>
              <TableHead className="text-muted-foreground px-3 text-right text-[10px] font-semibold tracking-wide uppercase">
                Valor
              </TableHead>
              <TableHead className="text-muted-foreground px-3 text-[10px] font-semibold tracking-wide uppercase">
                Método
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.transactions.map((tx) => (
              <TableRow key={tx.id} className="hover:bg-muted/20 h-10 transition-colors">
                <TableCell className="text-muted-foreground px-3 text-[11px] whitespace-nowrap tabular-nums">
                  {formatDateShort(tx.createdAt)}
                </TableCell>
                <TableCell className="px-3 text-[11px] font-medium">
                  {tx.booking?.client?.name ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground hidden max-w-[140px] truncate px-3 text-[11px] sm:table-cell">
                  {tx.booking?.service?.title ?? "—"}
                </TableCell>
                <TableCell className="px-3 text-right text-[11px] font-semibold whitespace-nowrap tabular-nums">
                  {formatBRL(tx.amount)}
                </TableCell>
                <TableCell className="px-3">
                  <MethodBadge method={tx.method as PaymentMethod} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mini summary */}
      <div className="flex items-center justify-end gap-4 px-3 pt-2">
        <span className="text-muted-foreground text-[10px]">
          {data.summary.transactions} transação{data.summary.transactions !== 1 ? "ões" : ""}
        </span>
        <span className="text-muted-foreground text-[10px]">
          Total: <span className="font-semibold">{formatBRL(data.summary.total)}</span>
        </span>
        <span className="text-[10px] text-amber-600 dark:text-amber-400">
          Comissão: -{formatBRL(data.summary.commission)}
        </span>
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
          Repasse: <span className="font-semibold">{formatBRL(data.summary.net)}</span>
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export CSV buttons
// ---------------------------------------------------------------------------

function ExportProvidersCSVButton({ period }: { period: Period }) {
  const [exporting, setExporting] = React.useState(false)

  const handleExport = React.useCallback(async () => {
    setExporting(true)
    try {
      const res = await fetch(`/api/admin/finance/export-providers?period=${period}`)
      if (!res.ok) throw new Error("Falha ao exportar")

      const blob = await res.blob()
      const disposition = res.headers.get("content-disposition")
      const match = disposition?.match(/filename="?([^";]+)"?/)
      const filename = match?.[1] ?? `extrato-prestadores-${period}.csv`

      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.warn("[CSV Export] Falha ao baixar extrato de prestadores:", err)
    } finally {
      setExporting(false)
    }
  }, [period])

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 text-xs"
      onClick={handleExport}
      disabled={exporting}
      aria-label="Exportar CSV de prestadores"
    >
      <Download className="size-3.5" />
      {exporting ? "Exportando…" : "Exportar CSV"}
    </Button>
  )
}

function ExportCSVButton({ period }: { period: Period }) {
  const [exporting, setExporting] = React.useState(false)

  const handleExport = React.useCallback(async () => {
    setExporting(true)
    try {
      const res = await fetch(`/api/admin/finance/export?period=${period}`)
      if (!res.ok) throw new Error("Falha ao exportar")

      const blob = await res.blob()

      // Use server-provided filename or fallback
      const disposition = res.headers.get("content-disposition")
      const match = disposition?.match(/filename="?([^";]+)"?/)
      const filename = match?.[1] ?? `transacoes-${period}.csv`

      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.warn("[CSV Export] Falha ao baixar o arquivo:", err)
    } finally {
      setExporting(false)
    }
  }, [period])

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 text-xs"
      onClick={handleExport}
      disabled={exporting}
      aria-label="Exportar CSV"
    >
      <Download className="size-3.5" />
      {exporting ? "Exportando…" : "Exportar CSV"}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  } catch {
    return iso
  }
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function FinanceSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-72 rounded-lg" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border-border/50 bg-card rounded-xl border p-5">
            <div className="flex items-center justify-between">
              <Skeleton className="size-10 rounded-lg" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="mt-3 h-7 w-28" />
            <Skeleton className="mt-1 h-3 w-16" />
          </div>
        ))}
      </div>

      <Skeleton className="h-16 rounded-xl" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="border-border/50 bg-card rounded-xl border">
            <div className="border-b px-5 py-4">
              <Skeleton className="h-4 w-44" />
            </div>
            <div className="p-4">
              <Skeleton className="h-[220px] w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>

      <div className="border-border/50 bg-card rounded-xl border">
        <div className="border-b px-5 py-4">
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="mb-2 h-14 w-full rounded-md" />
          ))}
        </div>
      </div>
    </div>
  )
}
