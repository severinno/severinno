"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { eachMonthOfInterval, format, isSameMonth, startOfYear, endOfMonth } from "date-fns"
import { ptBR } from "date-fns/locale"
import {
  CheckCircle2,
  Clock,
  CreditCard,
  RotateCcw,
  ShieldCheck,
  Wallet,
  XCircle,
  SlidersHorizontal,
} from "lucide-react"

import { useRealtimeFinance } from "@/hooks/use-realtime-finance"
import { RealtimeStatusBadge } from "@/components/shared/realtime-status-badge"
import { apiGet } from "@/lib/api"
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/constants"
import { formatBRL, formatDate } from "@/lib/format"
import { useAuthStore } from "@/store/auth"

import { ProviderWallet } from "./provider-wallet"
import { ProviderFiscalBatchExport } from "./provider-fiscal-batch-export"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Booking = {
  id: string
  scheduledAt: string
  status: string
  amount: number
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  service: { id: string; title: string }
  client: { id: string; name: string; avatarUrl?: string | null }
  payment?: { id: string; status: string; method: string } | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(name?: string) {
  if (!name) return "?"
  return name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("")
}

const PAY_BADGE_STYLES: Record<PaymentStatus, string> = {
  PENDING:
    "border-amber-200 bg-amber-50/60 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  AUTHORIZED:
    "border-blue-200 bg-blue-50/60 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  HELD: "border-indigo-200 bg-indigo-50/60 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
  PAID: "border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  REFUNDED:
    "border-rose-200 bg-rose-50/60 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  FAILED:
    "border-rose-200 bg-rose-50/60 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
}

function PayStatusBadge({ status }: { status: PaymentStatus }) {
  const Icon =
    status === "PAID"
      ? CheckCircle2
      : status === "HELD" || status === "AUTHORIZED"
        ? ShieldCheck
        : status === "PENDING"
          ? Clock
          : RotateCcw
  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium shadow-none",
        PAY_BADGE_STYLES[status],
      )}
    >
      <Icon className="size-3" />
      {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  )
}

const CHART_TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 8px 24px -4px rgb(0 0 0 / 0.15)",
} as const

// ---------------------------------------------------------------------------
// Stat card — Nielsen #8 (Aesthetic and minimalist design)
// ---------------------------------------------------------------------------

function FinanceStatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string
  value: string
  icon: typeof Wallet
  accent: "emerald" | "amber" | "rose"
}) {
  return (
    <Card className="border-border/60 bg-card/70 hover:border-border rounded-2xl border shadow-2xs backdrop-blur-xs transition-all hover:shadow-xs">
      <CardContent className="flex items-center gap-3.5 p-4 sm:p-4.5">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            accent === "emerald" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            accent === "amber" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
            accent === "rose" && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
          )}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
            {label}
          </p>
          <p className="text-foreground truncate text-xl font-bold tracking-tight tabular-nums sm:text-2xl">
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ProviderFinance() {
  const { isConnected, status } = useRealtimeFinance()

  const user = useAuthStore((s) => s.user)
  const now = new Date()
  const [statusFilter, setStatusFilter] = React.useState<string>("all")
  const [month, setMonth] = React.useState<string>(String(now.getMonth()))
  const [year, setYear] = React.useState<string>(String(now.getFullYear()))

  const query = useQuery<{ items: Booking[]; total: number }>({
    queryKey: ["provider", "finance", user?.id],
    queryFn: async () => apiGet("/api/bookings", { role: "PROVIDER", page: 1, limit: 200 }),
  })

  const allBookings = React.useMemo(() => query.data?.items ?? [], [query.data?.items])

  const filtered = React.useMemo(() => {
    const m = Number(month)
    const y = Number(year)
    return allBookings.filter((b) => {
      const d = new Date(b.scheduledAt)
      if (d.getMonth() !== m) return false
      if (d.getFullYear() !== y) return false
      if (statusFilter !== "all" && b.paymentStatus !== statusFilter) return false
      return true
    })
  }, [allBookings, month, year, statusFilter])

  const isDirty = statusFilter !== "all"

  const clearFilters = () => {
    setStatusFilter("all")
  }

  // Summary across all bookings (not filtered) — for the year
  const yearStart = startOfYear(now)
  const yearBookings = allBookings.filter((b) => {
    const d = new Date(b.scheduledAt)
    return d >= yearStart
  })

  const received = yearBookings
    .filter((b) => b.paymentStatus === "PAID")
    .reduce((acc, b) => acc + b.amount, 0)
  const pending = yearBookings
    .filter((b) => b.paymentStatus === "PENDING")
    .reduce((acc, b) => acc + b.amount, 0)
  const refunded = yearBookings
    .filter((b) => b.paymentStatus === "REFUNDED")
    .reduce((acc, b) => acc + b.amount, 0)

  // Chart: revenue per month (current year)
  const yearMonths = eachMonthOfInterval({
    start: yearStart,
    end: endOfMonth(now),
  })
  const chartData = yearMonths.map((m) => {
    const total = allBookings
      .filter((b) => isSameMonth(new Date(b.scheduledAt), m) && b.paymentStatus === "PAID")
      .reduce((acc, b) => acc + b.amount, 0)
    return {
      month: format(m, "MMM", { locale: ptBR }),
      receita: total,
    }
  })

  const years = React.useMemo(() => {
    const set = new Set<number>()
    set.add(new Date().getFullYear())
    for (const b of allBookings) {
      set.add(new Date(b.scheduledAt).getFullYear())
    }
    return Array.from(set).sort((a, b) => b - a)
  }, [allBookings])

  return (
    <div className="grid gap-6">
      {/* Ambient header bar with integrated Realtime status */}
      <div className="border-border/50 bg-card/60 flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-2.5 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-xs font-semibold">
            Visão Consolidada &amp; Conciliação
          </span>
          <span className="text-muted-foreground/40 hidden sm:inline">•</span>
          <span className="text-muted-foreground hidden text-xs sm:inline">
            Governador Valadares
          </span>
        </div>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span className="text-[11px]">Sincronização:</span>
          <RealtimeStatusBadge status={status} isConnected={isConnected} size="sm" />
        </div>
      </div>

      {/* Wallet section */}
      <ProviderWallet />

      {/* Yearly summary heading */}
      <div className="flex items-center gap-3 pt-2">
        <div className="bg-border/60 h-px flex-1" />
        <span className="text-muted-foreground shrink-0 text-[11px] font-semibold tracking-wider uppercase">
          Resumo do ano ({now.getFullYear()})
        </span>
        <div className="bg-border/60 h-px flex-1" />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <FinanceStatCard
          label="Recebido (ano)"
          value={formatBRL(received)}
          icon={Wallet}
          accent="emerald"
        />
        <FinanceStatCard
          label="A receber (ano)"
          value={formatBRL(pending)}
          icon={Clock}
          accent="amber"
        />
        <FinanceStatCard
          label="Estornado (ano)"
          value={formatBRL(refunded)}
          icon={RotateCcw}
          accent="rose"
        />
      </div>

      {/* Monthly Revenue Chart */}
      <Card className="border-border/60 bg-card/70 rounded-2xl border shadow-2xs backdrop-blur-xs">
        <CardHeader className="border-border/40 border-b px-4 py-3.5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              Receita por mês ({now.getFullYear()})
            </CardTitle>
            <span className="text-muted-foreground text-xs">Valores brutos em R$</span>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
                />
                <RTooltip
                  cursor={{ fill: "var(--accent)", opacity: 0.5 }}
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(v: number) => [formatBRL(v), "Receita"]}
                />
                <Bar dataKey="receita" fill="var(--primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Filters bar */}
      <div className="border-border/60 bg-card/70 flex flex-wrap items-center gap-2.5 rounded-2xl border p-3 shadow-2xs backdrop-blur-xs">
        <div className="text-muted-foreground mr-1 flex items-center gap-1.5 text-xs font-medium">
          <SlidersHorizontal className="size-3.5" />
          Filtros:
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-40 rounded-xl text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="PAID">Pago</SelectItem>
            <SelectItem value="PENDING">Pendente</SelectItem>
            <SelectItem value="REFUNDED">Estornado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="h-9 w-40 rounded-xl text-xs capitalize">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }).map((_, i) => (
              <SelectItem key={i} value={String(i)} className="text-xs capitalize">
                {format(new Date(2024, i, 1), "MMMM", { locale: ptBR })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="h-9 w-28 rounded-xl text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)} className="text-xs">
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isDirty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-9 gap-1.5 rounded-xl text-xs"
          >
            <XCircle className="size-3.5" /> Limpar
          </Button>
        )}
        <p className="text-muted-foreground ml-auto text-xs tabular-nums">
          {filtered.length} transação{filtered.length === 1 ? "" : "ões"}
        </p>
      </div>

      {/* Lote de Recibos Fiscais & Extrato Contábil */}
      <ProviderFiscalBatchExport />

      {/* Bookings Table */}
      <Card className="border-border/60 bg-card/70 overflow-hidden rounded-2xl border shadow-2xs backdrop-blur-xs">
        <CardHeader className="border-border/40 border-b px-4 py-3.5">
          <CardTitle className="text-sm font-semibold">Transações ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-2xl">
                <Wallet className="size-5" />
              </div>
              <p className="text-foreground text-sm font-medium">
                Nenhuma transação neste período.
              </p>
              <p className="text-muted-foreground text-xs">
                Ajuste os filtros de mês ou status para visualizar outros registros.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 border-border/40 h-11 border-b">
                    <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                      Data
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                      Cliente
                    </TableHead>
                    <TableHead className="text-muted-foreground hidden text-xs font-semibold tracking-wide uppercase sm:table-cell">
                      Serviço
                    </TableHead>
                    <TableHead className="text-muted-foreground hidden text-xs font-semibold tracking-wide uppercase md:table-cell">
                      Método
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                      Status
                    </TableHead>
                    <TableHead className="text-muted-foreground text-right text-xs font-semibold tracking-wide uppercase">
                      Valor
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((b) => (
                    <TableRow
                      key={b.id}
                      className="hover:bg-muted/30 border-border/30 h-14 border-b transition-colors"
                    >
                      <TableCell className="text-muted-foreground text-xs tabular-nums">
                        {formatDate(b.scheduledAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar className="border-border/60 size-7 border">
                            {b.client.avatarUrl ? (
                              <AvatarImage src={b.client.avatarUrl} alt={b.client.name} />
                            ) : null}
                            <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                              {initials(b.client.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-foreground truncate text-sm font-medium">
                            {b.client.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden max-w-[200px] truncate text-sm sm:table-cell">
                        {b.service.title}
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">
                        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                          <CreditCard className="size-3.5" />
                          {PAYMENT_METHOD_LABELS[b.paymentMethod]}
                        </span>
                      </TableCell>
                      <TableCell>
                        <PayStatusBadge status={b.paymentStatus} />
                      </TableCell>
                      <TableCell className="text-foreground text-right text-sm font-semibold tabular-nums">
                        {formatBRL(b.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default ProviderFinance
