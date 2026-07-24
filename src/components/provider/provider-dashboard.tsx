"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  ArrowRight,
  Banknote,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  MapPin,
  Plus,
  Send,
  Star,
  Wallet,
  XCircle,
} from "lucide-react"
import {
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
} from "date-fns"
import { ptBR } from "date-fns/locale"

import { apiGet } from "@/lib/api"
import {
  BOOKING_STATUS_LABELS,
  type BookingStatus,
} from "@/lib/constants"
import { formatBRL, formatDateTime, formatTime } from "@/lib/format"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { StarRatingDisplay } from "@/components/modals/star-rating"
import { PreferenceToggles } from "@/components/shared/preference-toggles"
import {
  StatCard,
} from "@/components/shared/dashboard-shell"

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
  scheduledAt: string
  status: BookingStatus
  amount: number
  address: string
  service: { id: string; title: string }
  client: {
    id: string
    name: string
    avatarUrl?: string | null
  }
}

type QuoteRequest = {
  id: string
  createdAt: string
  status: string
  items: Array<{ id: string; status: string }>
  client: { id: string; name: string; avatarUrl?: string | null }
}

type Review = {
  id: string
  rating: number
  comment?: string | null
  createdAt: string
  client: { id: string; name: string; avatarUrl?: string | null }
  service?: { id: string; title: string } | null
  booking?: { id: string; serviceId: string } | null
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

const BADGE_STYLES: Record<BookingStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  CONFIRMED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  IN_PROGRESS: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  CANCELLED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
}

