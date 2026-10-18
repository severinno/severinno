"use client"

/**
 * ClientFinance — payments and escrow financial management for the client.
 *
 * Polish & Service Design:
 *  - Modern Hero Banner with subtle emerald/card gradient & Trust Escrow Badge.
 *  - Quick access actions: "Ver agendamentos" & "Buscar prestadores".
 *  - Realtime connection badge.
 *  - Escrow Custody Education Banner (100% Protegido, retenção segura até a conclusão).
 *  - 3 High-impact StatCards (Total Pago, Em Custódia / Pendente, Reembolsado).
 *  - Monthly Spending Bar Chart (Recharts) with clean tooltips & improved margins.
 *  - Status segmented pill tabs with real-time counters.
 *  - Filter bar: Search input + Month Select + Year Select + Clear Filters button.
 *  - Dual Responsive Layout:
 *    - Desktop: Polished Table with 100% round provider avatars, clickable provider profiles,
 *      clear currency formatting, payment method badge, status badge, and direct actions:
 *      - "Recibo": Opens authentic ReceiptModal with copy & print support.
 *      - "Agendamento": Direct link to booking management.
 *      - "Mensagem": In-platform messaging (client.messages) with zero WhatsApp leaks.
 *    - Mobile: Card-based vertical layout avoiding horizontal scrolling.
 *  - Persuasive Empty States for zero results.
 */

import * as React from "react"
import { useQueries } from "@tanstack/react-query"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import {
  Calendar,
  CreditCard,
  FileText,
  Loader2,
  Lock,
  MessageSquare,
  PiggyBank,
  Receipt,
  RotateCcw,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react"

import { cn } from "@/lib/utils"
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
import { useViewStore } from "@/store/view"
import { useUIStore } from "@/store/ui"
import { ReceiptModal } from "@/components/shared/receipt-modal"

import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { EmptyState, StatCard } from "@/components/shared/dashboard-shell"
import { StatusBadge, paymentIcon, paymentTone } from "@/components/client/client-shared"

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
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
]

