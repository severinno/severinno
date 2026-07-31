"use client"

/**
 * AdminDashboard — Visão Geral (redesign N2, heurísticas de Nielsen).
 *
 * Foco em H8 (estética & minimalismo) com suporte a:
 *   H1  Visibilidade do status  → FreshnessLabel, refresh button, data timestamps
 *   H4  Consistência            → BookingStatusBadge from admin-shared (1 source of truth)
 *   H7  Eficiência              → Quick navigation links to related views
 *   H8  Minimalismo             → Clean, professional dashboard
 *   H9  Recuperação de erros    → ErrorState com retry
 *
 * Data source: GET /api/admin/stats
 */

import * as React from "react"
import {
  ArrowRight,
  CalendarCheck,
  DollarSign,
  RotateCw,
  Star,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react"
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
import { useQuery } from "@tanstack/react-query"

import { apiGet } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type BookingStatus,
  type PaymentStatus,
} from "@/lib/constants"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { BookingStatusBadge, ErrorState, FreshnessLabel, initials } from "./_shared"
import { TOOLTIP_STYLE } from "./admin-chart-theme"

// ---------------------------------------------------------------------------
// Types — mirrors /api/admin/stats response
// ---------------------------------------------------------------------------

type AdminStats = {
  usersByRole: Record<string, number>
  providers: number
  services: number
  bookingsByStatus: Record<string, number>
  quotesByStatus: Record<string, number>
  revenue: { total: number; paymentsPaid: number }
  recentBookings: Array<{
    id: string
    status: string
    paymentStatus: string
    amount: number
    scheduledAt: string
    createdAt: string
    service?: { id: string; title: string } | null
    client?: { id: string; name: string; avatarUrl?: string | null } | null
    provider?: { id: string; name: string; avatarUrl?: string | null } | null
  }>
  topProviders: Array<{
    id: string
    name: string
    avatarUrl?: string | null
    city?: string | null
    verified: boolean
    rating: number
    reviewCount: number
  }>
}

type DateRange = "today" | "7d" | "30d" | "all"

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "Tudo" },
]

const BOOKING_STATUS_ORDER: BookingStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]

const PAYMENT_STATUS_ORDER: PaymentStatus[] = ["PAID", "PENDING", "REFUNDED"]

// ---------------------------------------------------------------------------
// Chart colors — cohesive palette
// ---------------------------------------------------------------------------

