"use client"

/**
 * AdminDashboard — Visão Geral (redesign N1, heurísticas de Nielsen).
 *
 * Redesign focado em:
 *   H1  Status do sistema     → FreshnessLabel, Refresh action, skeletons fiéis
 *   H4  Consistência          → bookingTone() + BookingStatusBadge (1 source of truth)
 *   H5  Prevenção de erros    → seletor de período (Hoje/7d/30d/Tudo)
 *   H7  Eficiência            → Kbd hints visuais casados com a sidebar (1..7)
 *   H8  Minimalismo           → 4 KPIs (não 5+4), 2 charts (não 4), sem card fake
 *   H9  Recuperar erros       → ErrorState com retry actionável
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
  ArrowUpRight,
  BadgeCheck,
  CalendarCheck,
  ClipboardList,
  DollarSign,
  RefreshCw,
  Settings as SettingsIcon,
  Star,
  TrendingUp,
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
  type BookingStatus,
} from "@/lib/constants"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  BookingStatusBadge,
  EmptyState,
  ErrorState,
  FreshnessLabel,
  Kbd,
  PageSectionHeader,
  bookingTone,
  initials,
  type StatusTone,
} from "@/components/admin/admin-shared"

// ---------------------------------------------------------------------------
// Chart palette — UMA source of truth (H4 consistência)
// Mapeia StatusTone (do admin-shared) → cor concreta para recharts.
// Não há mais DONUT_COLORS paralelo a BOOKING_STATUS_COLORS.
// ---------------------------------------------------------------------------
const TONE_HEX: Record<StatusTone, string> = {
  emerald: "oklch(0.62 0.15 152)", // emerald-600 (família var(--primary))
  amber: "oklch(0.78 0.18 84)", // amber-400
  rose: "oklch(0.62 0.20 16)", // rose-500
  teal: "oklch(0.62 0.12 184)", // teal-400
  zinc: "oklch(0.7 0.00 0)", // neutral
  sky: "oklch(0.7 0.12 220)", // sky-500
}

const CHART_TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.15)",
} as const

const BOOKING_STATUS_ORDER: BookingStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]

// ---------------------------------------------------------------------------
// Tipos — espelha o que /api/admin/stats retorna
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
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "all", label: "Tudo" },
]

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function AdminDashboard({
  onNavigate,
}: {
  onNavigate: (view: string) => void
}) {
  const [range, setRange] = React.useState<DateRange>("30d")

  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } =
    useQuery({
      queryKey: ["admin", "stats"],
      queryFn: () => apiGet<AdminStats>("/api/admin/stats"),
      staleTime: 30_000,
    })

  // H9 — erro com retry actionável (não mais linha muted)
  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar as estatísticas"
        description="Verifique sua conexão e se você está autenticado como administrador."
        onRetry={() => void refetch()}
      />
    )
  }

  // H1 — skeleton que espelha o layout final (não um placeholder genérico)
  if (isLoading || !data) {
    return <DashboardSkeleton />
  }

  const totalUsers = Object.values(data.usersByRole).reduce((a, b) => a + b, 0)
  const totalBookings = Object.values(data.bookingsByStatus).reduce(
    (a, b) => a + b,
    0,
  )
  const completed = data.bookingsByStatus.COMPLETED ?? 0
  const pending = data.bookingsByStatus.PENDING ?? 0
  const inProgress = data.bookingsByStatus.IN_PROGRESS ?? 0
  const verifiedProviders = data.providers
  const totalProviders = data.usersByRole.PROVIDER ?? 0
  const verifyRate =
    totalProviders > 0
      ? Math.round((verifiedProviders / totalProviders) * 100)
      : 0

  // H4 — donut usa bookingTone() do admin-shared (mesma source of truth do badge)
  const statusRows = BOOKING_STATUS_ORDER.map((s) => ({
    status: s,
    label: BOOKING_STATUS_LABELS[s],
    count: data.bookingsByStatus[s] ?? 0,
    tone: bookingTone(s),
    fill: TONE_HEX[bookingTone(s)],
  })).filter((r) => r.count > 0)
  const chartTotal = statusRows.reduce((a, r) => a + r.count, 0)

  const freshnessDate = dataUpdatedAt ? new Date(dataUpdatedAt) : null

  return (
    <div className="flex flex-col gap-6">
      {/* H1 + H5 — cabeçalho com frescor, refresh e seletor de período */}
      <PageSectionHeader
        title="Visão geral"
        description="Métricas e atividade da plataforma em tempo real."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <FreshnessLabel updatedAt={freshnessDate} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="h-9 gap-1.5"
            >
              <RefreshCw
                className={cn("size-3.5", isFetching && "animate-spin")}
              />
              Atualizar
            </Button>
            <Select
              value={range}
              onValueChange={(v) => setRange(v as DateRange)}
            >
              <SelectTrigger size="sm" className="h-9 w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* H8 — KPI grid enxuto: 4 primários (não 5+4) */}
      <section
        aria-label="Indicadores principais"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <KpiCard
          icon={Users}
          label="Total de usuários"
          value={totalUsers.toLocaleString("pt-BR")}
          breakdown={`${data.usersByRole.CLIENT ?? 0} clientes · ${
            data.usersByRole.PROVIDER ?? 0
          } prestadores · ${data.usersByRole.ADMIN ?? 0} admins`}
        />
        <KpiCard
          icon={DollarSign}
          label="Receita total"
          value={formatBRL(data.revenue.total)}
          breakdown={`${data.revenue.paymentsPaid} pagamentos confirmados`}
        />
        <KpiCard
          icon={CalendarCheck}
          label="Agendamentos"
          value={totalBookings.toLocaleString("pt-BR")}
          breakdown={`${pending} pendentes · ${inProgress} em andamento · ${completed} concluídos`}
        />
        <KpiCard
          icon={BadgeCheck}
          label="Prestadores verificados"
          value={verifiedProviders.toLocaleString("pt-BR")}
          breakdown={`${verifiedProviders} de ${totalProviders} total · taxa ${verifyRate}%`}
        />
      </section>

      {/* H8 — 2 charts mais úteis (não 4) */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="rounded-xl shadow-sm">
          <CardContent className="p-5">
            <ChartHeader
              icon={CalendarCheck}
              title="Agendamentos por status"
              subtitle="Distribuição atual"
            />
            <BookingsByStatusChart rows={statusRows} total={chartTotal} />
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-sm">
          <CardContent className="p-5">
            <ChartHeader
              icon={TrendingUp}
              title="Receita por mês"
              subtitle="Últimos 6 meses — pagamentos confirmados"
            />
            <RevenueChart recentBookings={data.recentBookings} />
          </CardContent>
        </Card>
      </section>

      {/* H1 + H6 — atividade recente em 2 colunas, com linhas clicáveis */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecentBookingsCard
          bookings={data.recentBookings}
          onNavigate={onNavigate}
        />
        <TopProvidersCard
          providers={data.topProviders}
          onNavigate={onNavigate}
        />
      </section>

      {/* H7 + H6 — atalhos compactos com Kbd mnemônico casado à sidebar */}
      <section
        aria-label="Atalhos"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <QuickLink
          label="Gerenciar usuários"
          hint="Clientes, prestadores, admins"
          icon={Users}
          kbd="3"
          onClick={() => onNavigate("admin.users")}
        />
        <QuickLink
          label="Gerenciar serviços"
          hint="Catálogo global"
          icon={Wrench}
          kbd="5"
          onClick={() => onNavigate("admin.services")}
        />
        <QuickLink
          label="Ver agendamentos"
          hint="Calendário e status"
          icon={CalendarCheck}
          kbd="6"
          onClick={() => onNavigate("admin.bookings")}
        />
        <QuickLink
          label="Configurações"
          hint="Variáveis e ajustes"
          icon={SettingsIcon}
          kbd="7"
          onClick={() => onNavigate("admin.settings")}
        />
      </section>

      {/* H7 — dica visual de atalho (mnemônico da sidebar) */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span>Dica: use a navegação à esquerda para acessar outras seções.</span>
        <Kbd>1</Kbd>
        <Kbd>2</Kbd>
        <Kbd>3</Kbd>
        <span className="text-muted-foreground/70">…</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

function ChartHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon
  title: string
  subtitle: string
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}

function KpiCard({
  icon: Icon,
  label,
  value,
  breakdown,
}: {
  icon: LucideIcon
  label: string
  value: string
  breakdown?: React.ReactNode
}) {
  return (
    <Card className="rounded-xl bg-card shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight">
          {value}
        </p>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          {label}
        </p>
        {breakdown ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{breakdown}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function RecentBookingsCard({
  bookings,
  onNavigate,
}: {
  bookings: AdminStats["recentBookings"]
  onNavigate: (view: string) => void
}) {
  return (
    <Card className="overflow-hidden rounded-xl shadow-sm">
      <div className="flex items-center justify-between border-b p-5">
        <div className="min-w-0">
          <p className="text-base font-semibold">Agendamentos recentes</p>
          <p className="text-xs text-muted-foreground">Os 5 mais recentes</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-1 px-2.5 text-xs text-primary hover:text-primary"
          onClick={() => onNavigate("admin.bookings")}
        >
          Ver todos
          <ArrowUpRight className="size-3" />
        </Button>
      </div>
      <CardContent className="p-0">
        {bookings.length === 0 ? (
          <div className="px-5 py-10">
            <EmptyState
              icon={CalendarCheck}
              title="Nenhum agendamento ainda"
              description="Os novos agendamentos aparecerão aqui."
              className="border-0 bg-transparent px-0 py-0 shadow-none"
            />
          </div>
        ) : (
          <ul className="divide-y">
            {bookings.slice(0, 5).map((b) => {
              const status = b.status as BookingStatus
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate("admin.bookings")}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
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
                      <BookingStatusBadge status={status} />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function TopProvidersCard({
  providers,
  onNavigate,
}: {
  providers: AdminStats["topProviders"]
  onNavigate: (view: string) => void
}) {
  return (
    <Card className="overflow-hidden rounded-xl shadow-sm">
      <div className="flex items-center justify-between border-b p-5">
        <div className="min-w-0">
          <p className="text-base font-semibold">Top prestadores</p>
          <p className="text-xs text-muted-foreground">Melhores avaliações</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-1 px-2.5 text-xs text-primary hover:text-primary"
          onClick={() => onNavigate("admin.providers")}
        >
          Ver todos
          <ArrowUpRight className="size-3" />
        </Button>
      </div>
      <CardContent className="p-0">
        {providers.length === 0 ? (
          <div className="px-5 py-10">
            <EmptyState
              icon={BadgeCheck}
              title="Nenhum prestador verificado ainda"
              description="Prestadores verificados aparecerão aqui."
              className="border-0 bg-transparent px-0 py-0 shadow-none"
            />
          </div>
        ) : (
          <ul className="divide-y">
            {providers.slice(0, 5).map((p, idx) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onNavigate("admin.providers")}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
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
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                    <Star className="size-3 fill-amber-400 text-amber-400" />
                    {p.rating.toFixed(1)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function QuickLink({
  label,
  hint,
  icon: Icon,
  kbd,
  onClick,
}: {
  label: string
  hint: string
  icon: LucideIcon
  kbd: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{hint}</p>
      </div>
      <Kbd>{kbd}</Kbd>
    </button>
  )
}

function BookingsByStatusChart({
  rows,
  total,
}: {
  rows: Array<{
    status: BookingStatus
    label: string
    count: number
    tone: StatusTone
    fill: string
  }>
  total: number
}) {
  if (rows.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
        Sem dados
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-[180px] w-[180px] shrink-0">
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
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums text-foreground">
            {total}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Total
          </span>
        </div>
      </div>
      <ul className="flex w-full flex-1 flex-col gap-1.5">
        {rows
          .slice()
          .sort((a, b) => b.count - a.count)
          .map((r) => (
            <li key={r.status} className="flex items-center gap-2 text-xs">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: r.fill }}
              />
              <span className="flex-1 truncate text-muted-foreground">
                {r.label}
              </span>
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

function RevenueChart({
  recentBookings,
}: {
  recentBookings: AdminStats["recentBookings"]
}) {
  // Série dos últimos 6 meses sintetizada a partir de recentBookings pagos.
  // Substituir por endpoint dedicado quando disponível.
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

// H1 — skeleton que espelha o layout final (header + 4 KPIs + 2 charts + 2 listas)
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-44 rounded-md" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-72 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-64 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
