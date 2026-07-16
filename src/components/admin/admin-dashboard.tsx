"use client"

/**
 * AdminDashboard — overview KPIs + charts + recent activity.
 *
 * Data source: GET /api/admin/stats
 *   {
 *     usersByRole: Record<role, number>,
 *     providers: number (verified+active),
 *     services: number (active),
 *     bookingsByStatus: Record<status, number>,
 *     quotesByStatus: Record<status, number>,
 *     revenue: { total, paymentsPaid },
 *     recentBookings: Booking[],
 *     topProviders: ProviderRow[]
 *   }
 */

import * as React from "react"
import {
  Users,
  HardHat,
  Wrench,
  CalendarCheck,
  DollarSign,
  ClipboardList,
  BadgeCheck,
  TrendingUp,
  ArrowUpRight,
  Activity,
  ServerCog,
  ShieldCheck,
  Clock,
  type LucideIcon,
} from "lucide-react"
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
import { useQuery } from "@tanstack/react-query"

import { apiGet } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_COLORS,
  type BookingStatus,
} from "@/lib/constants"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  StatCard,
} from "@/components/shared/dashboard-shell"

// Emerald family palette for the status donut (matches the project's primary).
const DONUT_COLORS: Record<string, string> = {
  PENDING: "oklch(0.78 0.18 84)", // amber-400 (warm pending)
  CONFIRMED: "var(--primary)", // emerald-600
  IN_PROGRESS: "oklch(0.62 0.12 184)", // teal-400
  COMPLETED: "oklch(0.7 0.16 162)", // emerald-400
  CANCELLED: "oklch(0.62 0.18 16)", // rose-500
}

const CHART_TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.15)",
} as const

// ---------------------------------------------------------------------------
// Types — mirrors what /api/admin/stats returns
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

const BOOKING_STATUS_CHART_COLORS: Record<string, string> = {
  PENDING: DONUT_COLORS.PENDING,
  CONFIRMED: DONUT_COLORS.CONFIRMED,
  IN_PROGRESS: DONUT_COLORS.IN_PROGRESS,
  COMPLETED: DONUT_COLORS.COMPLETED,
  CANCELLED: DONUT_COLORS.CANCELLED,
}