const MONTH_FULL = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
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
  const { isConnected, status } = useRealtimeFinance()
  const navigate = useViewStore((s) => s.navigate)
  const openProvider = useUIStore((s) => s.openProvider)
  const openBooking = useUIStore((s) => s.openBooking)

  const now = React.useMemo(() => new Date(), [])
  const [tab, setTab] = React.useState("ALL")
  const [year, setYear] = React.useState<string>(String(now.getFullYear()))
  const [month, setMonth] = React.useState<string>("ALL") // "ALL" or 0..11
  const [filterText, setFilterText] = React.useState("")
  const [selectedReceiptBookingId, setSelectedReceiptBookingId] = React.useState<string | null>(
    null,
  )

  // Fetch up to 4 pages of 50 (= 200 max) so we can compute summary + chart
  // + filter client-side.
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

  // Filter by status + year + month + text
  const filtered = React.useMemo(() => {
    const yNum = Number(year)
    const mNum = month === "ALL" ? null : Number(month)
    const search = filterText.trim().toLowerCase()

    return allBookings.filter((b) => {
      const d = new Date(b.scheduledAt)
      if (d.getFullYear() !== yNum) return false
      if (mNum != null && d.getMonth() !== mNum) return false
      if (tab !== "ALL" && b.paymentStatus !== tab) return false
      if (search) {
        const matchProvider = b.provider.name.toLowerCase().includes(search)
        const matchService = b.service.title.toLowerCase().includes(search)
        if (!matchProvider && !matchService) return false
      }
      return true
    })
  }, [allBookings, year, month, tab, filterText])

  // Summary across all years
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

  // Monthly chart for selected year (paid only)
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

  const hasFilters =
    tab !== "ALL" || month !== "ALL" || year !== String(now.getFullYear()) || filterText !== ""

  const clearFilters = () => {
    setTab("ALL")
    setMonth("ALL")
    setYear(String(now.getFullYear()))
    setFilterText("")
  }

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="border-border/60 from-card via-card/95 relative overflow-hidden rounded-2xl border bg-gradient-to-br to-emerald-500/5 p-6 shadow-sm">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-3.5" />
              <span>Pagamento Seguro & Custódia Escrow</span>
            </div>
            <h1 className="text-foreground mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              Financeiro
            </h1>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              Acompanhe seus pagamentos e gastos com serviços.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("client.bookings")}
              className="gap-1.5 text-xs font-medium"
            >
              <Calendar className="size-3.5" />
              Ver agendamentos
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("client.providers")}
              className="gap-1.5 text-xs font-medium"
            >
              <Search className="size-3.5" />
              Buscar prestadores
            </Button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <RealtimeStatusBadge status={status} isConnected={isConnected} />
      </div>

      {/* Escrow Custody Trust Banner */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-50/40 p-4 dark:bg-emerald-950/20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h2 className="text-foreground text-sm font-semibold">
                Custódia Digital Severinno Escrow
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Seus pagamentos ficam retidos em conta segura e protegida até a conclusão e
                confirmação do serviço. Nenhum valor é liberado antecipadamente ao prestador sem o
                cumprimento das etapas combinadas.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start pl-12 sm:pl-0">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              <Lock className="size-3" />
              100% Protegido
            </span>
          </div>
        </div>
      </div>

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
              <p className="text-muted-foreground text-xs tabular-nums">
                Pagamentos confirmados em {year}
              </p>
            </div>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
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
                  width={60}
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
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 p-1 sm:w-auto">
          {TABS.map((t) => {
            const count = counts[t.key] ?? 0
            const active = tab === t.key
            return (
              <TabsTrigger key={t.key} value={t.key} className="h-8 flex-shrink-0 gap-1.5">
                {t.label}
                <span
                  className={cn(
                    "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                    active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
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
      <div className="bg-card flex flex-wrap items-center gap-3 rounded-xl border p-3">
        {/* Search input */}
        <div className="relative min-w-[200px] flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filtrar por prestador ou serviço..."
            className="h-9 pl-9 text-xs"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
            Mês
          </span>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-9 w-36" size="sm">
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
          <span className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
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
            className="text-muted-foreground hover:text-foreground h-9 gap-1.5 self-end"
          >
            <RotateCcw className="size-3.5" />
            Limpar
          </Button>
        ) : null}

        <p className="text-muted-foreground ml-auto self-end text-xs tabular-nums">
          {isLoading
            ? "Carregando…"
            : filtered.length === 0
              ? "Sem resultados"
              : `${filtered.length} pagamento${filtered.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      {/* Content: Loading / Empty / Responsive Views */}
      {isLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 p-10 text-sm">
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
        <>
          {/* Desktop Table */}
          <Card className="hidden rounded-xl shadow-sm md:block">
            <CardContent className="px-0 py-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50 h-11">
                      <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                        Data
                      </TableHead>
                      <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                        Prestador
                      </TableHead>
                      <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
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
                      <TableHead className="text-muted-foreground text-right text-xs font-semibold tracking-wide uppercase">
                        Ações
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((b) => {
                      const initials = providerInitials(b.provider.name)
                      return (
                        <TableRow key={b.id} className="hover:bg-muted/30 h-14 transition-colors">
                          <TableCell className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
                            {formatDate(b.scheduledAt)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <Avatar className="ring-border/50 size-8 rounded-full ring-1">
                                {b.provider.avatarUrl ? (
                                  <AvatarImage
                                    src={b.provider.avatarUrl}
                                    alt={b.provider.name}
                                    className="rounded-full object-cover"
                                  />
                                ) : null}
                                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-semibold">
                                  {initials || "P"}
                                </AvatarFallback>
                              </Avatar>
                              <button
                                type="button"
                                onClick={() => openProvider(b.provider.id)}
                                className="hover:text-primary text-foreground truncate text-left text-sm font-medium transition-colors hover:underline"
                              >
                                {b.provider.name}
                              </button>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-[14rem] truncate text-xs">
                            {b.service.title}
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold whitespace-nowrap tabular-nums">
                            {formatBRL(b.amount)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
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
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {b.paymentStatus === "PAID" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setSelectedReceiptBookingId(b.id)}
                                  className="h-8 gap-1 border-emerald-200 px-2.5 text-xs text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:border-emerald-800/40 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                                >
                                  <FileText className="size-3.5" />
                                  <span>Recibo</span>
                                </Button>
                              )}
                              {b.paymentStatus === "PENDING" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    openBooking({
                                      providerId: b.provider.id,
                                      serviceId: b.service.id,
                                    })
                                  }
                                  className="h-8 gap-1 border-amber-200 px-2.5 text-xs text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:border-amber-800/40 dark:text-amber-400 dark:hover:bg-amber-950/30"
                                >
                                  <Calendar className="size-3.5" />
                                  <span>Agendamento</span>
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  navigate("client.messages", {
                                    providerId: b.provider.id,
                                    bookingId: b.id,
                                  })
                                }
                                className="text-muted-foreground hover:text-foreground h-8 gap-1 px-2 text-xs"
                                title="Enviar mensagem na plataforma"
                              >
                                <MessageSquare className="size-3.5" />
                                <span className="sr-only">Mensagem</span>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Mobile Card List */}
          <div className="grid gap-3 md:hidden">
            {filtered.map((b) => {
              const initials = providerInitials(b.provider.name)
              return (
                <Card key={b.id} className="rounded-xl shadow-sm">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="ring-border/50 size-9 rounded-full ring-1">
                          {b.provider.avatarUrl ? (
                            <AvatarImage
                              src={b.provider.avatarUrl}
                              alt={b.provider.name}
                              className="rounded-full object-cover"
                            />
                          ) : null}
                          <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-semibold">
                            {initials || "P"}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <button
                            type="button"
                            onClick={() => openProvider(b.provider.id)}
                            className="hover:text-primary text-foreground line-clamp-1 text-left text-sm font-semibold transition-colors hover:underline"
                          >
                            {b.provider.name}
                          </button>
                          <p className="text-muted-foreground line-clamp-1 text-xs">
                            {b.service.title}
                          </p>
                        </div>
                      </div>
                      <StatusBadge
                        tone={paymentTone(b.paymentStatus as PaymentStatus)}
                        icon={paymentIcon(b.paymentStatus as PaymentStatus)}
                      >
                        {PAYMENT_STATUS_LABELS[b.paymentStatus as PaymentStatus]}
                      </StatusBadge>
                    </div>

                    <div className="text-muted-foreground flex items-center justify-between border-t pt-2.5 text-xs">
                      <span className="tabular-nums">{formatDate(b.scheduledAt)}</span>
                      <div className="flex items-center gap-2">
                        <StatusBadge tone="zinc" className="text-[10px]">
                          {PAYMENT_METHOD_LABELS[b.paymentMethod as PaymentMethod]}
                        </StatusBadge>
                        <span className="text-foreground text-sm font-bold tabular-nums">
                          {formatBRL(b.amount)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t pt-2">
                      {b.paymentStatus === "PAID" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedReceiptBookingId(b.id)}
                          className="h-8 gap-1.5 border-emerald-200 px-3 text-xs text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800/40 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                        >
                          <FileText className="size-3.5" />
                          <span>Recibo</span>
                        </Button>
                      )}
                      {b.paymentStatus === "PENDING" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            openBooking({
                              providerId: b.provider.id,
                              serviceId: b.service.id,
                            })
                          }
                          className="h-8 gap-1.5 border-amber-200 px-3 text-xs text-amber-600 hover:bg-amber-50 dark:border-amber-800/40 dark:text-amber-400 dark:hover:bg-amber-950/30"
                        >
                          <Calendar className="size-3.5" />
                          <span>Agendamento</span>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          navigate("client.messages", {
                            providerId: b.provider.id,
                            bookingId: b.id,
                          })
                        }
                        className="text-muted-foreground hover:text-foreground h-8 gap-1.5 px-3 text-xs"
                      >
                        <MessageSquare className="size-3.5" />
                        <span>Mensagem</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}

      {/* Official Authentic Receipt Modal */}
      <ReceiptModal
        bookingId={selectedReceiptBookingId ?? ""}
        open={Boolean(selectedReceiptBookingId)}
        onOpenChange={(open) => {
          if (!open) setSelectedReceiptBookingId(null)
        }}
      />
    </div>
  )
}
