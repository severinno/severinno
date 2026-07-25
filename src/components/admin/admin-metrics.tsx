"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Users,
  CalendarCheck,
  FileText,
  Star,
  TrendingUp,
  RotateCw,
} from "lucide-react"
import { apiGet } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/admin/admin-shared"
import { cn } from "@/lib/utils"

type BusinessMetrics = {
  periodStart: string
  periodEnd: string
  users: { total: number; clients: number; providers: number; verifiedProviders: number; newLast30d: number }
  bookings: { total: number; byStatus: Record<string, number>; completed: number; cancelled: number; conversionRate: number | null }
  quotes: { total: number; byStatus: Record<string, number>; responded: number; conversionToBooking: number | null }
  reviews: { total: number; avgRating: number | null }
  revenue: { total: number; paid: number; pending: number; avgBookingValue: number | null }
}

function SummaryCard({ icon: Icon, label, value, sub, className }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; className?: string
}) {
  return (
    <Card className={cn("", className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function KpiRow({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value} / {total} ({pct.toFixed(0)}%)</span>
    </div>
  )
}

export function AdminMetrics() {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin", "metrics"],
    queryFn: () => apiGet<BusinessMetrics>("/api/metrics"),
    staleTime: 120_000,
  })

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}><CardHeader><Skeleton className="h-4 w-24" /></CardHeader><CardContent><Skeleton className="h-8 w-16" /></CardContent></Card>
        ))}
      </div>
    )
  }

  if (!data) {
    return (
      <ErrorState
        message="Não foi possível carregar as métricas."
        onRetry={() => refetch()}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Período: {new Date(data.periodStart).toLocaleDateString("pt-BR")} — {new Date(data.periodEnd).toLocaleDateString("pt-BR")}
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RotateCw className={cn("size-3.5", isFetching && "animate-spin")} />
          Atualizar
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={Users} label="Usuários" value={data.users.total} sub={`${data.users.newLast30d} novos nos últimos 30d`} />
        <SummaryCard icon={CalendarCheck} label="Agendamentos" value={data.bookings.total} sub={`${data.bookings.completed} concluídos`} />
        <SummaryCard icon={FileText} label="Orçamentos" value={data.quotes.total} sub={`${data.quotes.responded} respondidos`} />
        <SummaryCard icon={Star} label="Avaliações" value={data.reviews.total} sub={data.reviews.avgRating ? `Média: ${data.reviews.avgRating}/5` : "Nenhuma"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Receita</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold">{formatBRL(data.revenue.total)}</span>
              <span className="text-sm text-muted-foreground">{data.revenue.paid} pagamentos</span>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Pendente</span><span>{formatBRL(data.revenue.pending * (data.revenue.total / Math.max(data.revenue.paid, 1)))} ({data.revenue.pending})</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Ticket médio</span><span>{data.revenue.avgBookingValue ? formatBRL(data.revenue.avgBookingValue) : "—"}</span></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Conversão</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-5 text-emerald-500" />
              <span className="text-sm text-muted-foreground">Orçamento → Agendamento</span>
              <span className="ml-auto text-lg font-bold">
                {data.quotes.conversionToBooking != null ? `${(data.quotes.conversionToBooking * 100).toFixed(1)}%` : "—"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <TrendingUp className="size-5 text-blue-500" />
              <span className="text-sm text-muted-foreground">Agendamentos / Orçamentos</span>
              <span className="ml-auto text-lg font-bold">
                {data.bookings.conversionRate != null ? `${(data.bookings.conversionRate * 100).toFixed(1)}%` : "—"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Detalhamento</CardTitle></CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div>
            <h4 className="mb-2 text-sm font-medium text-muted-foreground">Agendamentos por status</h4>
            {Object.entries(data.bookings.byStatus).map(([status, count]) => (
              <KpiRow key={status} label={status} value={count} total={data.bookings.total} />
            ))}
          </div>
          <div>
            <h4 className="mb-2 text-sm font-medium text-muted-foreground">Orçamentos por status</h4>
            {Object.entries(data.quotes.byStatus).map(([status, count]) => (
              <KpiRow key={status} label={status} value={count} total={data.quotes.total} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
