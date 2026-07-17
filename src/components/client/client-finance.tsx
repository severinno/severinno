"use client"

/**
 * ClientFinance — payments overview for the client.
 *
 * Polish (Nielsen + trust/transparency):
 *  - Page header (text-2xl font-bold).
 *  - Summary cards: Total pago (emerald), Pendente (amber), Reembolsado
 *    (rose) — visible system status (H1) + scannable financial snapshot.
 *  - Monthly bar chart (paid only) — visualises spending over time.
 *  - Status filter as segmented pill tabs with counts (Todos / Pago /
 *    Pendente / Reembolsado).
 *  - Filter bar (month + year selects + "Limpar" ghost button) +
 *    result count.
 *  - Table: date, provider (avatar), service, amount (tabular-nums),
 *    method (Cartão/PIX badge), status (icon badge). Header bg-muted/50
 *    h-11 uppercase; rows h-14 hover:bg-muted/30 transition.
 *
 * Derived from bookings (Booking carries paymentMethod/paymentStatus/amount).
 */

import * as React from "react"
import { useQueries } from "@tanstack/react-query"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  CreditCard,
  Loader2,
  PiggyBank,
  Receipt,
  RotateCcw,
  Wallet,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { apiGet } from "@/lib/api"
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/constants"
import { formatBRL, formatDate } from "@/lib/format"

import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import {
  EmptyState,
  StatCard,
} from "@/components/shared/dashboard-shell"
import {
  PageHeader,
  StatusBadge,
  paymentIcon,
  paymentTone,
} from "@/components/client/client-shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Booking = {
  id: string
  status: string
  scheduledAt: string
  amount: number
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  service: { id: string; title: string }
  provider: { id: string; name: string; avatarUrl?: string | null }
}

type BookingsResponse = {
  items: Booking[]
  total: number
  page: number
  limit: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS: Array<{ key: string; label: string }> = [
  { key: "ALL", label: "Todos" },
  { key: "PAID", label: "Pago" },
  { key: "PENDING", label: "Pendente" },
  { key: "REFUNDED", label: "Reembolsado" },
]

const MONTH_LABELS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
]

const MONTH_FULL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]