function StatusBadge({ status }: { status: BookingStatus }) {
  const Icon =
    status === "CONFIRMED" || status === "COMPLETED"
      ? CheckCircle2
      : status === "PENDING"
        ? Clock
        : status === "IN_PROGRESS"
          ? Loader2
          : XCircle
  return (
    <Badge
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_STYLES[status]}`}
    >
      <Icon className="size-3" />
      {BOOKING_STATUS_LABELS[status]}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ProviderDashboard() {
  const user = useAuthStore((s) => s.user)
  const navigate = useViewStore((s) => s.navigate)

  const bookingsQuery = useQuery<{ items: Booking[]; total: number }>({
    queryKey: ["provider", "dashboard", "bookings", user?.id],
    queryFn: async () =>
      apiGet("/api/bookings", { role: "PROVIDER", page: 1, limit: 200 }),
  })

  const quotesQuery = useQuery<{ items: QuoteRequest[]; total: number }>({
    queryKey: ["provider", "dashboard", "quotes", user?.id],
    queryFn: async () =>
      apiGet("/api/quotes", { role: "PROVIDER", page: 1, limit: 200 }),
  })

  const reviewsQuery = useQuery<{ items: Review[]; total: number }>({
    queryKey: ["provider", "dashboard", "reviews", user?.id],
    queryFn: async () => {
      if (!user) return { items: [], total: 0 }
      return apiGet("/api/reviews", { providerId: user.id })
    },
    enabled: !!user,
  })

  // Wallet balance (simulated)
  type WalletData = {
    balance: number
    pendingBalance: number
    totalReceived: number
    totalBookings: number
    avgTicket: number
  }

  const walletQuery = useQuery<WalletData>({
    queryKey: ["provider", "wallet", user?.id],
    queryFn: () => apiGet("/api/provider/wallet"),
    enabled: !!user,
    refetchInterval: 30_000,
  })

  const bookings = bookingsQuery.data?.items ?? []
  const quotes = quotesQuery.data?.items ?? []
  const reviews = reviewsQuery.data?.items ?? []

  // KPIs
  const today = new Date()
  const weekStart = startOfWeek(today, { weekStartsOn: 0 })
  const weekEnd = endOfWeek(today, { weekStartsOn: 0 })

  const bookingsToday = bookings.filter((b) =>
    isSameDay(new Date(b.scheduledAt), today),
  )
  const bookingsThisWeek = bookings.filter((b) => {
    const d = new Date(b.scheduledAt)
    return d >= weekStart && d <= weekEnd
  })

  // Pending quote items (PENDING status, awaiting provider response)
  const pendingQuoteItems = quotes.reduce(
    (acc, q) =>
      acc + q.items.filter((i) => i.status === "PENDING").length,
    0,
  )

  // Reviews aggregation
  const avgRating =
    reviews.length > 0
      ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length
      : 0

  // Revenue: sum of bookings with paymentStatus PAID (confirmed/completed)
  const revenuePaid = bookings
    .filter(
      (b) =>
        b.status === "CONFIRMED" ||
        b.status === "IN_PROGRESS" ||
        b.status === "COMPLETED",
    )
    .reduce((acc, b) => acc + b.amount, 0)

  // Chart: bookings per day (last 7 days)
  const last7Days = eachDayOfInterval({
    start: subDays(today, 6),
    end: today,
  })
  const bookingsPerDay = last7Days.map((d) => {
    const count = bookings.filter((b) =>
      isSameDay(new Date(b.scheduledAt), d),
    ).length
    return {
      day: format(d, "EEE", { locale: ptBR }),
      agendamentos: count,
    }
  })

  // Chart: revenue per month (this year)
  const yearStart = startOfYear(today)
  const yearMonths = eachMonthOfInterval({
    start: yearStart,
    end: endOfMonth(today),
  })
  const revenuePerMonth = yearMonths.map((m) => {
    const total = bookings
      .filter((b) => {
        const d = new Date(b.scheduledAt)
        return (
          d.getMonth() === m.getMonth() &&
          d.getFullYear() === m.getFullYear() &&
          (b.status === "CONFIRMED" ||
            b.status === "IN_PROGRESS" ||
            b.status === "COMPLETED")
        )
      })
      .reduce((acc, b) => acc + b.amount, 0)
    return {
      month: format(m, "MMM", { locale: ptBR }),
      receita: total,
    }
  })

  // Today's agenda: bookings for today (any non-cancelled status).
  // Falls back to next upcoming bookings when there are none today.
  const todays = bookings
    .filter(
      (b) =>
        isSameDay(new Date(b.scheduledAt), today) &&
        b.status !== "CANCELLED",
    )
    .sort(
      (a, b) =>
        new Date(a.scheduledAt).getTime() -
        new Date(b.scheduledAt).getTime(),
    )
  const upcoming = bookings
    .filter(
      (b) =>
        new Date(b.scheduledAt) >= new Date() &&
        b.status !== "CANCELLED" &&
        b.status !== "COMPLETED" &&
        !isSameDay(new Date(b.scheduledAt), today),
    )
    .sort(
      (a, b) =>
        new Date(a.scheduledAt).getTime() -
        new Date(b.scheduledAt).getTime(),
    )
    .slice(0, 5)
  const agendaBookings = todays.length > 0 ? todays : upcoming

  // Pending quotes (top 5)
  const pendingQuotes = quotes
    .filter((q) => q.items.some((i) => i.status === "PENDING"))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 5)

  // Latest reviews (top 3)
  const latestReviews = reviews.slice(0, 3)

  const loading =
    bookingsQuery.isLoading || quotesQuery.isLoading || reviewsQuery.isLoading

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Olá, {user?.name?.split(" ")[0] ?? "Prestador"}{" "}
            <span className="ml-0.5">👋</span>
          </h2>
          <p className="text-sm capitalize text-muted-foreground">
            {format(today, "EEEE, dd 'de' MMMM", { locale: ptBR })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("provider.quotes")}
            className="h-9 gap-1.5"
          >
            <Send className="size-3.5" /> Responder orçamentos
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("provider.agenda")}
            className="h-9 gap-1.5"
          >
            <CalendarDays className="size-3.5" /> Ver agenda
          </Button>
          <Button
            size="sm"
            onClick={() => navigate("provider.services")}
            className="h-9 gap-1.5"
          >
            <Plus className="size-3.5" /> Novo serviço
          </Button>
        </div>
      </div>

      {/* Wallet balance card */}
      <div className="rounded-xl border bg-gradient-to-br from-emerald-50 to-emerald-100/60 p-5 dark:from-emerald-950/40 dark:to-emerald-900/20">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/25">
              <Banknote className="size-7" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                Saldo da Carteira
              </p>
              <p className="text-3xl font-bold tabular-nums tracking-tight text-emerald-900 dark:text-emerald-100">
                {walletQuery.isLoading ? (
                  <span className="inline-block h-9 w-36 animate-pulse rounded bg-emerald-200 dark:bg-emerald-800" />
                ) : (
                  formatBRL(walletQuery.data?.balance ?? 0)
                )}
              </p>
              <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                {walletQuery.data?.totalBookings ?? 0} serviço
                {(walletQuery.data?.totalBookings ?? 0) === 1 ? "" : "s"} realizado
                {(walletQuery.data?.totalBookings ?? 0) === 1 ? "" : "s"}
                {walletQuery.data && walletQuery.data.totalBookings > 0 && (
                  <>
                    {" "}&middot; Ticket médio {formatBRL(walletQuery.data.avgTicket)}
                  </>
                )}
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-9 gap-1.5 bg-white/80 shadow-sm hover:bg-white dark:bg-emerald-900/40 dark:hover:bg-emerald-900/60"
            onClick={() => navigate("provider.finance")}
          >
            <Wallet className="size-3.5" /> Ver financeiro
          </Button>
        </div>
      </div>

      {/* Sound & vibration preferences */}
      <PreferenceToggles
        soundEnabled={user?.soundEnabled ?? true}
        vibrateEnabled={user?.vibrateEnabled ?? true}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          index={0}
          label="Agendamentos hoje"
          value={bookingsToday.length}
          hint={`${bookingsThisWeek.length} na semana`}
          icon={CalendarCheck}
          tone="primary"
        />
        <StatCard
          index={1}
          label="Orçamentos pendentes"
          value={pendingQuoteItems}
          icon={FileText}
          tone="amber"
        />
        <StatCard
          index={2}
          label="Avaliação média"
          value={avgRating.toFixed(1)}
          hint={`${reviews.length} avaliaç${reviews.length === 1 ? "ão" : "ões"}`}
          icon={Star}
          tone="primary"
        />
        <StatCard
          index={3}
          label="Receita recebida"
          value={formatBRL(revenuePaid)}
          icon={Wallet}
          tone="primary"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" /> Carregando…
        </div>
      ) : (
        <>
          {/* Charts */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-xl shadow-sm">
              <CardContent className="p-5">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <CalendarCheck className="size-4" />
                    </span>
                    <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Agendamentos (últimos 7 dias)
                    </p>
                  </div>
                </div>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={bookingsPerDay}
                      margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                    >
                      <CartesianGrid
                        stroke="var(--border)"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                        axisLine={false}
                        tickLine={false}
                        width={28}
                      />
                      <RTooltip
                        cursor={{ fill: "var(--accent)", opacity: 0.5 }}
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(v: number) => [v, "Agendamentos"]}
                      />
                      <Bar
                        dataKey="agendamentos"
                        fill="var(--primary)"
                        radius={[4, 4, 0, 0]}
                        barSize={28}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-xl shadow-sm">
              <CardContent className="p-5">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Wallet className="size-4" />
                    </span>
                    <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Receita por mês
                    </p>
                  </div>
                </div>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={revenuePerMonth}
                      margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="grad-revenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="var(--border)"
                        strokeDasharray="3 3"
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
                        tickFormatter={(v) =>
                          v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                        }
                      />
                      <RTooltip
                        cursor={{ stroke: "var(--primary)", strokeWidth: 1, strokeDasharray: "3 3" }}
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(v: number) => [formatBRL(v), "Receita"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="receita"
                        stroke="var(--primary)"
                        strokeWidth={2}
                        fill="url(#grad-revenue)"
                        activeDot={{ r: 4, fill: "var(--primary)" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent lists */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Today's agenda / Upcoming */}
            <Card className="rounded-xl shadow-sm">
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      {todays.length > 0
                        ? "Agenda de hoje"
                        : "Próximos agendamentos"}
                    </p>
                    {todays.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {todays.length} agendamento
                        {todays.length === 1 ? "" : "s"} para hoje
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 gap-1 px-2 text-xs text-primary hover:text-primary"
                    onClick={() => navigate("provider.agenda")}
                  >
                    Ver agenda <ArrowRight className="size-3" />
                  </Button>
                </div>
                {agendaBookings.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <CalendarDays className="size-5" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Sem agendamentos para hoje.
                    </p>
                  </div>
                ) : (
                  <ul className="grid gap-2">
                    {agendaBookings.map((b) => (
                      <li
                        key={b.id}
                        className="flex items-center gap-3 rounded-lg border bg-card p-2.5 transition-colors hover:bg-accent/40"
                      >
                        <div className="flex w-12 shrink-0 flex-col items-center justify-center rounded-md bg-primary/10 py-1 text-primary">
                          <span className="text-sm font-bold tabular-nums leading-none">
                            {formatTime(b.scheduledAt).slice(0, 2)}h
                          </span>
                          <span className="text-[10px] tabular-nums leading-none opacity-80">
                            {formatTime(b.scheduledAt).slice(3, 5)}
                          </span>
                        </div>
                        <Avatar className="size-9 shrink-0 border">
                          {b.client.avatarUrl ? (
                            <AvatarImage
                              src={b.client.avatarUrl}
                              alt={b.client.name}
                            />
                          ) : null}
                          <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
                            {initials(b.client.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {b.client.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {b.service.title}
                          </p>
                          {b.address && (
                            <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                              <MapPin className="size-2.5 shrink-0" />
                              <span className="truncate">{b.address}</span>
                            </p>
                          )}
                        </div>
                        <StatusBadge status={b.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Pending quotes */}
            <Card className="rounded-xl shadow-sm">
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Orçamentos pendentes
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 gap-1 px-2 text-xs text-primary hover:text-primary"
                    onClick={() => navigate("provider.quotes")}
                  >
                    Ver todos <ArrowRight className="size-3" />
                  </Button>
                </div>
                {pendingQuotes.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      <CheckCircle2 className="size-5" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Tudo em dia — sem orçamentos pendentes.
                    </p>
                  </div>
                ) : (
                  <ul className="grid gap-2">
                    {pendingQuotes.map((q) => {
                      const pending = q.items.filter(
                        (i) => i.status === "PENDING",
                      ).length
                      return (
                        <li
                          key={q.id}
                          className="flex items-center gap-3 rounded-lg border bg-card p-2.5 transition-colors hover:bg-accent/40"
                        >
                          <Avatar className="size-9 shrink-0 border">
                            {q.client.avatarUrl ? (
                              <AvatarImage
                                src={q.client.avatarUrl}
                                alt={q.client.name}
                              />
                            ) : null}
                            <AvatarFallback className="bg-amber-500 text-[10px] font-semibold text-white">
                              {initials(q.client.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {q.client.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {formatDateTime(q.createdAt)}
                            </p>
                          </div>
                          <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                            {pending} pendente{pending === 1 ? "" : "s"}
                          </Badge>
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 shrink-0 gap-1 px-2 text-xs"
                            onClick={() => navigate("provider.quotes")}
                          >
                            <Send className="size-3" /> Responder
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Latest reviews */}
            <Card className="rounded-xl shadow-sm">
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Últimas avaliações
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 gap-1 px-2 text-xs text-primary hover:text-primary"
                    onClick={() => navigate("provider.reviews")}
                  >
                    Ver todas <ArrowRight className="size-3" />
                  </Button>
                </div>
                {latestReviews.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      <Star className="size-5" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Sem avaliações ainda.
                    </p>
                  </div>
                ) : (
                  <ul className="grid gap-2">
                    {latestReviews.map((r) => (
                      <li
                        key={r.id}
                        className="rounded-lg border bg-card p-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <Avatar className="size-7 shrink-0 border">
                            {r.client.avatarUrl ? (
                              <AvatarImage
                                src={r.client.avatarUrl}
                                alt={r.client.name}
                              />
                            ) : null}
                            <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
                              {initials(r.client.name)}
                            </AvatarFallback>
                          </Avatar>
                          <p className="min-w-0 flex-1 truncate text-sm font-medium">
                            {r.client.name}
                          </p>
                          <StarRatingDisplay
                            value={r.rating}
                            size={12}
                            showCount={false}
                          />
                        </div>
                        {r.comment && (
                          <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                            “{r.comment}”
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

export default ProviderDashboard
