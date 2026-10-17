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
  Compass,
  FileText,
  Loader2,
  MapPin,
  Plus,
  Radio,
  Send,
  Star,
  Wallet,
} from "lucide-react"
import {
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  startOfWeek,
  startOfYear,
  subDays,
} from "date-fns"
import { ptBR } from "date-fns/locale"

import { apiGet } from "@/lib/api"
import { type BookingStatus } from "@/lib/constants"
import { formatBRL, formatDateTime, formatTime } from "@/lib/format"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { StarRatingDisplay } from "@/components/modals/star-rating"
import { PreferenceToggles } from "@/components/shared/preference-toggles"
import { StatCard } from "@/components/shared/dashboard-shell"
import ProviderGeoAwarenessBadge from "@/components/provider/provider-geo-awareness-badge"
import { BookingStatusBadge } from "@/components/admin/admin-shared"
import { ProviderAnalyticsPanel } from "@/components/provider/provider-analytics-panel"

const CHART_TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 6px 20px -4px rgb(0 0 0 / 0.12)",
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

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ProviderDashboard() {
  const user = useAuthStore((s) => s.user)
  const navigate = useViewStore((s) => s.navigate)

  const bookingsQuery = useQuery<{ items: Booking[]; total: number }>({
    queryKey: ["provider", "dashboard", "bookings", user?.id],
    queryFn: async () => apiGet("/api/bookings", { role: "PROVIDER", page: 1, limit: 200 }),
  })

  const quotesQuery = useQuery<{ items: QuoteRequest[]; total: number }>({
    queryKey: ["provider", "dashboard", "quotes", user?.id],
    queryFn: async () => apiGet("/api/quotes", { role: "PROVIDER", page: 1, limit: 200 }),
  })

  const reviewsQuery = useQuery<{ items: Review[]; total: number }>({
    queryKey: ["provider", "dashboard", "reviews", user?.id],
    queryFn: async () => {
      if (!user) return { items: [], total: 0 }
      return apiGet("/api/reviews", { providerId: user.id })
    },
    enabled: !!user,
  })

  // Wallet balance
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

  const bookings = React.useMemo(() => bookingsQuery.data?.items ?? [], [bookingsQuery.data?.items])
  const quotes = React.useMemo(() => quotesQuery.data?.items ?? [], [quotesQuery.data?.items])
  const reviews = React.useMemo(() => reviewsQuery.data?.items ?? [], [reviewsQuery.data?.items])

  // KPIs
  const today = React.useMemo(() => new Date(), [])
  const bookingsToday = React.useMemo(() => {
    return bookings.filter(
      (b) => isSameDay(new Date(b.scheduledAt), today) && b.status !== "CANCELLED",
    )
  }, [bookings, today])

  const bookingsThisWeek = React.useMemo(() => {
    const start = startOfWeek(today, { weekStartsOn: 0 })
    const end = endOfWeek(today, { weekStartsOn: 0 })
    return bookings.filter((b) => {
      const d = new Date(b.scheduledAt)
      return d >= start && d <= end && b.status !== "CANCELLED"
    })
  }, [bookings, today])

  const pendingQuoteItems = React.useMemo(() => {
    return quotes.reduce((acc, q) => {
      return acc + q.items.filter((i) => i.status === "PENDING").length
    }, 0)
  }, [quotes])

  const avgRating = React.useMemo(() => {
    if (reviews.length === 0) return 0
    return reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length
  }, [reviews])

  const revenuePaid = React.useMemo(() => {
    return bookings
      .filter((b) => b.status === "CONFIRMED" || b.status === "COMPLETED")
      .reduce((acc, b) => acc + b.amount, 0)
  }, [bookings])

  // Chart: bookings per day (last 7 days)
  const last7Days = React.useMemo(() => {
    return eachDayOfInterval({
      start: subDays(today, 6),
      end: today,
    })
  }, [today])

  const bookingsPerDay = last7Days.map((d) => {
    const count = bookings.filter((b) => isSameDay(new Date(b.scheduledAt), d)).length
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
          (b.status === "CONFIRMED" || b.status === "IN_PROGRESS" || b.status === "COMPLETED")
        )
      })
      .reduce((acc, b) => acc + b.amount, 0)
    return {
      month: format(m, "MMM", { locale: ptBR }),
      receita: total,
    }
  })

  // Today's agenda
  const todays = bookings
    .filter((b) => isSameDay(new Date(b.scheduledAt), today) && b.status !== "CANCELLED")
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
  const upcoming = bookings
    .filter(
      (b) =>
        new Date(b.scheduledAt) >= new Date() &&
        b.status !== "CANCELLED" &&
        b.status !== "COMPLETED" &&
        !isSameDay(new Date(b.scheduledAt), today),
    )
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .slice(0, 5)
  const agendaBookings = todays.length > 0 ? todays : upcoming

  // Pending quotes
  const pendingQuotes = quotes
    .filter((q) => q.items.some((i) => i.status === "PENDING"))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)

  // Latest reviews
  const latestReviews = reviews.slice(0, 3)

  const loading = bookingsQuery.isLoading || quotesQuery.isLoading || reviewsQuery.isLoading

  return (
    <div className="space-y-6">
      {/* Greeting & Header HUD (Nielsen #1: Visibilidade do estado do sistema) */}
      <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h2 className="text-foreground text-2xl font-bold tracking-tight">
              Olá, {user?.name?.split(" ")[0] ?? "Prestador"} <span className="ml-0.5">👋</span>
            </h2>
            <Badge
              variant="outline"
              className="inline-flex items-center gap-1.5 rounded-full border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400"
            >
              <Radio className="size-3 animate-pulse text-emerald-500" />
              <span>Disponível em GV</span>
            </Badge>
          </div>
          <p className="text-muted-foreground text-xs capitalize">
            {format(today, "EEEE, dd 'de' MMMM", { locale: ptBR })} &middot; Governador Valadares,
            MG
          </p>
        </div>

        {/* Quick Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("provider.quotes")}
            className="h-8 gap-1.5 rounded-xl text-xs font-medium"
          >
            <Send className="size-3.5 text-blue-500" /> Responder orçamentos
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("provider.agenda")}
            className="h-8 gap-1.5 rounded-xl text-xs font-medium"
          >
            <CalendarDays className="text-primary size-3.5" /> Ver agenda
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("provider.routes")}
            className="h-8 gap-1.5 rounded-xl text-xs font-medium"
          >
            <Compass className="size-3.5 text-sky-500" /> Rotas do dia
          </Button>
          <Button
            size="sm"
            onClick={() => navigate("provider.services")}
            className="h-8 gap-1.5 rounded-xl text-xs font-semibold shadow-xs"
          >
            <Plus className="size-3.5" /> Novo serviço
          </Button>
        </div>
      </div>

      {/* Bento Grid: Saldo da Carteira + 4 KPIs */}
      <div className="grid gap-4 md:grid-cols-12">
        {/* Wallet Balance Card */}
        <div className="flex flex-col justify-between gap-4 rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 via-emerald-100/30 to-white p-5 shadow-xs md:col-span-5 lg:col-span-4 dark:border-emerald-800/50 dark:from-emerald-950/40 dark:via-emerald-900/20 dark:to-slate-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wider text-emerald-800 uppercase dark:text-emerald-300">
                Saldo da Carteira
              </p>
              <p className="mt-1 text-3xl font-bold tracking-tight text-emerald-950 tabular-nums dark:text-emerald-100">
                {walletQuery.isLoading ? (
                  <span className="inline-block h-9 w-36 animate-pulse rounded bg-emerald-200 dark:bg-emerald-800" />
                ) : (
                  formatBRL(walletQuery.data?.balance ?? 0)
                )}
              </p>
              <p className="mt-1 text-xs text-emerald-700/90 dark:text-emerald-400">
                {walletQuery.data?.totalBookings ?? 0} serviço
                {(walletQuery.data?.totalBookings ?? 0) === 1 ? "" : "s"} realizado
                {(walletQuery.data?.totalBookings ?? 0) === 1 ? "" : "s"}
                {walletQuery.data && walletQuery.data.totalBookings > 0 && (
                  <> &middot; Ticket médio {formatBRL(walletQuery.data.avgTicket)}</>
                )}
              </p>
            </div>
            <div className="flex size-11 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20">
              <Banknote className="size-5.5" />
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5 rounded-xl border-emerald-300/80 bg-white/90 text-xs font-semibold text-emerald-800 shadow-xs hover:bg-emerald-50 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-200 dark:hover:bg-emerald-950/60"
            onClick={() => navigate("provider.finance")}
          >
            <Wallet className="size-3.5" /> Ver financeiro
          </Button>
        </div>

        {/* 4 KPIs Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:col-span-7 lg:col-span-8">
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
            value={avgRating > 0 ? avgRating.toFixed(1) : "—"}
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
      </div>

      {/* Demanda Regional / Geo Awareness */}
      <ProviderGeoAwarenessBadge />

      {loading ? (
        <div className="text-muted-foreground flex items-center justify-center py-12 text-sm">
          <Loader2 className="mr-2 size-5 animate-spin" /> Carregando painel…
        </div>
      ) : (
        <>
          {/* Gráficos com Curva de Gradiente Suave */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="bg-card rounded-2xl border shadow-xs">
              <CardContent className="p-5">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-lg">
                      <CalendarCheck className="size-4" />
                    </span>
                    <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
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
                        radius={[6, 6, 0, 0]}
                        barSize={26}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card rounded-2xl border shadow-xs">
              <CardContent className="p-5">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                      <Wallet className="size-4" />
                    </span>
                    <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
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
                          <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.0} />
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
                        tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
                      />
                      <RTooltip
                        cursor={{
                          stroke: "var(--primary)",
                          strokeWidth: 1,
                          strokeDasharray: "3 3",
                        }}
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(v: number) => [formatBRL(v), "Receita"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="receita"
                        stroke="var(--primary)"
                        strokeWidth={2.5}
                        fill="url(#grad-revenue)"
                        activeDot={{ r: 5, fill: "var(--primary)" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Painel Analytics de Conversão e Escrow */}
          <div className="pt-1">
            <ProviderAnalyticsPanel />
          </div>

          {/* 3 Colunas Recentes: Agenda de Hoje / Orçamentos / Avaliações */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Agenda do Dia */}
            <Card className="bg-card rounded-2xl border shadow-xs">
              <CardContent className="p-5">
                <div className="mb-3.5 flex items-center justify-between gap-2 border-b pb-3">
                  <div className="min-w-0">
                    <p className="text-foreground text-xs font-semibold tracking-wide uppercase">
                      {todays.length > 0 ? "Agenda de hoje" : "Próximos agendamentos"}
                    </p>
                    {todays.length > 0 && (
                      <p className="text-muted-foreground text-[11px]">
                        {todays.length} agendamento
                        {todays.length === 1 ? "" : "s"} para hoje
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-primary hover:text-primary h-7 shrink-0 gap-1 px-2 text-xs font-semibold"
                    onClick={() => navigate("provider.agenda")}
                  >
                    Ver agenda <ArrowRight className="size-3" />
                  </Button>
                </div>
                {agendaBookings.length === 0 ? (
                  <div className="bg-muted/10 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-8 text-center">
                    <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-xl">
                      <CalendarDays className="size-5 opacity-70" />
                    </div>
                    <p className="text-muted-foreground text-xs font-medium">
                      Sem agendamentos para hoje.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {agendaBookings.map((b) => (
                      <li
                        key={b.id}
                        className="bg-card hover:bg-muted/30 flex items-center gap-3 rounded-xl border p-2.5 shadow-2xs transition-colors"
                      >
                        <div className="bg-primary/10 text-primary border-primary/15 flex w-12 shrink-0 flex-col items-center justify-center rounded-lg border py-1">
                          <span className="text-xs leading-none font-bold tabular-nums">
                            {formatTime(b.scheduledAt).slice(0, 2)}h
                          </span>
                          <span className="text-[10px] leading-none tabular-nums opacity-75">
                            {formatTime(b.scheduledAt).slice(3, 5)}
                          </span>
                        </div>
                        <Avatar className="size-9 shrink-0 border shadow-2xs">
                          {b.client.avatarUrl ? (
                            <AvatarImage src={b.client.avatarUrl} alt={b.client.name} />
                          ) : null}
                          <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                            {initials(b.client.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-foreground truncate text-xs font-semibold">
                            {b.client.name}
                          </p>
                          <p className="text-muted-foreground truncate text-[11px]">
                            {b.service.title}
                          </p>
                          {b.address && (
                            <p className="text-muted-foreground mt-0.5 flex items-center gap-1 truncate text-[10px]">
                              <MapPin className="size-2.5 shrink-0" />
                              <span className="truncate">{b.address}</span>
                            </p>
                          )}
                        </div>
                        <BookingStatusBadge status={b.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Orçamentos Pendentes */}
            <Card className="bg-card rounded-2xl border shadow-xs">
              <CardContent className="p-5">
                <div className="mb-3.5 flex items-center justify-between gap-2 border-b pb-3">
                  <p className="text-foreground text-xs font-semibold tracking-wide uppercase">
                    Orçamentos pendentes
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-primary hover:text-primary h-7 shrink-0 gap-1 px-2 text-xs font-semibold"
                    onClick={() => navigate("provider.quotes")}
                  >
                    Ver todos <ArrowRight className="size-3" />
                  </Button>
                </div>
                {pendingQuotes.length === 0 ? (
                  <div className="bg-muted/10 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-8 text-center">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      <CheckCircle2 className="size-5" />
                    </div>
                    <p className="text-muted-foreground text-xs font-medium">
                      Tudo em dia — sem orçamentos pendentes.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {pendingQuotes.map((q) => {
                      const pending = q.items.filter((i) => i.status === "PENDING").length
                      return (
                        <li
                          key={q.id}
                          className="bg-card hover:bg-muted/30 flex items-center gap-3 rounded-xl border p-2.5 shadow-2xs transition-colors"
                        >
                          <Avatar className="size-9 shrink-0 border shadow-2xs">
                            {q.client.avatarUrl ? (
                              <AvatarImage src={q.client.avatarUrl} alt={q.client.name} />
                            ) : null}
                            <AvatarFallback className="bg-amber-500/10 text-[10px] font-semibold text-amber-600">
                              {initials(q.client.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="text-foreground truncate text-xs font-semibold">
                              {q.client.name}
                            </p>
                            <p className="text-muted-foreground text-[10px] tabular-nums">
                              {formatDateTime(q.createdAt)}
                            </p>
                          </div>
                          <Badge className="bg-amber-100 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                            {pending} pendente{pending === 1 ? "" : "s"}
                          </Badge>
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 shrink-0 gap-1 rounded-lg px-2 text-xs font-semibold"
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

            {/* Últimas Avaliações */}
            <Card className="bg-card rounded-2xl border shadow-xs">
              <CardContent className="p-5">
                <div className="mb-3.5 flex items-center justify-between gap-2 border-b pb-3">
                  <p className="text-foreground text-xs font-semibold tracking-wide uppercase">
                    Últimas avaliações
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-primary hover:text-primary h-7 shrink-0 gap-1 px-2 text-xs font-semibold"
                    onClick={() => navigate("provider.reviews")}
                  >
                    Ver todas <ArrowRight className="size-3" />
                  </Button>
                </div>
                {latestReviews.length === 0 ? (
                  <div className="bg-muted/10 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-8 text-center">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      <Star className="size-5" />
                    </div>
                    <p className="text-muted-foreground text-xs font-medium">
                      Sem avaliações ainda.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {latestReviews.map((r) => (
                      <li
                        key={r.id}
                        className="bg-card space-y-1.5 rounded-xl border p-2.5 shadow-2xs"
                      >
                        <div className="flex items-center gap-2">
                          <Avatar className="size-7 shrink-0 border shadow-2xs">
                            {r.client.avatarUrl ? (
                              <AvatarImage src={r.client.avatarUrl} alt={r.client.name} />
                            ) : null}
                            <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                              {initials(r.client.name)}
                            </AvatarFallback>
                          </Avatar>
                          <p className="text-foreground min-w-0 flex-1 truncate text-xs font-semibold">
                            {r.client.name}
                          </p>
                          <StarRatingDisplay value={r.rating} size={12} showCount={false} />
                        </div>
                        {r.comment && (
                          <p className="text-muted-foreground line-clamp-2 text-[11px] leading-snug italic">
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

          {/* Preferências do dispositivo */}
          <div className="space-y-2 border-t pt-2">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Preferências de notificações & dispositivo
            </h3>
            <PreferenceToggles
              soundEnabled={user?.soundEnabled ?? true}
              vibrateEnabled={user?.vibrateEnabled ?? true}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default ProviderDashboard
