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
import { CalendarCheck, DollarSign, RotateCw, Users, Wrench } from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { apiGet } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { BOOKING_STATUS_LABELS, PAYMENT_STATUS_LABELS, type PaymentStatus } from "@/lib/constants"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ErrorState, FreshnessLabel } from "./_shared"
import { AdminUnitEconomicsCard } from "./admin-unit-economics-card"
import {
  type AdminStats,
  type DateRange,
  DATE_RANGE_OPTIONS,
  BOOKING_STATUS_ORDER,
  PAYMENT_STATUS_ORDER,
} from "./admin-dashboard-types"
import { BarChartSection, PieChartSection } from "./admin-dashboard-charts"
import { RecentBookingsTable, TopProvidersList } from "./admin-dashboard-tables"
import { KpiCard, DashboardSkeleton } from "./admin-dashboard-kpis"

export * from "./admin-dashboard-types"
export * from "./admin-dashboard-charts"
export * from "./admin-dashboard-tables"
export * from "./admin-dashboard-kpis"

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
  const _totalBookings = Object.values(data.bookingsByStatus).reduce((a, b) => a + b, 0)

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
    HELD: 0,
    AUTHORIZED: 0,
    REFUNDED: 0,
    FAILED: 0,
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

      {/* Unit Economics & Expansion Simulator (Investor Pitch Mode) */}
      <AdminUnitEconomicsCard />

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
