"use client"

/**
 * ClientDashboard — overview dashboard for the logged-in client.
 *
 * Sections:
 *  - 4 stat cards: Próximos agendamentos, Orçamentos ativos, Serviços
 *    concluídos, Total investido (sum of paid bookings)
 *  - Charts: bookings per month (bar), spending per category (pie)
 *  - Recent activity (latest 5 bookings/quotes)
 *  - Quick actions: "Pedir orçamento" / "Buscar prestadores"
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileText,
  Loader2,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react"

import { triggerHaptic } from "@/lib/haptics"

import { apiGet } from "@/lib/api"
import {
  BOOKING_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  type BookingStatus,
  type QuoteStatus,
  type ServiceUnit,
} from "@/lib/constants"
import { formatBRL, formatDateTime, formatRelative } from "@/lib/format"
import { useAuthStore } from "@/store/auth"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { EmptyState, SectionTitle, StatCard } from "@/components/shared/dashboard-shell"
import { OnboardingChecklist } from "@/components/client/onboarding-checklist"
import GeoAwarenessBadge from "@/components/client/geo-awareness-badge"
import { PreferenceToggles } from "@/components/shared/preference-toggles"
import {
  PageHeader,
  StatusBadge,
  bookingIcon,
  bookingTone,
  quoteIcon,
  quoteTone,
} from "@/components/client/client-shared"

// Emerald family palette for the category donut.
const PIE_COLORS = [
  "var(--chart-1)", // emerald-600
  "oklch(0.7 0.16 162)", // emerald-400
  "oklch(0.62 0.12 184)", // teal-400
  "oklch(0.6 0.13 200)", // teal-500
  "oklch(0.78 0.18 130)", // lime-400
  "oklch(0.65 0.15 145)", // emerald-500
  "oklch(0.55 0.13 175)", // teal-600
  "oklch(0.72 0.14 150)", // emerald-300
] as const

const CHART_TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.15)",
} as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Booking = {
  id: string
  status: BookingStatus
  scheduledAt: string
  amount: number
  paymentStatus: string
  service: {
    id: string
    title: string
    basePrice: number
    unit: ServiceUnit
    category?: { id: string; name: string } | null
  }
  provider: { id: string; name: string; avatarUrl?: string | null }
}

type Quote = {
  id: string
  status: QuoteStatus
  createdAt: string
  expiresAt: string
  provider: { id: string; name: string; avatarUrl?: string | null }
  items: Array<{ id: string; service: { id: string; title: string } }>
}

type BookingsResponse = {
  items: Booking[]
  total: number
  page: number
  limit: number
}
type QuotesResponse = {
  items: Quote[]
  total: number
  page: number
  limit: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientDashboard() {
  const navigate = useViewStore((s) => s.navigate)
  const openQuote = useUIStore((s) => s.openQuote)
  const user = useAuthStore((s) => s.user)

  const firstName = (user?.name ?? "").trim().split(/\s+/)[0]

  // Pull all bookings + quotes for stats. Server paginates at 50 max.
  const bookingsQuery = useQuery<BookingsResponse>({
    queryKey: ["bookings", "CLIENT", "dashboard"],
    queryFn: () =>
      apiGet<BookingsResponse>("/api/bookings", {
        role: "CLIENT",
        page: 1,
        limit: 50,
      }),
  })
  const quotesQuery = useQuery<QuotesResponse>({
    queryKey: ["quotes", "CLIENT", "dashboard"],
    queryFn: () =>
      apiGet<QuotesResponse>("/api/quotes", {
        role: "CLIENT",
        page: 1,
        limit: 50,
      }),
  })

  const bookings = bookingsQuery.data?.items ?? []
  const quotes = quotesQuery.data?.items ?? []

  // ---- Derived stats ---------------------------------------------------------
  const upcomingCount = bookings.filter((b) =>
    ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(b.status),
  ).length

  const activeQuotesCount = quotes.filter((q) => ["PENDING", "RESPONDED"].includes(q.status)).length

  const completedCount = bookings.filter((b) => b.status === "COMPLETED").length

  const totalInvested = bookings
    .filter((b) => b.paymentStatus === "PAID")
    .reduce((acc, b) => acc + b.amount, 0)

  // ---- Monthly bookings chart (last 6 months) --------------------------------
  // Note: computed without useMemo so the React Compiler can manage memoization.
  const monthlyData = (() => {
    const now = new Date()
    const baseMonths: Array<{ key: string; label: string; total: number }> = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      baseMonths.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: MONTH_LABELS[d.getMonth()]!,
        total: 0,
      })
    }
    const counts = bookings.reduce<Record<string, number>>((acc, b) => {
      const d = new Date(b.scheduledAt)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})
    return baseMonths.map((m) => ({ ...m, total: counts[m.key] ?? 0 }))
  })()

  // ---- Spending per category pie --------------------------------------------
  const spendingByCategory = (() => {
    const map = bookings
      .filter((b) => b.paymentStatus === "PAID")
      .reduce<Record<string, number>>((acc, b) => {
        const cat = b.service.category?.name ?? "Outros"
        acc[cat] = (acc[cat] ?? 0) + b.amount
        return acc
      }, {})
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  })()

  // ---- Recent activity (latest 5 bookings + 5 quotes, merged by date) --------
  const recentActivity = (() => {
    const fromBookings = bookings.slice(0, 8).map((b) => ({
      type: "booking" as const,
      id: b.id,
      at: b.scheduledAt,
      title: b.service.title,
      status: b.status,
      provider: b.provider,
      amount: b.amount,
    }))
    const fromQuotes = quotes.slice(0, 8).map((q) => ({
      type: "quote" as const,
      id: q.id,
      at: q.createdAt,
      title: q.items[0]?.service?.title ?? "Orçamento",
      status: q.status,
      provider: q.provider,
    }))
    return [...fromBookings, ...fromQuotes]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 5)
  })()

  const upcomingBookings = bookings
    .filter((b) => ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(b.status))
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())

  const activeQuotes = quotes
    .filter((q) => ["PENDING", "RESPONDED"].includes(q.status))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const inProgressBooking = bookings.find((b) => b.status === "IN_PROGRESS")

  const isLoading = bookingsQuery.isLoading || quotesQuery.isLoading

  return (
    <div className="space-y-6">
      {/* Greeting + quick actions */}
      <PageHeader
        title={`Olá${firstName ? ", " : ""}${firstName} 👋`}
        subtitle="Acompanhe seus agendamentos, orçamentos e gastos em um só lugar."
        action={
          <>
            <Button
              variant="outline"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.providers")
              }}
              className="border-border/60 hover:bg-muted/60 h-10 gap-2 rounded-xl text-xs font-medium shadow-2xs"
            >
              <Search className="size-4" />
              Buscar prestadores
            </Button>
            <Button
              onClick={() => {
                triggerHaptic("selection")
                openQuote()
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-10 gap-2 rounded-xl text-xs font-semibold shadow-2xs"
            >
              <Plus className="size-4" />
              Pedir orçamento
            </Button>
          </>
        }
      />

      {/* Quick Search Dock — in-panel provider discovery */}
      <Card className="border-border/60 from-card via-card to-primary/5 relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-2xs sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-lg">
                <Search className="size-4" />
              </span>
              <h2 className="text-foreground text-sm font-semibold tracking-tight">
                Encontre prestadores perto de você
              </h2>
            </div>
            <p className="text-muted-foreground text-xs">
              Profissionais avaliados com garantia de pagamento seguro em Governador Valadares.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              navigate("client.providers")
            }}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1 self-start rounded-xl px-3 text-xs font-semibold shadow-2xs sm:self-auto"
          >
            Abrir busca completa
            <ChevronRight className="size-3.5" />
          </Button>
        </div>

        {/* Quick Search Input with Enter handler */}
        <div className="mt-3.5 flex gap-2">
          <div className="relative flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              type="text"
              placeholder="O que você precisa? Ex: eletricista, encanador, ar-condicionado..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.currentTarget.value.trim()) {
                  triggerHaptic("selection")
                  navigate("client.providers", { q: e.currentTarget.value.trim() })
                }
              }}
              className="border-border/70 bg-background text-foreground placeholder:text-muted-foreground/70 focus:ring-primary h-10 w-full rounded-xl border pr-3 pl-9 text-xs shadow-2xs focus:ring-1 focus:outline-none"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              triggerHaptic("selection")
              navigate("client.providers")
            }}
            className="border-border/70 hover:bg-muted/60 h-10 rounded-xl px-4 text-xs font-medium"
          >
            Buscar
          </Button>
        </div>

        {/* Quick category shortcut pills */}
        <div className="border-border/40 mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2">
          <span className="text-muted-foreground mr-1 text-[11px] font-medium">Populares:</span>
          {[
            { label: "Eletricista", q: "Eletricista" },
            { label: "Pintor", q: "Pintor" },
            { label: "Ar-Condicionado", q: "Ar-Condicionado" },
            { label: "Encanador", q: "Encanador" },
            { label: "Limpeza", q: "Limpeza" },
            { label: "Chaveiro", q: "Chaveiro" },
          ].map((cat) => (
            <button
              key={cat.label}
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.providers", { q: cat.q })
              }}
              className="border-border/50 bg-background/60 hover:bg-muted/60 text-muted-foreground hover:text-foreground rounded-lg border px-2.5 py-1 text-[11px] font-medium shadow-2xs transition-colors"
            >
              {cat.label}
            </button>
          ))}
        </div>
      </Card>

      {/* Geo-awareness badge — shows provider count near user */}
      <GeoAwarenessBadge />

      {/* In-progress active service alert if any */}
      {inProgressBooking && (
        <div className="border-primary/30 bg-primary/5 flex flex-col justify-between gap-3 rounded-2xl border p-4 shadow-2xs sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="relative flex size-3 shrink-0">
              <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
              <span className="bg-primary relative inline-flex size-3 rounded-full" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-primary text-[11px] font-bold tracking-wider uppercase">
                  Serviço em Andamento
                </span>
                <span className="text-muted-foreground text-[10px]">·</span>
                <span className="text-muted-foreground text-xs">
                  {formatDateTime(inProgressBooking.scheduledAt)}
                </span>
              </div>
              <p className="truncate text-sm font-semibold">
                {inProgressBooking.service.title} com {inProgressBooking.provider.name}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              navigate("client.bookings")
            }}
            className="h-8.5 shrink-0 rounded-xl text-xs font-semibold shadow-2xs"
          >
            Acompanhar
            <ChevronRight className="ml-1 size-3.5" />
          </Button>
        </div>
      )}

      {/* Escrow & Protection Ribbon */}
      <div className="border-border/50 bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
            <ShieldCheck className="size-5" />
          </div>
          <div className="text-xs">
            <p className="text-foreground font-semibold">
              Garantia Severinno Escrow & Proteção 90 Dias
            </p>
            <p className="text-muted-foreground">
              Seu pagamento fica seguro na custódia e só é liberado ao profissional após a sua
              aprovação final do serviço.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            triggerHaptic("selection")
            navigate("client.bookings")
          }}
          className="text-primary hover:text-primary/80 inline-flex cursor-pointer items-center gap-1 self-start text-xs font-semibold sm:self-center"
        >
          <span>Gerenciar liberação</span>
          <ChevronRight className="size-3.5" />
        </button>
      </div>

      {/* Onboarding checklist — only shows if profile is incomplete */}
      <OnboardingChecklist />

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          index={0}
          icon={CalendarDays}
          label="Próximos agendamentos"
          value={upcomingCount}
          tone="primary"
          hint="Pendentes, confirmados e em andamento"
        />
        <StatCard
          index={1}
          icon={FileText}
          label="Orçamentos ativos"
          value={activeQuotesCount}
          tone="amber"
          hint="Aguardando resposta ou ação"
        />
        <StatCard
          index={2}
          icon={CheckCircle2}
          label="Serviços concluídos"
          value={completedCount}
          tone="sky"
          hint="Histórico de serviços realizados"
        />
        <StatCard
          index={3}
          icon={Wallet}
          label="Total investido"
          value={formatBRL(totalInvested)}
          tone="primary"
          hint="Soma de pagamentos confirmados"
        />
      </div>

      {/* Sound & vibration preferences */}
      <PreferenceToggles
        soundEnabled={user?.soundEnabled ?? true}
        vibrateEnabled={user?.vibrateEnabled ?? true}
      />

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Monthly bookings */}
        <Card className="border-border/50 bg-card rounded-2xl border shadow-2xs lg:col-span-3">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-lg">
                  <TrendingUp className="size-4" />
                </span>
                <div>
                  <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                    Evolução de Agendamentos
                  </p>
                  <p className="text-sm font-semibold">Histórico mensal (últimos 6 meses)</p>
                </div>
              </div>
            </div>
            <div className="h-56 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-bookings" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                    allowDecimals={false}
                  />
                  <Tooltip
                    formatter={(v: number) => [`${v} agendamento${v !== 1 ? "s" : ""}`, "Total"]}
                    cursor={{ stroke: "var(--primary)", strokeWidth: 1, strokeDasharray: "3 3" }}
                    contentStyle={CHART_TOOLTIP_STYLE}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    fill="url(#grad-bookings)"
                    activeDot={{ r: 4, fill: "var(--primary)" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Spending per category pie */}
        <Card className="border-border/50 bg-card rounded-2xl border shadow-2xs lg:col-span-2">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-lg">
                  <Wallet className="size-4" />
                </span>
                <div>
                  <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                    Distribuição de Gastos
                  </p>
                  <p className="text-sm font-semibold">Por categoria de serviço</p>
                </div>
              </div>
            </div>
            {spendingByCategory.length === 0 ? (
              <div className="flex h-56 flex-col items-center justify-center gap-2 text-center">
                <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
                  <Wallet className="size-5" />
                </span>
                <p className="text-muted-foreground text-sm">Sem gastos confirmados ainda.</p>
              </div>
            ) : (
              <div className="h-48 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={spendingByCategory}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      stroke="var(--background)"
                      strokeWidth={2}
                    >
                      {spendingByCategory.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, n: string) => [formatBRL(v), n]}
                      contentStyle={CHART_TOOLTIP_STYLE}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            {spendingByCategory.length > 0 ? (
              <ul className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {spendingByCategory.slice(0, 6).map((c, i) => (
                  <li key={c.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{
                        background: PIE_COLORS[i % PIE_COLORS.length],
                      }}
                    />
                    <span className="text-muted-foreground truncate">{c.name}</span>
                    <span className="ml-auto shrink-0 font-medium tabular-nums">
                      {formatBRL(c.value)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <div className="space-y-3">
        <SectionTitle
          title="Atividade recente"
          description="Seus últimos agendamentos e orçamentos."
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.bookings")
              }}
              className="text-primary hover:text-primary h-9 gap-1.5 text-xs font-semibold"
            >
              Ver tudo
              <ChevronRight className="size-4" />
            </Button>
          }
        />

        {isLoading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 p-8 text-sm">
            <Loader2 className="size-5 animate-spin" />
            Carregando atividade…
          </div>
        ) : recentActivity.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Nenhuma atividade ainda"
            description="Quando você começar a agendar ou solicitar orçamentos, suas atividades recentes aparecerão aqui."
            action={
              <Button
                onClick={() => {
                  triggerHaptic("selection")
                  navigate("client.providers")
                }}
                className="mt-2 gap-2 rounded-xl text-xs font-semibold shadow-2xs"
              >
                <MapPin className="size-4" />
                Buscar prestadores
              </Button>
            }
          />
        ) : (
          <Card className="border-border/50 bg-card overflow-hidden rounded-2xl border shadow-2xs">
            <CardContent className="divide-y p-0">
              {recentActivity.map((a) => {
                const provider = a.provider
                const initials = (provider.name ?? "")
                  .split(" ")
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()
                const isBooking = a.type === "booking"
                const status = a.status as BookingStatus | QuoteStatus
                const tone = isBooking
                  ? bookingTone(status as BookingStatus)
                  : quoteTone(status as QuoteStatus)
                const Icon = isBooking
                  ? bookingIcon(status as BookingStatus)
                  : quoteIcon(status as QuoteStatus)
                const label = isBooking
                  ? BOOKING_STATUS_LABELS[status as BookingStatus]
                  : QUOTE_STATUS_LABELS[status as QuoteStatus]
                return (
                  <button
                    key={`${a.type}-${a.id}`}
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection")
                      navigate(isBooking ? "client.bookings" : "client.quotes")
                    }}
                    className="hover:bg-muted/40 focus-visible:bg-muted/40 flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors outline-none"
                  >
                    <Avatar className="border-border/40 size-9 shrink-0 border">
                      {provider.avatarUrl ? (
                        <AvatarImage
                          src={provider.avatarUrl}
                          alt={provider.name}
                          className="object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="bg-muted text-foreground text-[10px] font-semibold">
                        {initials || "P"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm font-medium">{a.title}</p>
                      <p className="text-muted-foreground truncate text-xs tabular-nums">
                        {isBooking ? "Agendamento" : "Orçamento"} · {provider.name} ·{" "}
                        {formatRelative(a.at)}
                      </p>
                    </div>
                    {isBooking && a.type === "booking" ? (
                      <span className="text-foreground hidden text-sm font-semibold tabular-nums sm:block">
                        {formatBRL(a.amount)}
                      </span>
                    ) : null}
                    <StatusBadge tone={tone} icon={Icon}>
                      {label}
                    </StatusBadge>
                  </button>
                )
              })}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Upcoming bookings + Active quotes side-by-side (mobile stacked) */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Upcoming bookings */}
        <div className="space-y-3">
          <SectionTitle
            title="Próximos agendamentos"
            description="Serviços agendados para os próximos dias."
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  navigate("client.bookings")
                }}
                className="text-primary hover:text-primary h-9 gap-1.5 text-xs font-semibold"
              >
                Ver tudo
                <ChevronRight className="size-4" />
              </Button>
            }
          />
          {isLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 p-8 text-sm">
              <Loader2 className="size-5 animate-spin" />
              Carregando agendamentos…
            </div>
          ) : upcomingBookings.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Nenhum agendamento próximo"
              description="Que tal agendar seu primeiro serviço? Explore prestadores verificados perto de você."
              action={
                <Button
                  onClick={() => {
                    triggerHaptic("selection")
                    navigate("client.providers")
                  }}
                  className="mt-2 gap-2 rounded-xl text-xs font-semibold shadow-2xs"
                >
                  <MapPin className="size-4" />
                  Buscar prestadores
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {upcomingBookings.slice(0, 3).map((b) => {
                const initials = (b.provider.name ?? "")
                  .split(" ")
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection")
                      navigate("client.bookings")
                    }}
                    className="border-border/50 bg-card hover:border-primary/40 focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3.5 rounded-2xl border p-3.5 text-left transition-all outline-none hover:shadow-xs focus-visible:ring-2"
                  >
                    <Avatar className="border-border/40 size-10 shrink-0 border">
                      {b.provider.avatarUrl ? (
                        <AvatarImage
                          src={b.provider.avatarUrl}
                          alt={b.provider.name}
                          className="object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="bg-muted text-foreground text-[10px] font-semibold">
                        {initials || "P"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm font-semibold">
                        {b.service.title}
                      </p>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs tabular-nums">
                        {formatDateTime(b.scheduledAt)} · {b.provider.name}
                      </p>
                    </div>
                    {b.amount > 0 && (
                      <span className="text-foreground hidden text-xs font-bold tabular-nums sm:inline-block">
                        {formatBRL(b.amount)}
                      </span>
                    )}
                    <StatusBadge
                      tone={bookingTone(b.status as BookingStatus)}
                      icon={bookingIcon(b.status as BookingStatus)}
                    >
                      {BOOKING_STATUS_LABELS[b.status as BookingStatus]}
                    </StatusBadge>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Active quotes */}
        <div className="space-y-3">
          <SectionTitle
            title="Orçamentos ativos"
            description="Aguardando resposta do prestador ou sua ação."
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  navigate("client.quotes")
                }}
                className="text-primary hover:text-primary h-9 gap-1.5 text-xs font-semibold"
              >
                Ver tudo
                <ChevronRight className="size-4" />
              </Button>
            }
          />
          {isLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 p-8 text-sm">
              <Loader2 className="size-5 animate-spin" />
              Carregando orçamentos…
            </div>
          ) : activeQuotes.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nenhum orçamento ativo"
              description="Solicite um orçamento e acompanhe a resposta dos prestadores aqui."
              action={
                <Button
                  onClick={() => {
                    triggerHaptic("selection")
                    openQuote()
                  }}
                  className="mt-2 gap-2 rounded-xl text-xs font-semibold shadow-2xs"
                >
                  <Plus className="size-4" />
                  Pedir orçamento
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {activeQuotes.slice(0, 3).map((q) => {
                const initials = (q.provider.name ?? "")
                  .split(" ")
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection")
                      navigate("client.quotes")
                    }}
                    className="border-border/50 bg-card hover:border-primary/40 focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3.5 rounded-2xl border p-3.5 text-left transition-all outline-none hover:shadow-xs focus-visible:ring-2"
                  >
                    <Avatar className="border-border/40 size-10 shrink-0 border">
                      {q.provider.avatarUrl ? (
                        <AvatarImage
                          src={q.provider.avatarUrl}
                          alt={q.provider.name}
                          className="object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="bg-muted text-foreground text-[10px] font-semibold">
                        {initials || "P"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm font-semibold">
                        {q.items[0]?.service?.title ?? "Orçamento sob medida"}
                      </p>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs tabular-nums">
                        {q.provider.name} · {formatRelative(q.createdAt)}
                      </p>
                    </div>
                    <StatusBadge
                      tone={quoteTone(q.status as QuoteStatus)}
                      icon={quoteIcon(q.status as QuoteStatus)}
                    >
                      {QUOTE_STATUS_LABELS[q.status as QuoteStatus]}
                    </StatusBadge>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