const CHART_TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.15)",
} as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerInitials(name?: string | null): string {
  if (!name) return "P"
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientFinance() {
  const now = new Date()
  const [tab, setTab] = React.useState("ALL")
  const [year, setYear] = React.useState<string>(String(now.getFullYear()))
  const [month, setMonth] = React.useState<string>("ALL") // "ALL" or 0..11

  // Fetch up to 4 pages of 50 (= 200 max) so we can compute summary + chart
  // + filter client-side. Mirrors the existing approach.
  const queries = useQueries({
    queries: [1, 2, 3, 4].map((p) => ({
      queryKey: ["bookings", "CLIENT", "finance", p],
      queryFn: () =>
        apiGet<BookingsResponse>("/api/bookings", {
          role: "CLIENT",
          page: p,
          limit: 50,
        }),
      staleTime: 30_000,
    })),
  })

  const allBookings = React.useMemo(() => {
    const merged: Booking[] = []
    for (const q of queries) {
      if (q.data?.items?.length) merged.push(...q.data.items)
    }
    return merged
  }, [queries])

  const isLoading = queries.some((q) => q.isLoading)

  // Years available in the data
  const yearsAvailable = React.useMemo(() => {
    const set = new Set<number>()
    set.add(now.getFullYear())
    for (const b of allBookings) {
      set.add(new Date(b.scheduledAt).getFullYear())
    }
    return Array.from(set).sort((a, b) => b - a)
  }, [allBookings, now])

  // Counts per payment status
  const counts = React.useMemo(() => {
    const map: Record<string, number> = {
      ALL: allBookings.length,
      PAID: 0,
      PENDING: 0,
      REFUNDED: 0,
    }
    for (const b of allBookings) {
      if (map[b.paymentStatus] != null) map[b.paymentStatus]!++
    }
    return map
  }, [allBookings])

  // Filter by status + year + month
  const filtered = React.useMemo(() => {
    const yNum = Number(year)
    const mNum = month === "ALL" ? null : Number(month)
    return allBookings.filter((b) => {
      const d = new Date(b.scheduledAt)
      if (d.getFullYear() !== yNum) return false
      if (mNum != null && d.getMonth() !== mNum) return false
      if (tab !== "ALL" && b.paymentStatus !== tab) return false
      return true
    })
  }, [allBookings, year, month, tab])

  // Summary across all years (not filtered by year/month) — gives a true
  // lifetime total so the user always sees their real financial position.
  const summary = React.useMemo(() => {
    let paid = 0
    let pending = 0
    let refunded = 0
    for (const b of allBookings) {
      if (b.paymentStatus === "PAID") paid += b.amount
      else if (b.paymentStatus === "PENDING") pending += b.amount
      else if (b.paymentStatus === "REFUNDED") refunded += b.amount
    }
    return { paid, pending, refunded }
  }, [allBookings])

  // Monthly chart for selected year (paid only) — month filter doesn't
  // shrink the chart; user sees the full year so they can compare.
  const monthlyData = React.useMemo(() => {
    const arr = MONTH_LABELS.map((m) => ({ month: m, total: 0 }))
    const yNum = Number(year)
    for (const b of allBookings) {
      const d = new Date(b.scheduledAt)
      if (d.getFullYear() !== yNum) continue
      if (b.paymentStatus !== "PAID") continue
      arr[d.getMonth()]!.total += b.amount
    }
    return arr
  }, [allBookings, year])

  const hasFilters = tab !== "ALL" || month !== "ALL" || year !== String(now.getFullYear())

  const clearFilters = () => {
    setTab("ALL")
    setMonth("ALL")
    setYear(String(now.getFullYear()))
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Financeiro"
        subtitle="Acompanhe seus pagamentos e gastos com serviços."
      />

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={Wallet}
          label="Total pago"
          value={formatBRL(summary.paid)}
          tone="primary"
          hint="Histórico completo"
        />
        <StatCard
          icon={Receipt}
          label="Pendente"
          value={formatBRL(summary.pending)}
          tone="amber"
          hint="Aguardando pagamento"
        />
        <StatCard
          icon={PiggyBank}
          label="Reembolsado"
          value={formatBRL(summary.refunded)}
          tone="rose"
          hint="Estornos recebidos"
        />
      </div>

      {/* Monthly chart */}
      <Card className="rounded-xl shadow-sm">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Gastos por mês</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                Pagamentos confirmados em {year}
              </p>
            </div>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}k` : `R$ ${v}`
                  }
                />
                <Tooltip
                  formatter={(v: number) => formatBRL(v)}
                  labelFormatter={(l: string) => `Mês: ${l}`}
                  cursor={{ fill: "oklch(0.55 0.15 160 / 0.08)" }}
                  contentStyle={CHART_TOOLTIP_STYLE}
                />
                <Bar
                  dataKey="total"
                  fill="oklch(0.55 0.15 160)"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Status tabs (segmented, with counts) */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex w-full flex-wrap justify-start gap-1 h-auto p-1 sm:w-auto">
          {TABS.map((t) => {
            const count = counts[t.key] ?? 0
            const active = tab === t.key
            return (
              <TabsTrigger
                key={t.key}
                value={t.key}
                className="h-8 flex-shrink-0 gap-1.5"
              >
                {t.label}
                <span
                  className={cn(
                    "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                    active
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Mês
          </span>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-9 w-40" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os meses</SelectItem>
              {MONTH_FULL.map((m, i) => (
                <SelectItem key={m} value={String(i)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Ano
          </span>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="h-9 w-28" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearsAvailable.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-9 gap-1.5 self-end text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
            Limpar
          </Button>
        ) : null}

        <p className="ml-auto self-end text-xs text-muted-foreground tabular-nums">
          {isLoading
            ? "Carregando…"
            : filtered.length === 0
              ? "Sem resultados"
              : `${filtered.length} pagamento${filtered.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Carregando pagamentos…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="Nenhum pagamento encontrado"
          description="Não há pagamentos registrados com este filtro. Tente ajustar o mês, ano ou status."
        />
      ) : (
        <Card className="rounded-xl shadow-sm">
          <CardContent className="px-0 py-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 h-11 hover:bg-muted/50">
                    <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Data
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Prestador
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground md:table-cell">
                      Serviço
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Valor
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">
                      Método
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((b) => {
                    const initials = providerInitials(b.provider.name)
                    return (
                      <TableRow
                        key={b.id}
                        className="h-14 transition-colors hover:bg-muted/30"
                      >
                        <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                          {formatDate(b.scheduledAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="size-7">
                              {b.provider.avatarUrl ? null : null}
                              <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
                                {initials || "P"}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate text-sm font-medium">
                              {b.provider.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden max-w-[16rem] truncate text-xs text-muted-foreground md:table-cell">
                          {b.service.title}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-sm font-semibold tabular-nums">
                          {formatBRL(b.amount)}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap sm:table-cell">
                          <StatusBadge tone="zinc" className="text-[10px]">
                            {PAYMENT_METHOD_LABELS[b.paymentMethod as PaymentMethod]}
                          </StatusBadge>
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            tone={paymentTone(b.paymentStatus as PaymentStatus)}
                            icon={paymentIcon(b.paymentStatus as PaymentStatus)}
                          >
                            {PAYMENT_STATUS_LABELS[b.paymentStatus as PaymentStatus]}
                          </StatusBadge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