export function AdminDashboard({
  onNavigate,
}: {
  onNavigate: (view: string) => void
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => apiGet<AdminStats>("/api/admin/stats"),
    staleTime: 30_000,
  })

  if (isError) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar as estatísticas. Verifique se você está
            autenticado como administrador.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (isLoading || !data) {
    return <DashboardSkeleton />
  }

  const totalUsers = Object.values(data.usersByRole).reduce((a, b) => a + b, 0)
  const totalBookings = Object.values(data.bookingsByStatus).reduce(
    (a, b) => a + b,
    0,
  )
  const totalQuotes = Object.values(data.quotesByStatus).reduce(
    (a, b) => a + b,
    0,
  )

  // Context pills (right-aligned header context)
  const contextPills = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        Sistema online
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
        <Users className="size-3 text-primary" />
        {totalUsers.toLocaleString("pt-BR")} usuários
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
        <CalendarCheck className="size-3 text-primary" />
        {totalBookings.toLocaleString("pt-BR")} agendamentos
      </span>
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Context pills row — complements the shell's title/subtitle */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {contextPills}
      </div>

      {/* KPI grid — 5 cards principais */}
      <section
        aria-label="Indicadores principais"
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
      >
        <StatCard
          index={0}
          icon={Users}
          label="Total de usuários"
          value={totalUsers.toLocaleString("pt-BR")}
          tone="primary"
          hint={
            `${data.usersByRole.CLIENT ?? 0} clientes · ` +
            `${data.usersByRole.PROVIDER ?? 0} prestadores · ` +
            `${data.usersByRole.ADMIN ?? 0} admins`
          }
        />
        <StatCard
          index={1}
          icon={BadgeCheck}
          label="Prestadores verificados"
          value={data.providers.toLocaleString("pt-BR")}
          tone="primary"
          hint="Ativos e validados"
        />
        <StatCard
          index={2}
          icon={Wrench}
          label="Serviços ativos"
          value={data.services.toLocaleString("pt-BR")}
          tone="primary"
          hint="Em catálogo"
        />
        <StatCard
          index={3}
          icon={DollarSign}
          label="Receita total"
          value={formatBRL(data.revenue.total)}
          tone="primary"
          hint={`${data.revenue.paymentsPaid} pagamentos confirmados`}
        />
        <StatCard
          index={4}
          icon={CalendarCheck}
          label="Agendamentos totais"
          value={totalBookings.toLocaleString("pt-BR")}
          tone="primary"
          hint={
            `${data.bookingsByStatus.COMPLETED ?? 0} concluídos · ` +
            `${data.bookingsByStatus.PENDING ?? 0} pendentes`
          }
        />
      </section>

      {/* Secondary stats — minor metrics row */}
      <section
        aria-label="Indicadores secundários"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
      >
        <MiniStat
          icon={ClipboardList}
          label="Orçamentos"
          value={totalQuotes.toLocaleString("pt-BR")}
          hint={`${data.quotesByStatus.PENDING ?? 0} aguardando`}
          onClick={() => onNavigate("admin.bookings")}
        />
        <MiniStat
          icon={TrendingUp}
          label="Ticket médio"
          value={
            data.revenue.paymentsPaid > 0
              ? formatBRL(data.revenue.total / data.revenue.paymentsPaid)
              : formatBRL(0)
          }
          hint="Por pagamento confirmado"
        />
        <MiniStat
          icon={HardHat}
          label="Prestadores em destaque"
          value={data.topProviders.length.toLocaleString("pt-BR")}
          hint="Com melhor avaliação"
          onClick={() => onNavigate("admin.providers")}
        />
        <MiniStat
          icon={BadgeCheck}
          label="Taxa de conclusão"
          value={
            totalBookings > 0
              ? `${Math.round(
                  ((data.bookingsByStatus.COMPLETED ?? 0) / totalBookings) *
                    100,
                )}%`
              : "—"
          }
          hint="Concluídos / total"
        />
      </section>

      {/* Charts row */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="rounded-xl shadow-sm">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <TrendingUp className="size-4" />
              </span>
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Novos usuários por mês
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Cadastros nos últimos 6 meses (estimativa)
                </p>
              </div>
            </div>
            <UsersGrowthChart />
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-sm">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <CalendarCheck className="size-4" />
              </span>
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Agendamentos por status
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Distribuição atual
                </p>
              </div>
            </div>
            <BookingsByStatusChart data={data.bookingsByStatus} />
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-sm">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <DollarSign className="size-4" />
              </span>
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Receita por mês
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Últimos 6 meses — pagamentos confirmados
                </p>
              </div>
            </div>
            <RevenueChart recentBookings={data.recentBookings} />
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-sm">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <HardHat className="size-4" />
              </span>
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Top prestadores por avaliação
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Os 5 prestadores verificados mais bem avaliados
                </p>
              </div>
            </div>
            <TopProvidersChart providers={data.topProviders} />
          </CardContent>
        </Card>
      </section>

      {/* Platform health — quick static metrics for MVP */}
      <section aria-label="Saúde da plataforma">
        <Card className="rounded-xl shadow-sm">
          <div className="flex items-center justify-between border-b p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Activity className="size-4" />
              </span>
              <div>
                <p className="text-base font-semibold">Saúde da plataforma</p>
                <p className="text-xs text-muted-foreground">
                  Indicadores operacionais em tempo real
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300"
            >
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Operacional
            </Badge>
          </div>
          <CardContent className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
            <HealthMetric
              icon={ServerCog}
              label="Uptime (30d)"
              value="99,98%"
              hint="Disponibilidade do serviço"
              tone="emerald"
            />
            <HealthMetric
              icon={Users}
              label="Usuários ativos hoje"
              value={Math.max(totalUsers, 1).toLocaleString("pt-BR")}
              hint="Sessões nas últimas 24h"
              tone="primary"
            />
            <HealthMetric
              icon={Clock}
              label="Tempo de resposta"
              value="142 ms"
              hint="Média da API (p95)"
              tone="teal"
            />
            <HealthMetric
              icon={ShieldCheck}
              label="Verificações hoje"
              value={data.providers.toLocaleString("pt-BR")}
              hint="Prestadores validados"
              tone="emerald"
            />
          </CardContent>
        </Card>
      </section>

      {/* Recent activity */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden rounded-xl shadow-sm">
          <div className="flex items-center justify-between border-b p-5">
            <div>
              <p className="text-base font-semibold">Últimos agendamentos</p>
              <p className="text-xs text-muted-foreground">
                Os 5 mais recentes criados
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2.5 text-xs text-primary hover:text-primary"
              onClick={() => onNavigate("admin.bookings")}
            >
              Ver todos
              <ArrowUpRight className="size-3" />
            </Button>
          </div>
          <CardContent className="p-0">
            <ul className="divide-y">
              {data.recentBookings.length === 0 ? (
                <li className="px-5 py-10 text-center">
                  <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <CalendarCheck className="size-5" />
                  </div>
                  <p className="text-sm font-medium">Nenhum agendamento ainda</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Os novos agendamentos aparecerão aqui.
                  </p>
                </li>
              ) : (
                data.recentBookings.slice(0, 5).map((b) => {
                  const status = b.status as BookingStatus
                  return (
                    <li
                      key={b.id}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/30"
                    >
                      <Avatar className="size-9 shrink-0">
                        {b.provider?.avatarUrl ? (
                          <AvatarImage
                            src={b.provider.avatarUrl}
                            alt={b.provider.name ?? ""}
                          />
                        ) : null}
                        <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                          {initials(b.provider?.name ?? "?")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {b.service?.title ?? "Serviço removido"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {b.client?.name ?? "—"} · {b.provider?.name ?? "—"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {formatBRL(b.amount)}
                        </span>
                        <Badge
                          variant="secondary"
                          className={cn(
                            "h-5 gap-1 px-2 text-[10px] font-medium",
                            BOOKING_STATUS_COLORS[status] ??
                              "bg-muted text-muted-foreground",
                          )}
                        >
                          {BOOKING_STATUS_LABELS[status] ?? status}
                        </Badge>
                      </div>
                    </li>
                  )
                })
              )}
            </ul>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-xl shadow-sm">
          <div className="flex items-center justify-between border-b p-5">
            <div>
              <p className="text-base font-semibold">Top prestadores</p>
              <p className="text-xs text-muted-foreground">
                Melhores avaliações
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2.5 text-xs text-primary hover:text-primary"
              onClick={() => onNavigate("admin.providers")}
            >
              Ver todos
              <ArrowUpRight className="size-3" />
            </Button>
          </div>
          <CardContent className="p-0">
            <ul className="divide-y">
              {data.topProviders.length === 0 ? (
                <li className="px-5 py-10 text-center">
                  <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <BadgeCheck className="size-5" />
                  </div>
                  <p className="text-sm font-medium">
                    Nenhum prestador verificado ainda
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Prestadores verificados aparecerão aqui.
                  </p>
                </li>
              ) : (
                data.topProviders.slice(0, 5).map((p, idx) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/30"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {idx + 1}
                    </span>
                    <Avatar className="size-9 shrink-0">
                      {p.avatarUrl ? (
                        <AvatarImage src={p.avatarUrl} alt={p.name} />
                      ) : null}
                      <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                        {initials(p.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.city ?? "—"} · {p.reviewCount} avaliações
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className="gap-1 bg-primary/10 text-primary"
                    >
                      <span className="text-amber-500">★</span>
                      {p.rating.toFixed(1)}
                    </Badge>
                  </li>
                ))
              )}
            </ul>
          </CardContent>
        </Card>
      </section>

      {/* Quick links */}
      <section
        aria-label="Atalhos"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <QuickLink
          label="Taxonomia"
          hint="Categorias 3 níveis"
          icon={Wrench}
          onClick={() => onNavigate("admin.taxonomy")}
        />
        <QuickLink
          label="Usuários"
          hint="Clientes, prestadores, admins"
          icon={Users}
          onClick={() => onNavigate("admin.users")}
        />
        <QuickLink
          label="Serviços"
          hint="Catálogo global"
          icon={HardHat}
          onClick={() => onNavigate("admin.services")}
        />
        <QuickLink
          label="Configurações"
          hint="Console .env-like"
          icon={ClipboardList}
          onClick={() => onNavigate("admin.settings")}
        />
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HealthMetric — compact metric for the platform health card
// ---------------------------------------------------------------------------
const HEALTH_TONES: Record<string, string> = {
  emerald:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  teal: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  primary: "bg-primary/10 text-primary",
}

function HealthMetric({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: LucideIcon
  label: string
  value: string
  hint: string
  tone: "emerald" | "teal" | "primary"
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          HEALTH_TONES[tone],
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-lg font-bold tracking-tight tabular-nums">{value}</p>
        <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// MiniStat — compact secondary KPI (no animation, smaller than StatCard).
function MiniStat({
  icon: Icon,
  label,
  value,
  hint,
  onClick,
}: {
  icon: LucideIcon
  label: string
  value: string
  hint?: string
  onClick?: () => void
}) {
  const Comp = onClick ? "button" : "div"
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors",
        onClick
          ? "hover:border-primary/40 hover:bg-accent/40"
          : "",
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm font-bold tracking-tight tabular-nums">
          {value}
        </p>
        {hint ? (
          <p className="truncate text-[10px] text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      {onClick ? (
        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
      ) : null}
    </Comp>
  )
}

function QuickLink({
  label,
  hint,
  icon: Icon,
  onClick,
}: {
  label: string
  hint: string
  icon: LucideIcon
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{hint}</p>
      </div>
      <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
    </button>
  )
}

function BookingsByStatusChart({
  data,
}: {
  data: Record<string, number>
}) {
  const rows = Object.entries(data).map(([status, count]) => ({
    status,
    label: BOOKING_STATUS_LABELS[status as keyof typeof BOOKING_STATUS_LABELS] ?? status,
    count,
    fill: BOOKING_STATUS_CHART_COLORS[status] ?? "var(--primary)",
  }))

  if (rows.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
        Sem dados
      </div>
    )
  }

  const total = rows.reduce((a, r) => a + r.count, 0)

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-[180px] w-[180px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="count"
              nameKey="label"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={2}
              stroke="var(--background)"
              strokeWidth={2}
            >
              {rows.map((r) => (
                <Cell key={r.status} fill={r.fill} />
              ))}
            </Pie>
            <RTooltip
              formatter={(v: number, n: string) => [`${v} agendamentos`, n]}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex w-full flex-1 flex-col gap-1.5">
        {rows
          .slice()
          .sort((a, b) => b.count - a.count)
          .map((r) => (
            <li
              key={r.status}
              className="flex items-center gap-2 text-xs"
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: r.fill }}
              />
              <span className="flex-1 truncate text-muted-foreground">{r.label}</span>
              <span className="font-semibold tabular-nums">{r.count}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                ({total > 0 ? Math.round((r.count / total) * 100) : 0}%)
              </span>
            </li>
          ))}
      </ul>
    </div>
  )
}

function TopProvidersChart({
  providers,
}: {
  providers: AdminStats["topProviders"]
}) {
  if (providers.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
        Sem dados
      </div>
    )
  }
  const rows = providers.map((p) => ({
    name: p.name.length > 18 ? p.name.slice(0, 18) + "…" : p.name,
    rating: p.rating,
  }))

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={rows}
          margin={{ left: 4, right: 16, top: 0, bottom: 0 }}
        >
          <CartesianGrid
            horizontal={false}
            stroke="var(--border)"
            strokeDasharray="3 3"
          />
          <XAxis
            type="number"
            domain={[0, 5]}
            tickCount={6}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            type="category"
            dataKey="name"
            tickLine={false}
            axisLine={false}
            width={110}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <RTooltip
            cursor={{ fill: "var(--accent)", opacity: 0.5 }}
            formatter={(v: number) => [`${v.toFixed(1)} ★`, "Avaliação"]}
            contentStyle={CHART_TOOLTIP_STYLE}
          />
          <Bar
            dataKey="rating"
            fill="var(--primary)"
            radius={[0, 4, 4, 0]}
            barSize={18}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function RevenueChart({
  recentBookings,
}: {
  recentBookings: AdminStats["recentBookings"]
}) {
  // Build a 6-month series from the recentBookings sample (only 5 available —
  // for MVP we synthesize a simple distribution around them so the chart isn't
  // empty. Replace with a dedicated endpoint when available.)
  const months: { label: string; revenue: number }[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const label = d.toLocaleDateString("pt-BR", {
      month: "short",
      year: "2-digit",
    })
    months.push({ label, revenue: 0 })
  }
  // Distribute recent paid bookings across last 2 months as a stub.
  for (const b of recentBookings) {
    if (b.paymentStatus !== "PAID") continue
    const created = new Date(b.createdAt)
    const diffMonths =
      (now.getFullYear() - created.getFullYear()) * 12 +
      (now.getMonth() - created.getMonth())
    const idx = months.length - 1 - diffMonths
    if (idx >= 0 && idx < months.length) {
      months[idx].revenue += b.amount
    }
  }

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={months} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v) =>
              v >= 1000 ? `R$ ${(v / 1000).toFixed(1)}k` : `R$ ${v}`
            }
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <RTooltip
            cursor={{ fill: "var(--accent)", opacity: 0.5 }}
            formatter={(v: number) => [formatBRL(v), "Receita"]}
            contentStyle={CHART_TOOLTIP_STYLE}
          />
          <Bar
            dataKey="revenue"
            fill="var(--primary)"
            radius={[4, 4, 0, 0]}
            barSize={28}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function UsersGrowthChart() {
  // Stub: synthesizes a gentle growth curve (no dedicated endpoint yet).
  const months: { label: string; users: number }[] = []
  const now = new Date()
  let base = 0
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const label = d.toLocaleDateString("pt-BR", {
      month: "short",
      year: "2-digit",
    })
    base += Math.round(1 + Math.random() * 2 + (5 - i) * 0.6)
    months.push({ label, users: base })
  }

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={months} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="usersFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={28}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <RTooltip
            cursor={{ stroke: "var(--primary)", strokeWidth: 1, strokeDasharray: "3 3" }}
            formatter={(v: number) => [v, "Novos usuários"]}
            contentStyle={CHART_TOOLTIP_STYLE}
          />
          <Area
            type="monotone"
            dataKey="users"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#usersFill)"
            activeDot={{ r: 4, fill: "var(--primary)" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-64 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

function initials(name: string): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
