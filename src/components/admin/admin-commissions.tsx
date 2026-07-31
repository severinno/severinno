"use client"

/**
 * AdminCommissions — Visão de comissões da plataforma.
 *
 * Mostra:
 *   - Quanto a plataforma ganhou (15% de taxa)
 *   - Quanto cada prestador recebeu
 *   - Breakdown mensal
 *   - Tabela de prestadores ordenada por receita
 *
 * Data source: GET /api/admin/commissions
 */

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
import {
  Banknote,
  Calendar,
  DollarSign,
  Download,
  Landmark,
  Percent,
  RotateCw,
  TrendingUp,
  Users,
} from "lucide-react"

import { apiGet } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { FEE_RATE } from "@/lib/constants"

// ---------------------------------------------------------------------------
// Types (mirroring API response)
// ---------------------------------------------------------------------------

type CommissionSummary = {
  year: number
  grossRevenue: number
  platformCommission: number
  providerEarnings: number
  bookingCount: number
  completedCount: number
  monthly: Array<{
    month: string
    gross: number
    commission: number
    providerNet: number
    bookingCount: number
  }>
  providers: Array<{
    id: string
    name: string
    avatarUrl: string | null
    bookingCount: number
    grossRevenue: number
    commission: number
    netEarnings: number
    completedCount: number
  }>
}
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { ErrorState, FreshnessLabel, initials } from "./_shared"
import { TOOLTIP_STYLE } from "./admin-chart-theme"

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const COLORS = {
  commission: "hsl(38, 92%, 50%)",
  providerNet: "hsl(160, 84%, 39%)",
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AdminCommissions() {
  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = React.useState(currentYear)
  const [selectedProvider, setSelectedProvider] = React.useState<string>("all")

  const filterParams: Record<string, string> = {
    year: String(selectedYear),
  }
  if (selectedProvider !== "all") {
    filterParams.providerId = selectedProvider
  }

  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } =
    useQuery<CommissionSummary>({
      queryKey: ["admin", "commissions", selectedYear, selectedProvider],
      queryFn: () => apiGet("/api/admin/commissions", filterParams),
      staleTime: 60_000,
    })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar as comissões"
        description="Verifique sua conexão e se você está autenticado como administrador."
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return <CommissionsSkeleton />
  }

  const freshnessDate = dataUpdatedAt ? new Date(dataUpdatedAt) : null

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-xl font-bold tracking-tight">Comissões</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Taxa da plataforma de {FEE_RATE * 100}% sobre serviços realizados
          </p>
        </div>{" "}
        <div className="flex items-center gap-3">
          {/* Provider filter */}
          <Select value={selectedProvider} onValueChange={setSelectedProvider}>
            <SelectTrigger
              className="h-8 w-[160px] gap-1 text-xs"
              aria-label="Filtrar por prestador"
            >
              <Users className="size-3.5" />
              <SelectValue placeholder="Todos prestadores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos prestadores</SelectItem>
              {data?.providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Year selector */}
          <Select
            value={String(selectedYear)}
            onValueChange={(v) => setSelectedYear(parseInt(v, 10))}
          >
            <SelectTrigger className="h-8 w-[100px] gap-1 text-xs" aria-label="Selecionar ano">
              <Calendar className="size-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 5 }, (_, i) => currentYear - i).map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FreshnessLabel updatedAt={freshnessDate} />
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
            <a
              href={`/api/admin/commissions/export?year=${selectedYear}${selectedProvider !== "all" ? `&providerId=${selectedProvider}` : ""}`}
              download
            >
              <Download className="size-3.5" />
              Exportar CSV
            </a>
          </Button>
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
        </div>
      </div>

      {/* Summary cards */}
      <section aria-label="Resumo financeiro" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={DollarSign}
          label="Receita Bruta"
          value={formatBRL(data.grossRevenue)}
          subtitle="Total de bookings PAID"
        />
        <KpiCard
          icon={Landmark}
          label="Comissão da Plataforma"
          value={formatBRL(data.platformCommission)}
          subtitle={`${FEE_RATE * 100}% de taxa`}
          accent="amber"
        />
        <KpiCard
          icon={Banknote}
          label="Repassado aos Prestadores"
          value={formatBRL(data.providerEarnings)}
          subtitle="Líquido após taxa"
          accent="emerald"
        />
        <KpiCard
          icon={TrendingUp}
          label="Serviços Realizados"
          value={String(data.completedCount)}
          subtitle={`${data.bookingCount} bookings PAID no total`}
          accent="violet"
        />
      </section>

      {/* Monthly chart */}
      <section className="border-border/50 bg-card rounded-xl border">
        <div className="border-b px-5 py-4">
          <h2 className="text-foreground text-sm font-semibold">Receita mensal ({selectedYear})</h2>
        </div>
        <div className="p-4">
          {data.monthly.length === 0 ? (
            <div className="text-muted-foreground flex h-[260px] items-center justify-center text-xs">
              Sem dados neste ano.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.monthly} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border) / 0.5)"
                />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: string) => {
                    const months = [
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
                    const m = parseInt(v.split("-")[1], 10) - 1
                    return months[m] ?? v
                  }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`
                  }
                />
                <RTooltip
                  cursor={{ fill: "hsl(var(--accent) / 0.4)" }}
                  formatter={(v: number, name: string) => [
                    formatBRL(v),
                    name === "gross" ? "Bruto" : name === "commission" ? "Comissão" : "Líquido",
                  ]}
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(label: string) => {
                    const [y, m] = label.split("-")
                    const months = [
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
                    return `${months[parseInt(m, 10) - 1]} de ${y}`
                  }}
                />
                <Bar
                  dataKey="commission"
                  name="commission"
                  stackId="a"
                  fill={COLORS.commission}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="providerNet"
                  name="providerNet"
                  stackId="a"
                  fill={COLORS.providerNet}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
          {/* Legend */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-6">
            <LegendItem color={COLORS.commission} label="Comissão (15%)" />
            <LegendItem color={COLORS.providerNet} label="Repassado ao prestador" />
          </div>
        </div>
      </section>

      {/* Per-provider breakdown */}
      <section className="border-border/50 bg-card overflow-hidden rounded-xl border">
        <div className="border-b px-5 py-4">
          <h2 className="text-foreground text-sm font-semibold">Prestadores por receita</h2>
        </div>
        {data.providers.length === 0 ? (
          <div className="text-muted-foreground px-5 py-12 text-center text-sm">
            Nenhum prestador com receita ainda.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-muted/30 text-muted-foreground h-10 border-b text-xs font-medium">
                  <th className="px-4 font-medium">Prestador</th>
                  <th className="px-4 text-right font-medium">Agendamentos</th>
                  <th className="px-4 text-right font-medium">Bruto</th>
                  <th className="px-4 text-right font-medium">Comissão</th>
                  <th className="px-4 text-right font-medium">Líquido</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.providers.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/20 h-14 transition-colors">
                    <td className="px-4">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="size-8 shrink-0">
                          {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt={p.name} /> : null}
                          <AvatarFallback className="bg-primary/8 text-primary text-[10px] font-semibold">
                            {initials(p.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-foreground truncate text-sm font-medium">{p.name}</p>
                          <p className="text-muted-foreground text-[10px]">
                            {p.completedCount} completo{p.completedCount === 1 ? "" : "s"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 text-right tabular-nums">{p.bookingCount}</td>
                    <td className="px-4 text-right font-medium tabular-nums">
                      {formatBRL(p.grossRevenue)}
                    </td>
                    <td className="px-4 text-right text-amber-600 tabular-nums dark:text-amber-400">
                      {formatBRL(p.commission)}
                    </td>
                    <td className="px-4 text-right font-medium text-emerald-600 tabular-nums dark:text-emerald-400">
                      {formatBRL(p.netEarnings)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Footer summary */}
      <div className="border-border/50 bg-muted/20 flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Percent className="size-4" />
          <span>
            A plataforma retém <strong>{FEE_RATE * 100}%</strong> sobre cada serviço pago. O
            restante é repassado ao prestador.
          </span>
        </div>
        <div className="text-muted-foreground flex items-center gap-4 text-xs">
          <span className="tabular-nums">
            <Users className="mr-1 inline size-3" />
            {data.providers.length} prestadores
          </span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiCard({
  icon: Icon,
  label,
  value,
  subtitle,
  accent = "primary",
}: {
  icon: typeof DollarSign
  label: string
  value: string
  subtitle: string
  accent?: "primary" | "amber" | "emerald" | "violet"
}) {
  const accentBg = {
    primary: "bg-primary/10 text-primary",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200",
  }[accent]

  return (
    <div className="border-border/50 bg-card hover:border-primary/20 rounded-xl border p-5 transition-colors">
      <span className={cn("flex size-10 items-center justify-center rounded-lg", accentBg)}>
        <Icon className="size-5" />
      </span>
      <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs font-medium tracking-wider uppercase">
        {label}
      </p>
      <p className="text-muted-foreground mt-0.5 text-[10px]">{subtitle}</p>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-sm" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground text-[11px]">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function CommissionsSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="size-8 rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border-border/50 bg-card rounded-xl border p-5">
            <Skeleton className="size-10 rounded-lg" />
            <Skeleton className="mt-3 h-7 w-28" />
            <Skeleton className="mt-1 h-3 w-20" />
            <Skeleton className="mt-0.5 h-2 w-16" />
          </div>
        ))}
      </div>
      <div className="border-border/50 bg-card rounded-xl border">
        <div className="border-b px-5 py-4">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="p-4">
          <Skeleton className="h-[260px] w-full rounded-md" />
        </div>
      </div>
    </div>
  )
}

export default AdminCommissions
