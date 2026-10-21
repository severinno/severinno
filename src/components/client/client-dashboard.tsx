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
  ChevronRight,
  Hammer,
  KeyRound,
  MapPin,
  Paintbrush,
  Plus,
  Search,
  Sparkles,
  Wind,
  Wrench,
  Zap,
} from "lucide-react"

import { triggerHaptic } from "@/lib/haptics"
import { apiGet } from "@/lib/api"
import { type BookingStatus, type QuoteStatus, type ServiceUnit } from "@/lib/constants"
import { useAuthStore } from "@/store/auth"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { OnboardingChecklist } from "@/components/client/onboarding-checklist"
import GeoAwarenessBadge from "@/components/client/geo-awareness-badge"
import { PreferenceToggles } from "@/components/shared/preference-toggles"
import { ReferralCard } from "@/components/shared/referral-card"
import { ReferralLeaderboard } from "@/components/shared/referral-leaderboard"
import { PageHeader } from "@/components/client/client-shared"
import { ClientDashboardCharts } from "@/components/client/client-dashboard-charts"
import { ClientDashboardKpis } from "@/components/client/client-dashboard-kpis"
import { ClientDashboardActivity } from "@/components/client/client-dashboard-activity"

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
// Main Dashboard Component
// ---------------------------------------------------------------------------

export function ClientDashboard() {
  const navigate = useViewStore((s) => s.navigate)
  const openQuote = useUIStore((s) => s.openQuote)
  const user = useAuthStore((s) => s.user)
  const [searchQuery, setSearchQuery] = React.useState("")

  const { data: bookingsData, isLoading: bookingsLoading } = useQuery<BookingsResponse>({
    queryKey: ["client", "bookings", "dashboard"],
    queryFn: () => apiGet<BookingsResponse>("/api/bookings?limit=50"),
    staleTime: 30 * 1000,
  })

  const { data: quotesData, isLoading: quotesLoading } = useQuery<QuotesResponse>({
    queryKey: ["client", "quotes", "dashboard"],
    queryFn: () => apiGet<QuotesResponse>("/api/quotes?limit=20"),
    staleTime: 30 * 1000,
  })

  const bookings = bookingsData?.items ?? []
  const quotes = quotesData?.items ?? []
  const isLoading = bookingsLoading || quotesLoading

  // Active in-progress service if any (for real-time hero banner)
  const inProgressBooking = bookings.find((b) => b.status === "IN_PROGRESS")

  // KPIs
  const upcomingCount = bookings.filter((b) =>
    ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(b.status),
  ).length
  const activeQuotesCount = quotes.filter((q) => ["PENDING", "SENT"].includes(q.status)).length
  const completedCount = bookings.filter((b) => b.status === "COMPLETED").length
  const totalInvested = bookings
    .filter((b) => b.paymentStatus === "PAID")
    .reduce((sum, b) => sum + (b.amount || 0), 0)

  // Monthly evolution of bookings (last 6 months)
  const monthlyData = (() => {
    const months: Array<{ key: string; label: string; total: number }> = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      months.push({ key, label: MONTH_LABELS[d.getMonth()], total: 0 })
    }
    for (const b of bookings) {
      const bDate = new Date(b.scheduledAt)
      const bKey = `${bDate.getFullYear()}-${String(bDate.getMonth() + 1).padStart(2, "0")}`
      const m = months.find((x) => x.key === bKey)
      if (m) m.total += 1
    }
    return months.map(({ label, total }) => ({ label, total }))
  })()

  // Spending per category (for pie chart)
  const spendingByCategory = (() => {
    const map = new Map<string, number>()
    for (const b of bookings) {
      if (b.paymentStatus === "PAID" && b.amount > 0) {
        const cat = b.service?.category?.name || "Outros"
        map.set(cat, (map.get(cat) || 0) + b.amount)
      }
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
  })()

  // Combined recent activity feed
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

  const activeQuotes = quotes.filter((q) => ["PENDING", "SENT"].includes(q.status))

  const firstName = user?.name?.split(" ")[0] || "Cliente"

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return
    triggerHaptic("selection")
    navigate("client.providers", { q: searchQuery.trim() })
  }

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* 1. Header with greeting and primary action */}
      <PageHeader
        title={`Olá, ${firstName}!`}
        subtitle="Acompanhe seus agendamentos, orçamentos e encontre novos prestadores verificados."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                openQuote()
              }}
              className="border-border/70 hover:bg-muted/60 h-9 gap-1.5 rounded-xl px-3.5 text-xs font-semibold shadow-2xs"
            >
              <Plus className="size-3.5" />
              Pedir orçamento
            </Button>
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.providers")
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-1.5 rounded-xl px-4 text-xs font-semibold shadow-2xs"
            >
              <MapPin className="size-3.5" />
              Buscar prestadores
            </Button>
          </div>
        }
      />

      {/* 2. Discovery & Search Dock — Quick Action Command Center */}
      <Card className="border-border/70 bg-card/95 overflow-hidden rounded-2xl border p-4 shadow-2xs sm:p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5">
            <span className="bg-primary/10 text-primary border-primary/20 flex size-9 shrink-0 items-center justify-center rounded-xl border shadow-2xs">
              <Search className="size-4.5" />
            </span>
            <div>
              <p className="text-foreground text-sm font-bold tracking-tight">
                Encontre o profissional ideal para hoje
              </p>
              <p className="text-muted-foreground text-xs">
                Busque por especialidade, serviço ou profissão com geolocalização em tempo real.
              </p>
            </div>
          </div>
          <Button
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

      {/* 3. Onboarding checklist — only shows if profile is incomplete */}
      <OnboardingChecklist />

      {/* 4. Active service alert + Escrow reassurance + 4 Interactive KPI cards */}
      <ClientDashboardKpis
        inProgressBooking={inProgressBooking}
        upcomingCount={upcomingCount}
        activeQuotesCount={activeQuotesCount}
        completedCount={completedCount}
        totalInvested={totalInvested}
        onNavigate={navigate}
      />

      {/* 5. Operational Center: Upcoming bookings + Active quotes + Recent activity */}
      <ClientDashboardActivity
        upcomingBookings={upcomingBookings}
        activeQuotes={activeQuotes}
        recentActivity={recentActivity}
        isLoading={isLoading}
        onNavigate={navigate}
        onOpenQuote={openQuote}
      />

      {/* 6. Analytics Charts (AreaChart bookings evolution + PieChart spending distribution) */}
      <ClientDashboardCharts monthlyData={monthlyData} spendingByCategory={spendingByCategory} />

      {/* 7. Indique e Ganhe & Comunidade — Programa de Fidelidade */}
      <div className="grid gap-5 lg:grid-cols-2">
        <ReferralCard />
        <ReferralLeaderboard />
      </div>

      {/* 8. Sound & vibration preferences utility */}
      <div className="border-border/50 bg-card/60 rounded-2xl border p-4 shadow-2xs">
        <PreferenceToggles
          soundEnabled={user?.soundEnabled ?? true}
          vibrateEnabled={user?.vibrateEnabled ?? true}
        />
      </div>
    </div>
  )
}
