"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useQuery } from "@tanstack/react-query"
import {
  eachMonthOfInterval,
  format,
  isSameMonth,
  startOfYear,
  endOfMonth,
} from "date-fns"
import { ptBR } from "date-fns/locale"
import {
  CheckCircle2,
  Clock,
  CreditCard,
  RotateCcw,
  Wallet,
  XCircle,
} from "lucide-react"

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

const ProviderRevenueChart = dynamic(() => import("@/components/provider/provider-finance-charts").then((m) => m.ProviderRevenueChart), { ssr: false })

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
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  PAID: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  REFUNDED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
}

function PayStatusBadge({ status }: { status: PaymentStatus }) {
  const Icon =
    status === "PAID"
      ? CheckCircle2
      : status === "PENDING"
        ? Clock
        : RotateCcw
  return (
    <Badge
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        PAY_BADGE_STYLES[status],
      )}
    >
      <Icon className="size-3" />
      {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  )
}



// ---------------------------------------------------------------------------
// Stat card
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
    <Card className="rounded-xl shadow-sm">
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            accent === "emerald"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              : accent === "amber"
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
          )}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="truncate text-xl font-bold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ProviderFinance() {
  const user = useAuthStore((s) => s.user)
  const now = new Date()
  const [statusFilter, setStatusFilter] = React.useState<string>("all")
  const [month, setMonth] = React.useState<string>(String(now.getMonth()))
  const [year, setYear] = React.useState<string>(String(now.getFullYear()))

  const query = useQuery<{ items: Booking[]; total: number }>({
    queryKey: ["provider", "finance", user?.id],
    queryFn: async () =>
      apiGet("/api/bookings", { role: "PROVIDER", page: 1, limit: 200 }),
  })

  const allBookings = query.data?.items ?? []

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
      .filter(
        (b) =>
          isSameMonth(new Date(b.scheduledAt), m) &&
          b.paymentStatus === "PAID",
      )
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
    <div className="grid gap-8">
      {/* Wallet */}
      <ProviderWallet />

      {/* Yearly summary heading */}
      <div className="-mb-2 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Resumo do ano
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

      {/* Chart */}
      <Card className="rounded-xl shadow-sm">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">
            Receita por mês ({now.getFullYear()})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <ProviderRevenueChart data={chartData} />
        </CardContent>
      </Card>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
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
          <SelectTrigger className="w-40 capitalize">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }).map((_, i) => (
              <SelectItem key={i} value={String(i)} className="capitalize">
                {format(new Date(2024, i, 1), "MMMM", { locale: ptBR })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
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
            className="h-9 gap-1.5 text-xs"
          >
            <XCircle className="size-3.5" /> Limpar
          </Button>
        )}
        <p className="ml-auto text-xs text-muted-foreground tabular-nums">
          {filtered.length} transação{filtered.length === 1 ? "" : "ões"}
        </p>
      </div>

      {/* Table */}
      <Card className="rounded-xl shadow-sm">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">
            Transações ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Wallet className="size-5" />
              </div>
              <p className="text-sm text-muted-foreground">
                Nenhuma transação neste período.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 h-11 hover:bg-muted/50">
                    <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Data
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Cliente
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">
                      Serviço
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground md:table-cell">
                      Método
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Status
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Valor
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((b) => (
                    <TableRow
                      key={b.id}
                      className="h-14 transition-colors hover:bg-muted/30"
                    >
                      <TableCell className="text-xs tabular-nums text-muted-foreground">
                        {formatDate(b.scheduledAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="size-7 border">
                            {b.client.avatarUrl ? (
                              <AvatarImage
                                src={b.client.avatarUrl}
                                alt={b.client.name}
                              />
                            ) : null}
                            <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
                              {initials(b.client.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate text-sm">
                            {b.client.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-[200px] truncate text-sm sm:table-cell">
                        {b.service.title}
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <CreditCard className="size-3" />
                          {PAYMENT_METHOD_LABELS[b.paymentMethod]}
                        </span>
                      </TableCell>
                      <TableCell>
                        <PayStatusBadge status={b.paymentStatus} />
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">
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