const PIE_COLORS: Record<PaymentStatus, string> = {
  PAID: "hsl(160, 84%, 39%)", // emerald-500
  PENDING: "hsl(38, 92%, 50%)", // amber-500
  REFUNDED: "hsl(240, 6%, 50%)", // zinc-500
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AdminDashboard({ onNavigate }: { onNavigate: (view: string) => void }) {
  const [range, setRange] = React.useState<DateRange>("30d")

  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "stats", range],
    queryFn: () => apiGet<AdminStats>("/api/admin/stats", { range }),
    staleTime: 60_000,
  })

  // H9 — ErrorState with retry
  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar as estatísticas"
        description="Verifique sua conexão e se você está autenticado como administrador."
        onRetry={() => void refetch()}
      />
    )
  }

  // H1 — Skeleton loading state
  if (isLoading || !data) {
    return <DashboardSkeleton />
  }

  const totalUsers = Object.values(data.usersByRole).reduce((a, b) => a + b, 0)
  const totalBookings = Object.values(data.bookingsByStatus).reduce((a, b) => a + b, 0)

  // Bar chart data — bookings by status
  const barData = BOOKING_STATUS_ORDER.map((s) => ({
    status: s,
    label: BOOKING_STATUS_LABELS[s],
    count: data.bookingsByStatus[s] ?? 0,
  }))

  // Pie chart data — revenue by payment status (computed from recent bookings)
  const revenueByPayment: Record<PaymentStatus, number> = {
    PAID: 0,
    PENDING: 0,
    REFUNDED: 0,
  }
  for (const b of data.recentBookings) {
    const ps = b.paymentStatus as PaymentStatus
    if (ps in revenueByPayment) {
      revenueByPayment[ps] += b.amount
    }
  }
  const pieData = PAYMENT_STATUS_ORDER.map((s) => ({
    status: s,
    label: PAYMENT_STATUS_LABELS[s],
    value: revenueByPayment[s],
  })).filter((r) => r.value > 0)

  const freshnessDate = dataUpdatedAt ? new Date(dataUpdatedAt) : null

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* Page header with period selector + freshness + refresh */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-xl font-bold tracking-tight">Visão geral</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">Resumo da atividade da plataforma</p>
        </div>

        <div className="flex items-center gap-3">
          <FreshnessLabel updatedAt={freshnessDate} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Atualizar dados"
          >
            <RotateCw className={cn("size-4", isFetching && "animate-spin")} />
          </Button>

          {/* Segmented period selector */}
          <div className="bg-muted/50 inline-flex h-8 items-center rounded-lg border p-0.5">
            {DATE_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRange(opt.value)}
                className={cn(
                  "h-7 rounded-md px-3 text-xs font-medium transition-colors",
                  range === opt.value
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

      {/* KPI Cards */}
      <section
        aria-label="Indicadores principais"
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        <KpiCard icon={Users} label="Usuários" value={totalUsers.toLocaleString("pt-BR")} />
        <KpiCard icon={Wrench} label="Prestadores" value={data.providers.toLocaleString("pt-BR")} />
        <KpiCard
          icon={CalendarCheck}
          label="Serviços ativos"
          value={data.services.toLocaleString("pt-BR")}
        />
        <KpiCard icon={DollarSign} label="Receita" value={formatBRL(data.revenue.total)} />
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Bar chart — Bookings by status */}
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-foreground text-sm font-semibold">Agendamentos por status</h2>
          </div>
          <div className="p-4">
            <BarChartSection data={barData} />
          </div>
        </div>

        {/* Pie chart — Revenue by payment status */}
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-foreground text-sm font-semibold">
              Receita por status de pagamento
            </h2>
          </div>
          <div className="p-4">
            <PieChartSection data={pieData} />
          </div>
        </div>
      </section>

      {/* Recent bookings table + Top providers list */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <RecentBookingsTable bookings={data.recentBookings} onNavigate={onNavigate} />
        </div>
        <div className="lg:col-span-2">
          <TopProvidersList providers={data.topProviders} onNavigate={onNavigate} />
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="border-border/50 bg-card hover:border-primary/20 rounded-xl border p-5 transition-colors">
      <span className="bg-primary/8 text-primary flex size-10 items-center justify-center rounded-lg">
        <Icon className="size-5" />
      </span>
      <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs font-medium tracking-wider uppercase">
        {label}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bar Chart — Bookings by status
// ---------------------------------------------------------------------------

function BarChartSection({
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

function PieChartSection({
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

// ---------------------------------------------------------------------------
// Recent Bookings Table
// ---------------------------------------------------------------------------

function RecentBookingsTable({
  bookings,
  onNavigate,
}: {
  bookings: AdminStats["recentBookings"]
  onNavigate: (view: string) => void
}) {
  const rows = bookings.slice(0, 5)

  return (
    <div className="border-border/50 bg-card overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h2 className="text-foreground text-sm font-semibold">Agendamentos recentes</h2>
        <button
          type="button"
          onClick={() => onNavigate("admin.bookings")}
          className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          Ver todos
          <ArrowRight className="size-3" />
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="text-muted-foreground px-5 py-12 text-center text-sm">
          Nenhum agendamento encontrado.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-muted/30 text-muted-foreground h-10 border-b text-xs font-medium">
                <th className="px-4 font-medium">Cliente</th>
                <th className="px-4 font-medium">Prestador</th>
                <th className="px-4 font-medium">Serviço</th>
                <th className="px-4 text-right font-medium">Valor</th>
                <th className="px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((b) => {
                const status = b.status as BookingStatus
                return (
                  <tr key={b.id} className="hover:bg-muted/20 h-12 transition-colors">
                    {/* Client */}
                    <td className="px-4">
                      <div className="flex items-center gap-2">
                        <Avatar className="size-6 shrink-0">
                          {b.client?.avatarUrl ? (
                            <AvatarImage src={b.client.avatarUrl} alt={b.client.name ?? ""} />
                          ) : null}
                          <AvatarFallback className="bg-primary/8 text-primary text-[10px] font-semibold">
                            {initials(b.client?.name ?? "?")}
                          </AvatarFallback>
                        </Avatar>
                        <span className="max-w-[120px] truncate text-xs">
                          {b.client?.name ?? "—"}
                        </span>
                      </div>
                    </td>
                    {/* Provider */}
                    <td className="px-4">
                      <div className="flex items-center gap-2">
                        <Avatar className="size-6 shrink-0">
                          {b.provider?.avatarUrl ? (
                            <AvatarImage src={b.provider.avatarUrl} alt={b.provider.name ?? ""} />
                          ) : null}
                          <AvatarFallback className="bg-primary/8 text-primary text-[10px] font-semibold">
                            {initials(b.provider?.name ?? "?")}
                          </AvatarFallback>
                        </Avatar>
                        <span className="max-w-[120px] truncate text-xs">
                          {b.provider?.name ?? "—"}
                        </span>
                      </div>
                    </td>
                    {/* Service */}
                    <td className="px-4">
                      <span className="text-muted-foreground block max-w-[140px] truncate text-xs">
                        {b.service?.title ?? "—"}
                      </span>
                    </td>
                    {/* Amount */}
                    <td className="px-4 text-right">
                      <span className="text-xs font-medium tabular-nums">
                        {formatBRL(b.amount)}
                      </span>
                    </td>
                    {/* Status */}
                    <td className="px-4">
                      <BookingStatusBadge status={status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top Providers List
// ---------------------------------------------------------------------------

function TopProvidersList({
  providers,
  onNavigate,
}: {
  providers: AdminStats["topProviders"]
  onNavigate: (view: string) => void
}) {
  const items = providers.slice(0, 5)

  return (
    <div className="border-border/50 bg-card overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h2 className="text-foreground text-sm font-semibold">Prestadores em destaque</h2>
        <button
          type="button"
          onClick={() => onNavigate("admin.providers")}
          className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          Ver todos
          <ArrowRight className="size-3" />
        </button>
      </div>

      {items.length === 0 ? (
        <div className="text-muted-foreground px-5 py-12 text-center text-sm">
          Nenhum prestador encontrado.
        </div>
      ) : (
        <ul className="divide-y">
          {items.map((p) => (
            <li key={p.id}>
              <div className="flex items-center gap-3 px-5 py-3">
                <Avatar className="size-9 shrink-0">
                  {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt={p.name} /> : null}
                  <AvatarFallback className="bg-primary/8 text-primary text-[11px] font-semibold">
                    {initials(p.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">{p.name}</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Star className="size-3 fill-amber-400 text-amber-400" />
                    <span className="text-foreground text-xs font-medium tabular-nums">
                      {p.rating.toFixed(1)}
                    </span>
                    <span className="text-muted-foreground text-xs">({p.reviewCount})</span>
                  </div>
                </div>
                {p.city ? (
                  <span className="text-muted-foreground shrink-0 text-xs">{p.city}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton — mirrors the final layout
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* Header skeleton */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-8 w-44 rounded-lg" />
        </div>
      </div>

      {/* 4 KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border-border/50 bg-card rounded-xl border p-5">
            <Skeleton className="size-10 rounded-lg" />
            <Skeleton className="mt-3 h-7 w-24" />
            <Skeleton className="mt-1 h-3 w-16" />
          </div>
        ))}
      </div>

      {/* 2 chart cards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="border-border/50 bg-card rounded-xl border">
            <div className="border-b px-5 py-4">
              <Skeleton className="h-4 w-48" />
            </div>
            <div className="p-4">
              <Skeleton className="h-[220px] w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>

      {/* Table + List */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="border-border/50 bg-card rounded-xl border">
            <div className="border-b px-5 py-4">
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="mb-2 h-12 w-full rounded-md" />
              ))}
            </div>
          </div>
        </div>
        <div className="lg:col-span-2">
          <div className="border-border/50 bg-card rounded-xl border">
            <div className="border-b px-5 py-4">
              <Skeleton className="h-4 w-44" />
            </div>
            <div className="p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="mb-2 h-14 w-full rounded-md" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
