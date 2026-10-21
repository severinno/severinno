"use client"

/**
 * ClientDashboard — overview dashboard for the logged-in client.
 *
 * Sections:
 *  - Header with warm greeting + quick actions ("Buscar prestadores" / "Pedir orçamento")
 *  - Discovery & Search Dock: quick search input, popular category pills, and location radar
 *  - High-trust Hero: In-progress service alert (if active) OR Escrow & 90-Day Protection Banner
 *  - 4 Interactive Command KPI cards: Próximos agendamentos, Orçamentos ativos,
 *    Serviços concluídos, Total investido (all clickable with haptics & status tags)
 *  - Two-column operational center: Próximos agendamentos + Orçamentos ativos
 *  - Recent activity timeline (latest bookings & quotes with status badges)
 *  - Analytics: Monthly bookings (AreaChart) + Spending per category (PieChart donut)
 *  - Preferences utility: Sound and vibration toggles
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
  Hammer,
  KeyRound,
  Loader2,
  MapPin,
  Paintbrush,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
  Wind,
  Wrench,
  Zap,
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
import { EmptyState, SectionTitle } from "@/components/shared/dashboard-shell"
import { OnboardingChecklist } from "@/components/client/onboarding-checklist"
import GeoAwarenessBadge from "@/components/client/geo-awareness-badge"
import { PreferenceToggles } from "@/components/shared/preference-toggles"
import { ReferralCard } from "@/components/shared/referral-card"
import { ReferralLeaderboard } from "@/components/shared/referral-leaderboard"
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
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 8px 24px -4px rgb(0 0 0 / 0.12)",
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

const POPULAR_CATEGORIES = [
  { label: "Eletricista", q: "Eletricista", icon: Zap },
  { label: "Pintor", q: "Pintor", icon: Paintbrush },
  { label: "Ar-Condicionado", q: "Ar-Condicionado", icon: Wind },
  { label: "Encanador", q: "Encanador", icon: Wrench },
  { label: "Limpeza", q: "Limpeza", icon: Sparkles },
  { label: "Chaveiro", q: "Chaveiro", icon: KeyRound },
  { label: "Marcenaria", q: "Marcenaria", icon: Hammer },
] as const

// ---------------------------------------------------------------------------
// Interactive Command KPI Card Component
// ---------------------------------------------------------------------------

function InteractiveKpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  badgeText,
  onClick,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
  hint: string
  tone: "primary" | "amber" | "sky" | "emerald"
  badgeText?: string
  onClick: () => void
}) {
  const toneConfig = {
    primary: {
      halo: "bg-primary/10 text-primary border-primary/20",
      badge: "bg-primary/10 text-primary border-primary/20",
      hoverBorder: "hover:border-primary/50",
    },
    amber: {
      halo: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
      hoverBorder: "hover:border-amber-500/50",
    },
    sky: {
      halo: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
      badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",
      hoverBorder: "hover:border-sky-500/50",
    },
    emerald: {
      halo: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
      hoverBorder: "hover:border-emerald-500/50",
    },
  }[tone]

  return (
    <button
      type="button"
      title={hint}
      onClick={() => {
        triggerHaptic("selection")
        onClick()
      }}
      className={`group border-border/60 bg-card focus-visible:ring-primary relative flex cursor-pointer items-center justify-between overflow-hidden rounded-xl border p-3 text-left shadow-2xs transition-all duration-200 outline-none hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 ${toneConfig.hoverBorder}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg border transition-transform duration-200 group-hover:scale-105 ${toneConfig.halo}`}
        >
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-foreground text-lg font-bold tracking-tight tabular-nums">
              {value}
            </span>
            {badgeText && (
              <span
                className={`rounded-full border px-1.5 py-0.5 text-[9.5px] leading-none font-medium tracking-tight ${toneConfig.badge}`}
              >
                {badgeText}
              </span>
            )}
          </div>
          <p className="text-muted-foreground truncate text-xs font-medium">{label}</p>
        </div>
      </div>
      <ChevronRight className="text-muted-foreground/35 group-hover:text-foreground size-4 shrink-0 transition-all duration-200 group-hover:translate-x-0.5" />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main Dashboard Component
// ---------------------------------------------------------------------------

export function ClientDashboard() {
  const navigate = useViewStore((s) => s.navigate)
  const openQuote = useUIStore((s) => s.openQuote)
  const user = useAuthStore((s) => s.user)

  const [searchQuery, setSearchQuery] = React.useState("")
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
      amount: 0,
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

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    triggerHaptic("selection")
    if (searchQuery.trim()) {
      navigate("client.providers", { q: searchQuery.trim() })
    } else {
      navigate("client.providers")
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. Header with greeting and primary quick actions */}
      <PageHeader
        title={`Olá${firstName ? ", " : ""}${firstName} 👋`}
        subtitle="Acompanhe seus agendamentos, orçamentos e gastos em tempo real."
        action={
          <>
            <Button
              variant="outline"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.providers")
              }}
              className="border-border/60 hover:bg-muted/60 h-10 gap-2 rounded-xl text-xs font-semibold shadow-2xs"
            >
              <Search className="size-4" />
              Buscar prestadores
            </Button>
            <Button
              onClick={() => {
                triggerHaptic("selection")
                openQuote()
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-10 gap-2 rounded-xl text-xs font-bold shadow-2xs"
            >
              <Plus className="size-4" />
              Pedir orçamento
            </Button>
          </>
        }
      />

      {/* 2. Unified Discovery Dock — in-panel provider search */}
      <Card className="border-border/60 from-card via-card to-primary/5 relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4.5 shadow-2xs sm:p-5.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="bg-primary/10 text-primary border-primary/20 flex size-8 items-center justify-center rounded-xl border shadow-2xs">
                <Search className="size-4" />
              </span>
              <h2 className="text-foreground text-base font-bold tracking-tight sm:text-lg">
                Qual serviço você precisa hoje?
              </h2>
            </div>
            <p className="text-muted-foreground text-xs sm:text-sm">
              Profissionais avaliados com garantia de pagamento seguro e emissão de nota em
              Governador Valadares.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              triggerHaptic("selection")
              navigate("client.providers")
            }}
            className="border-border/70 hover:bg-muted/60 h-8.5 shrink-0 gap-1.5 self-start rounded-xl px-3.5 text-xs font-semibold shadow-2xs sm:self-auto"
          >
            Abrir busca completa
            <ChevronRight className="size-3.5" />
          </Button>
        </div>

        {/* Search input form */}
        <form onSubmit={handleSearchSubmit} className="mt-3.5 flex gap-2">
          <div className="relative flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="O que você precisa? Ex: eletricista, encanador, pintura residencial, ar-condicionado..."
              className="border-border/70 bg-background text-foreground placeholder:text-muted-foreground/70 focus:ring-primary h-10 w-full rounded-xl border pr-3 pl-9 text-xs shadow-2xs focus:ring-1 focus:outline-none"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-10 rounded-xl px-5 text-xs font-bold shadow-2xs"
          >
            Buscar
          </Button>
        </form>

        {/* Popular category shortcut pills */}
        <div className="border-border/40 mt-3.5 flex flex-wrap items-center gap-1.5 border-t pt-2.5">
          <span className="text-muted-foreground mr-1 text-[11px] font-semibold">Populares:</span>
          {POPULAR_CATEGORIES.map((cat) => {
            const Icon = cat.icon
            return (
              <button
                key={cat.label}
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  navigate("client.providers", { q: cat.q })
                }}
                className="border-border/50 bg-background/80 hover:bg-primary/10 hover:border-primary/30 text-muted-foreground hover:text-primary flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-semibold shadow-2xs transition-all"
              >
                <Icon className="text-primary/80 size-3" />
                {cat.label}
              </button>
            )
          })}
        </div>

        {/* Embedded Geo-awareness badge — localized coverage radar */}
        <div className="border-border/40 mt-3.5 border-t pt-3">
          <GeoAwarenessBadge />
        </div>
      </Card>

      {/* 3. In-progress active service alert if any */}
      {inProgressBooking && (
        <div className="border-primary/30 from-primary/10 via-primary/5 to-card relative overflow-hidden rounded-2xl border bg-gradient-to-r p-4.5 shadow-2xs sm:p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3.5 sm:items-center">
              <span className="relative mt-1 flex size-3.5 shrink-0 sm:mt-0">
                <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                <span className="bg-primary relative inline-flex size-3.5 rounded-full" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-primary text-[11px] font-bold tracking-wider uppercase">
                    Serviço em Andamento Agora
                  </span>
                  <span className="text-muted-foreground text-[10px]">·</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatDateTime(inProgressBooking.scheduledAt)}
                  </span>
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                    {formatBRL(inProgressBooking.amount)} em Custódia
                  </span>
                </div>
                <p className="text-foreground mt-0.5 truncate text-sm font-bold sm:text-base">
                  {inProgressBooking.service.title} com {inProgressBooking.provider.name}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  O valor de {formatBRL(inProgressBooking.amount)} está protegido pelo Escrow e só é
                  liberado após a sua aprovação final.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.bookings")
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 shrink-0 gap-1 self-start rounded-xl px-4 text-xs font-semibold shadow-2xs sm:self-auto"
            >
              Acompanhar
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* 4. Escrow & Protection Banner — High-trust Institutional Reassurance */}
      <div className="via-card dark:via-card relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-50/70 to-emerald-500/5 p-4.5 shadow-2xs sm:p-5 dark:border-emerald-800/30 dark:from-emerald-950/20 dark:to-emerald-950/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 shadow-2xs ring-1 ring-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400">
              <ShieldCheck className="size-6" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-foreground text-sm font-bold tracking-tight sm:text-base">
                  Garantia Severinno Escrow & Proteção 90 Dias
                </p>
                <span className="rounded-full border border-emerald-500/25 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  Custódia Ativa
                </span>
              </div>
              <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed sm:text-sm">
                Seu pagamento fica seguro na custódia e só é liberado ao profissional após a sua
                aprovação final do serviço. Sem risco de perda financeira ou serviços mal
                executados.
              </p>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  Custódia 100% via PIX
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  Garantia de 90 dias
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  Mediação e suporte ao cliente
                </span>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              navigate("client.bookings")
            }}
            className="bg-background/80 h-9 shrink-0 gap-1.5 self-start rounded-xl border-emerald-600/30 px-4 text-xs font-semibold text-emerald-700 shadow-2xs hover:bg-emerald-500/10 lg:self-center dark:text-emerald-300"
          >
            <span>Gerenciar liberação</span>
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* 5. Onboarding checklist — only shows if profile is incomplete */}
      <OnboardingChecklist />

      {/* 6. 4 Interactive Command KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InteractiveKpiCard
          icon={CalendarDays}
          label="Próximos agendamentos"
          value={upcomingCount}
          tone="primary"
          badgeText={
            upcomingCount > 0
              ? `${upcomingCount} ativo${upcomingCount > 1 ? "s" : ""}`
              : "0 pendentes"
          }
          hint="Pendentes, confirmados e em andamento"
          onClick={() => navigate("client.bookings")}
        />
        <InteractiveKpiCard
          icon={FileText}
          label="Orçamentos ativos"
          value={activeQuotesCount}
          tone="amber"
          badgeText={activeQuotesCount > 0 ? `${activeQuotesCount} em aberto` : "0 pendentes"}
          hint="Aguardando resposta ou ação"
          onClick={() => navigate("client.quotes")}
        />
        <InteractiveKpiCard
          icon={CheckCircle2}
          label="Serviços concluídos"
          value={completedCount}
          tone="sky"
          badgeText={completedCount > 0 ? `${completedCount} realizados` : "0 concluídos"}
          hint="Histórico com garantia 90 dias"
          onClick={() => navigate("client.bookings")}
        />
        <InteractiveKpiCard
          icon={Wallet}
          label="Total investido"
          value={formatBRL(totalInvested)}
          tone="emerald"
          badgeText="100% Protegido"
          hint="Soma de pagamentos confirmados"
          onClick={() => navigate("client.bookings")}
        />
      </div>

      {/* 7. Upcoming bookings + Active quotes side-by-side */}
      <div className="grid gap-5 lg:grid-cols-2">
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
                className="text-primary hover:text-primary h-8 gap-1 text-xs font-semibold"
              >
                Ver tudo
                <ChevronRight className="size-3.5" />
              </Button>
            }
          />
          {isLoading ? (
            <div className="border-border/50 bg-card text-muted-foreground flex items-center justify-center gap-2 rounded-2xl border p-8 text-sm shadow-2xs">
              <Loader2 className="text-primary size-5 animate-spin" />
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
            <div className="space-y-2.5">
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
                    className="group border-border/60 bg-card hover:border-primary/40 focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3.5 rounded-2xl border p-4 text-left transition-all outline-none hover:shadow-xs focus-visible:ring-2"
                  >
                    <Avatar className="border-border/60 size-11 shrink-0 border shadow-2xs">
                      {b.provider.avatarUrl ? (
                        <AvatarImage
                          src={b.provider.avatarUrl}
                          alt={b.provider.name}
                          className="object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                        {initials || "P"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground group-hover:text-primary truncate text-sm font-bold transition-colors">
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
                className="text-primary hover:text-primary h-8 gap-1 text-xs font-semibold"
              >
                Ver tudo
                <ChevronRight className="size-3.5" />
              </Button>
            }
          />
          {isLoading ? (
            <div className="border-border/50 bg-card text-muted-foreground flex items-center justify-center gap-2 rounded-2xl border p-8 text-sm shadow-2xs">
              <Loader2 className="text-primary size-5 animate-spin" />
              Carregando orçamentos…
            </div>
          ) : activeQuotes.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nenhum orçamento ativo"
              description="Solicite um orçamento sob medida e receba propostas detalhadas de profissionais."
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
            <div className="space-y-2.5">
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
                    className="group border-border/60 bg-card focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3.5 rounded-2xl border p-4 text-left transition-all outline-none hover:border-amber-500/40 hover:shadow-xs focus-visible:ring-2"
                  >
                    <Avatar className="border-border/60 size-11 shrink-0 border shadow-2xs">
                      {q.provider.avatarUrl ? (
                        <AvatarImage
                          src={q.provider.avatarUrl}
                          alt={q.provider.name}
                          className="object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="bg-amber-500/10 text-xs font-bold text-amber-700 dark:text-amber-300">
                        {initials || "P"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm font-bold transition-colors group-hover:text-amber-600 dark:group-hover:text-amber-400">
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

      {/* 8. Recent activity timeline */}
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
              className="text-primary hover:text-primary h-8 gap-1 text-xs font-semibold"
            >
              Ver tudo
              <ChevronRight className="size-3.5" />
            </Button>
          }
        />

        {isLoading ? (
          <div className="border-border/50 bg-card text-muted-foreground flex items-center justify-center gap-2 rounded-2xl border p-8 text-sm shadow-2xs">
            <Loader2 className="text-primary size-5 animate-spin" />
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
          <Card className="border-border/60 bg-card overflow-hidden rounded-2xl border shadow-2xs">
            <CardContent className="divide-border/40 divide-y p-0">
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
                    className="hover:bg-muted/40 focus-visible:bg-muted/40 group flex w-full cursor-pointer items-center gap-3.5 px-4 py-3.5 text-left transition-colors outline-none"
                  >
                    <Avatar className="border-border/50 size-10 shrink-0 border shadow-2xs">
                      {provider.avatarUrl ? (
                        <AvatarImage
                          src={provider.avatarUrl}
                          alt={provider.name}
                          className="object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="bg-muted text-foreground text-xs font-bold">
                        {initials || "P"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground group-hover:text-primary truncate text-sm font-semibold transition-colors">
                        {a.title}
                      </p>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs tabular-nums">
                        <span className="text-foreground/75 font-medium">
                          {isBooking ? "Agendamento" : "Orçamento"}
                        </span>{" "}
                        · {provider.name} · {formatRelative(a.at)}
                      </p>
                    </div>
                    {isBooking && a.type === "booking" && a.amount > 0 ? (
                      <span className="text-foreground hidden text-sm font-bold tabular-nums sm:block">
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

      {/* 9. Analytics Charts */}
      <div className="grid gap-5 lg:grid-cols-5">
        {/* Monthly bookings */}
        <Card className="border-border/60 bg-card rounded-2xl border shadow-2xs lg:col-span-3">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="bg-primary/10 text-primary border-primary/20 flex size-8 items-center justify-center rounded-xl border shadow-2xs">
                  <TrendingUp className="size-4" />
                </span>
                <div>
                  <p className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                    Evolução de Agendamentos
                  </p>
                  <p className="text-foreground text-sm font-bold">
                    Histórico mensal (últimos 6 meses)
                  </p>
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
                    strokeWidth={2.5}
                    fill="url(#grad-bookings)"
                    activeDot={{
                      r: 5,
                      fill: "var(--primary)",
                      stroke: "var(--background)",
                      strokeWidth: 2,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Spending per category pie */}
        <Card className="border-border/60 bg-card rounded-2xl border shadow-2xs lg:col-span-2">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="bg-primary/10 text-primary border-primary/20 flex size-8 items-center justify-center rounded-xl border shadow-2xs">
                  <Wallet className="size-4" />
                </span>
                <div>
                  <p className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                    Distribuição de Gastos
                  </p>
                  <p className="text-foreground text-sm font-bold">Por categoria de serviço</p>
                </div>
              </div>
            </div>
            {spendingByCategory.length === 0 ? (
              <div className="flex h-56 flex-col items-center justify-center gap-2 text-center">
                <span className="bg-muted text-muted-foreground border-border/50 flex size-12 items-center justify-center rounded-2xl border">
                  <Wallet className="size-5" />
                </span>
                <p className="text-muted-foreground text-sm font-medium">
                  Sem gastos confirmados ainda.
                </p>
                <p className="text-muted-foreground/75 max-w-xs text-xs">
                  Quando você concluir e pagar por serviços, a distribuição por categoria aparecerá
                  aqui.
                </p>
              </div>
            ) : (
              <div className="h-48 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={spendingByCategory}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
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
                    <span className="text-foreground ml-auto shrink-0 font-bold tabular-nums">
                      {formatBRL(c.value)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* 10. Indique e Ganhe & Comunidade — Programa de Fidelidade */}
      <div className="grid gap-5 lg:grid-cols-2">
        <ReferralCard />
        <ReferralLeaderboard />
      </div>

      {/* 11. Sound & vibration preferences utility */}
      <div className="border-border/50 bg-card/60 rounded-2xl border p-4 shadow-2xs">
        <PreferenceToggles
          soundEnabled={user?.soundEnabled ?? true}
          vibrateEnabled={user?.vibrateEnabled ?? true}
        />
      </div>
    </div>
  )
}
