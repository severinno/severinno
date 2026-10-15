"use client"

/**
 * Hero — Interactive, dynamic live-activity engine for the Severinno Marketplace.
 *
 * Redesigned to feel like the visitor is already inside the app:
 *   - Live activity feed showing real bookings, reviews, signups, quotes
 *   - Animated notification toasts cycling through recent activities
 *   - "X pessoas buscando agora" dynamic counter
 *   - Floating activity cards with staggered animations
 *   - Interactive search with live indicators
 *
 * Heuristic mapping:
 *   H1  Visibilidade do status  → live activity feed + browsing counter + loading
 *   H2  Mundo real              → "encanador, eletricista, pintor" / "orçamento grátis"
 *   H3  Controle e liberdade    → browse sem login · "ver como funciona" · sem caminho forçado
 *   H4  Consistência e padrões  → emerald · mesmas alturas de botão · mesma iconografia
 *   H5  Prevenção de erros      → máscara de CEP · busca não vazia · estados disabled
 *   H6  Reconhecimento > memo   → chips de serviços populares · live activity cards
 *   H7  Flexibilidade/eficiência→ GPS 1 clique · Enter · chips de acesso rápido
 *   H8  Estética minimalista    → foco em 1 ação · respiro · sem poluição
 *   H9  Recuperar erros         → mensagens humanas e acionáveis
 *   H10 Ajuda e documentação    → "como funciona" · tooltips nos selos
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import Image from "next/image"
import {
  Search,
  BadgeCheck,
  Star,
  ShieldCheck,
  ArrowRight,
  Users,
  Wrench,
  CheckCircle2,
  Eye,
  Zap,
  TrendingUp,
  CalendarCheck,
  UserPlus,
  FileText,
  Sparkles,
  MessageCircle,
  Moon,
  Siren,
  Camera,
  Play,
} from "lucide-react"

import { useGeoStore } from "@/store/geo"
import { useUIStore } from "@/store/ui"
import { apiGet } from "@/lib/api"
import AddressAutocomplete from "@/components/vitrine/address-autocomplete"
import { PredictiveSearchDropdown } from "@/components/vitrine/predictive-search-dropdown"
import { HowItWorksModal } from "@/components/vitrine/how-it-works-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useCountUp } from "@/hooks/use-animation"
import { cn } from "@/lib/utils"
import { AiQuoteWizard } from "@/components/shared/ai-quote-wizard"
import { useRegionalContext } from "@/hooks/use-regional-context"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PublicStats = {
  providers: number
  services: number
  reviews: number
  completedBookings: number
  avgRating: number
  totalUsers?: number
  recentSignups24h?: number
}

type ActivityItem = {
  type: "booking" | "review" | "signup" | "quote"
  userName: string
  userAvatar?: string | null
  action: string
  target: string
  service?: string | null
  rating?: number | null
  timeAgo: string
  emoji: string
}

type ActivityResponse = {
  activities: ActivityItem[]
  browsingNow: number
  quotesToday: number
}

export type HeroProps = {
  query: string
  onQueryChange: (q: string) => void
  onSearchSubmit?: () => void
  resultsAnchorId?: string
  onEmergencyClick?: () => void
  onCameraSearchClick?: () => void
}

// Popular services — recognition over recall (H6).
const POPULAR_SERVICES = [
  { label: "Encanador", emoji: "🔧" },
  { label: "Eletricista", emoji: "💡" },
  { label: "Pintor", emoji: "🎨" },
  { label: "Diarista", emoji: "🧹" },
  { label: "Pedreiro", emoji: "🧱" },
  { label: "Jardineiro", emoji: "🌿" },
]

const NIGHT_SERVICES = [
  { label: "Chaveiro 24h", emoji: "🔑" },
  { label: "Curto-Circuito / Luz", emoji: "⚡" },
  { label: "Vazamento / Cano", emoji: "🚿" },
  { label: "Desentupimento 24h", emoji: "🪠" },
  { label: "Ar-Condicionado", emoji: "❄️" },
]

// Map activity types to icons and colors
const ACTIVITY_META: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  booking: { icon: CalendarCheck, color: "text-emerald-600", bg: "bg-emerald-50" },
  review: { icon: Star, color: "text-amber-600", bg: "bg-amber-50" },
  signup: { icon: UserPlus, color: "text-blue-600", bg: "bg-blue-50" },
  quote: { icon: FileText, color: "text-violet-600", bg: "bg-violet-50" },
}

function getInitials(name: string): string {
  const clean = name.trim().replace(/^Dra?\.\s*/i, "")
  const parts = clean.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "U"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_GRADIENTS = [
  "from-emerald-500 to-teal-700",
  "from-blue-500 to-indigo-700",
  "from-violet-500 to-purple-700",
  "from-amber-500 to-orange-700",
  "from-rose-500 to-pink-700",
  "from-teal-500 to-cyan-700",
]

function getAvatarBg(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % AVATAR_GRADIENTS.length
  return AVATAR_GRADIENTS[index]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Hero({
  query,
  onQueryChange,
  onSearchSubmit,
  resultsAnchorId,
  onEmergencyClick,
  onCameraSearchClick,
}: HeroProps) {
  const { city } = useGeoStore()
  const openAuth = useUIStore((s) => s.openAuth)

  // Motor de Inteligência e Contexto Regional da Vitrine (Brasil Continental)
  const { context: regionalContext } = useRegionalContext()
  const isNight = regionalContext.solarPeriod === "night_emergency"

  // H1 — Live social proof numbers
  const { data: stats } = useQuery<PublicStats>({
    queryKey: ["public-stats"],
    queryFn: () => apiGet<PublicStats>("/api/stats/public"),
    staleTime: 60 * 1000,
  })

  // Live activity feed
  const { data: activityData, isLoading: activityLoading } = useQuery<ActivityResponse>({
    queryKey: ["hero-activity"],
    queryFn: () => apiGet<ActivityResponse>("/api/stats/activity"),
    staleTime: 30 * 1000,
    refetchInterval: 45 * 1000, // Auto-refresh for live feel
  })

  const userLat = useGeoStore((s) => s.lat) ?? -23.5505
  const userLng = useGeoStore((s) => s.lng) ?? -46.6333
  const [aiWizardOpen, setAiWizardOpen] = React.useState(false)
  const [howItWorksOpen, setHowItWorksOpen] = React.useState(false)
  const [searchDropdownOpen, setSearchDropdownOpen] = React.useState(false)

  // ---- Actions -------------------------------------------------------------

  const scrollToResults = React.useCallback(() => {
    if (!resultsAnchorId || typeof window === "undefined") return
    window.setTimeout(() => {
      document
        .getElementById(resultsAnchorId)
        ?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 80)
  }, [resultsAnchorId])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    onSearchSubmit?.()
    scrollToResults()
  }

  const handlePopularClick = (label: string) => {
    onQueryChange(label)
    onSearchSubmit?.()
    scrollToResults()
  }

  // ---- Render --------------------------------------------------------------

  return (
    <section
      className={cn(
        "relative isolate overflow-hidden",
        "bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800",
        "text-white",
      )}
    >
      {/* Subtle pattern */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.9) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />
      {/* Animated mesh blobs */}
      <div
        aria-hidden
        className="absolute -top-24 -right-24 size-72 animate-pulse rounded-full bg-emerald-400/30 blur-3xl"
        style={{ animationDuration: "6s" }}
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -left-20 size-80 animate-pulse rounded-full bg-teal-300/20 blur-3xl"
        style={{ animationDuration: "7s", animationDelay: "1.5s" }}
      />
      <div
        aria-hidden
        className="absolute top-1/3 right-1/4 size-56 animate-pulse rounded-full bg-emerald-300/15 blur-3xl"
        style={{ animationDuration: "8s", animationDelay: "0.8s" }}
      />

      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-16 lg:px-8 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-12">
          {/* ============ LEFT: copy + search + CTA ============ */}
          <div className="flex flex-col items-start">
            {/* H1 — Status badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 backdrop-blur transition-all",
                  isNight
                    ? "bg-rose-500/30 text-rose-200 shadow-sm shadow-rose-950/40 ring-rose-400/40"
                    : regionalContext.weather === "heatwave"
                      ? "bg-amber-500/20 text-amber-200 ring-amber-400/30"
                      : regionalContext.weather === "rainstorm"
                        ? "bg-cyan-500/20 text-cyan-200 ring-cyan-400/30"
                        : "bg-white/15 text-white ring-white/20",
                )}
              >
                {isNight ? (
                  <Moon className="size-3.5 text-rose-300" />
                ) : regionalContext.weather === "heatwave" ? (
                  <Sparkles className="size-3.5 text-amber-300" />
                ) : (
                  <BadgeCheck className="size-3.5" />
                )}
                {regionalContext.weatherBadge}
              </span>
              {stats && stats.providers > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-medium ring-1 ring-emerald-300/30">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-300" />
                  </span>
                  {stats.providers} prestadores ativos agora
                </span>
              )}
              {activityData && activityData.browsingNow > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/15">
                  <Eye className="size-3" />
                  {activityData.browsingNow} pessoas buscando
                </span>
              )}
            </div>

            {/* H2 — Linguagem do mundo real adaptativa */}
            <h1 className="mt-5 text-3xl leading-[1.1] font-bold tracking-tight text-balance sm:text-4xl md:text-5xl">
              {regionalContext.heroHeadline}{" "}
              <span className="text-emerald-200">{regionalContext.heroHighlight}</span>
            </h1>
            <p className="mt-4 max-w-xl text-sm font-light text-pretty text-emerald-50/90 sm:text-base md:text-lg">
              {regionalContext.heroSubtext}
            </p>

            {/* Search bar */}
            <form
              onSubmit={handleSearch}
              className="text-foreground mt-7 w-full max-w-xl rounded-2xl bg-white p-2 shadow-2xl ring-1 ring-black/5"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex flex-1 items-center">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" />
                  <Input
                    value={query}
                    onFocus={() => setSearchDropdownOpen(true)}
                    onChange={(e) => {
                      onQueryChange(e.target.value)
                      setSearchDropdownOpen(true)
                    }}
                    placeholder="O que você precisa? Ex.: encanador, pintura…"
                    className="h-12 border-0 bg-transparent pr-10 pl-10 text-left shadow-none focus-visible:ring-0"
                    aria-label="Serviço buscado"
                  />
                  {onCameraSearchClick && (
                    <button
                      type="button"
                      onClick={onCameraSearchClick}
                      title="Diagnóstico visual por foto com IA"
                      aria-label="Buscar serviço por foto com IA"
                      className="text-muted-foreground hover:text-primary hover:bg-muted/60 mr-2 flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
                    >
                      <Camera className="size-4" />
                    </button>
                  )}
                  <PredictiveSearchDropdown
                    query={query}
                    isOpen={searchDropdownOpen}
                    onSelect={(val) => {
                      onQueryChange(val)
                      setSearchDropdownOpen(false)
                      onSearchSubmit?.()
                      scrollToResults()
                    }}
                    onClose={() => setSearchDropdownOpen(false)}
                  />
                </div>
                <div className="relative flex items-center sm:w-56">
                  <AddressAutocomplete
                    placeholder={city || "CEP, cidade ou endereço…"}
                    onSelect={() => {
                      scrollToResults()
                      onSearchSubmit?.()
                    }}
                  />
                </div>
                <Button
                  type="submit"
                  size="lg"
                  className="h-12 shrink-0 rounded-xl px-6 text-base shadow-sm"
                >
                  <Search className="size-4" />
                  Buscar
                </Button>
              </div>
            </form>

            {/* Popular service chips adaptativos */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-emerald-100/80">
                {isNight ? "Plantão noturno:" : "Mais buscados:"}
              </span>
              {(isNight ? NIGHT_SERVICES : POPULAR_SERVICES).map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => handlePopularClick(s.label)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-white ring-1 transition-colors focus-visible:outline-none",
                    isNight
                      ? "bg-rose-500/20 ring-rose-400/30 hover:bg-rose-500/30"
                      : "bg-white/10 ring-white/15 hover:bg-white/20",
                  )}
                >
                  <span aria-hidden>{s.emoji}</span>
                  {s.label}
                </button>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {isNight && onEmergencyClick && (
                <Button
                  size="lg"
                  onClick={onEmergencyClick}
                  className="h-11 rounded-xl bg-rose-600 px-5 text-base font-extrabold text-white shadow-xl ring-2 ring-rose-400/50 transition-all hover:scale-[1.02] hover:bg-rose-500"
                >
                  <Siren className="size-4" />
                  Chamar Plantão Noturno
                </Button>
              )}
              <Button
                size="lg"
                onClick={() => setAiWizardOpen(true)}
                className="h-11 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-5 text-base font-bold text-zinc-950 shadow-xl transition-all hover:scale-[1.02] hover:from-amber-300 hover:to-amber-400"
              >
                <Sparkles className="size-4" />
                Orçar com IA Local
              </Button>
              <Button
                size="lg"
                onClick={() => openAuth("register", "CLIENT")}
                className="h-11 rounded-xl bg-white px-5 text-base font-semibold text-emerald-700 shadow-lg hover:bg-emerald-50"
              >
                Cadastrar grátis
                <ArrowRight className="size-4" />
              </Button>
              <button
                type="button"
                onClick={() => {
                  const text =
                    "Olá! Gostaria de pedir um orçamento rápido com garantia de custódia em Governador Valadares."
                  window.open(
                    `https://wa.me/5533999999999?text=${encodeURIComponent(text)}`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }}
                className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-emerald-500/30 px-4 text-sm font-bold text-white shadow-md ring-1 ring-emerald-300/40 backdrop-blur transition-all hover:scale-[1.02] hover:bg-emerald-500/40"
              >
                <MessageCircle className="size-4 text-emerald-300" />
                <span>Orçar pelo WhatsApp</span>
              </button>
              <button
                type="button"
                onClick={() => setHowItWorksOpen(true)}
                className="inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-emerald-50 underline-offset-4 transition-colors hover:text-white hover:underline"
              >
                <Play className="size-3.5 fill-emerald-200 text-emerald-200" />
                <span>Como funciona em 40s</span>
              </button>
            </div>

            <p className="mt-3 text-xs text-emerald-100/70">
              Cadastro grátis · Orçamento sem compromisso · Você escolhe o profissional
            </p>

            {/* Trust badges */}
            <ul className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-emerald-50">
              <TrustBadge
                icon={<BadgeCheck className="size-4" />}
                title="Prestadores verificados"
                tooltip="Documentos validados e identidade confirmada"
              />
              <TrustBadge
                icon={<Star className="size-4" />}
                title="Avaliações reais"
                tooltip="Avaliações de clientes após a conclusão do serviço"
              />
              <TrustBadge
                icon={<ShieldCheck className="size-4" />}
                title="Pagamento seguro"
                tooltip="Pagamento só é liberado após você marcar como concluído"
              />
            </ul>
          </div>

          {/* ============ RIGHT: Live Activity Feed ============ */}
          <div className="relative hidden lg:block">
            <LiveActivityPanel
              activities={activityData?.activities ?? []}
              browsingNow={activityData?.browsingNow ?? 0}
              quotesToday={activityData?.quotesToday ?? 0}
              stats={stats}
              isLoading={activityLoading}
            />
          </div>
        </div>

        {/* ============ Social proof bar ============ */}
        {stats && (
          <div className="mt-12 grid grid-cols-2 gap-4 rounded-2xl bg-white/10 px-6 py-5 ring-1 ring-white/15 backdrop-blur sm:grid-cols-4 sm:gap-0">
            <StatItem
              icon={<Users className="size-5" />}
              value={stats.providers}
              label="Prestadores verificados"
              accent
            />
            <StatItem
              icon={<Wrench className="size-5" />}
              value={stats.services}
              label="Serviços cadastrados"
              accent
            />
            <StatItem
              icon={<CheckCircle2 className="size-5" />}
              value={stats.completedBookings}
              label="Serviços concluídos"
              accent
            />
            <StatItem
              icon={<Star className="size-5" />}
              value={stats.avgRating || "—"}
              label="Nota média das avaliações"
              suffix={stats.avgRating ? "★" : undefined}
              accent
            />
          </div>
        )}
      </div>
      {/* AI Quote Wizard Modal */}
      <AiQuoteWizard
        open={aiWizardOpen}
        onOpenChange={setAiWizardOpen}
        userLat={userLat}
        userLng={userLng}
        onRequestQuoteWithAi={(estimation) => {
          onQueryChange(estimation.categoryName || estimation.suggestedTitle)
          scrollToResults()
          onSearchSubmit?.()
        }}
      />
      <HowItWorksModal
        open={howItWorksOpen}
        onOpenChange={setHowItWorksOpen}
        onExploreServices={scrollToResults}
      />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Live Activity Panel — the interactive right side
// ---------------------------------------------------------------------------

function LiveActivityPanel({
  activities,
  browsingNow,
  quotesToday,
  stats,
  isLoading,
}: {
  activities: ActivityItem[]
  browsingNow: number
  quotesToday: number
  stats?: PublicStats
  isLoading: boolean
}) {
  // Cycle through toast notifications
  const [toastIndex, setToastIndex] = React.useState(0)
  const [visibleActivities, setVisibleActivities] = React.useState<ActivityItem[]>([])

  // Stagger-reveal activities — reset synchronous via adjust-state-during-render,
  // then fill asynchronously (async timeouts are outside the effect body).
  const [prevActivities, setPrevActivities] = React.useState(activities)
  if (prevActivities !== activities) {
    setPrevActivities(activities)
    setVisibleActivities([])
  }

  React.useEffect(() => {
    if (activities.length === 0) return
    activities.forEach((_, i) => {
      setTimeout(() => {
        setVisibleActivities((prev) => [...prev, activities[i]])
      }, i * 300)
    })
  }, [activities])

  // Cycle toast
  React.useEffect(() => {
    if (activities.length === 0) return
    const interval = setInterval(() => {
      setToastIndex((prev) => (prev + 1) % activities.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [activities.length])

  return (
    <div className="relative">
      {/* ── Main activity feed card ── */}
      <div className="rounded-3xl bg-white/10 p-5 shadow-2xl ring-1 ring-white/20 backdrop-blur-md">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-sm font-semibold text-white">Atividade ao vivo</span>
          </div>
          {browsingNow > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-100 ring-1 ring-white/10">
              <Eye className="size-3" />
              {browsingNow} online
            </span>
          )}
        </div>

        {/* Activity list */}
        <div className="max-h-[400px] scrollbar-thin space-y-2.5 overflow-y-auto pr-1">
          {isLoading ? (
            // Skeleton loading
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
                <Skeleton className="size-10 shrink-0 rounded-full bg-white/10" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-3/4 rounded bg-white/10" />
                  <Skeleton className="h-3 w-1/2 rounded bg-white/10" />
                </div>
              </div>
            ))
          ) : visibleActivities.length === 0 ? (
            // Empty state
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Zap className="size-8 text-emerald-300/50" />
              <p className="text-sm text-emerald-200/70">Carregando atividades…</p>
            </div>
          ) : (
            visibleActivities.map((activity, i) => (
              <ActivityCard
                key={`${activity.type}-${activity.userName}-${i}`}
                activity={activity}
                index={i}
              />
            ))
          )}
        </div>

        {/* Footer stats */}
        <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
          {quotesToday > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-200/80">
              <FileText className="size-3" />
              {quotesToday} orçamentos hoje
            </span>
          )}
          {stats && stats.completedBookings > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-200/80">
              <TrendingUp className="size-3" />
              {stats.completedBookings.toLocaleString("pt-BR")} concluídos
            </span>
          )}
        </div>
      </div>

      {/* ── Floating toast notification ── */}
      <AnimatePresence mode="wait">
        {activities.length > 0 &&
          (() => {
            const current = activities[toastIndex % activities.length]
            return (
              <motion.div
                key={`toast-${toastIndex}`}
                initial={{ opacity: 0, y: 12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="absolute -bottom-4 -left-4 z-10 flex items-center gap-2.5 rounded-2xl bg-white px-3.5 py-2.5 shadow-2xl ring-1 ring-black/5"
              >
                <div className="relative shrink-0">
                  <Avatar className="size-9 shadow-sm ring-2 ring-emerald-500/20">
                    {current.userAvatar ? (
                      <AvatarImage
                        src={current.userAvatar}
                        alt={current.userName}
                        className="size-full object-cover"
                      />
                    ) : null}
                    <AvatarFallback
                      className={cn(
                        "flex size-full items-center justify-center bg-gradient-to-br text-xs font-bold text-white shadow-inner",
                        getAvatarBg(current.userName),
                      )}
                    >
                      {getInitials(current.userName)}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-white text-[9px] shadow-sm ring-1 ring-black/10"
                    aria-hidden
                  >
                    {current.emoji}
                  </span>
                </div>
                <div className="leading-tight">
                  <p className="text-xs font-semibold text-slate-900">
                    {current.userName}{" "}
                    <span className="font-medium text-emerald-700">{current.action}</span>
                  </p>
                  <p className="text-[11px] text-slate-500">{current.target}</p>
                </div>
                <span className="ml-2 text-[10px] whitespace-nowrap text-slate-400">
                  {current.timeAgo}
                </span>
              </motion.div>
            )
          })()}
      </AnimatePresence>

      {/* ── Floating rating badge ── */}
      {stats && stats.avgRating > 0 && (
        <div className="absolute -top-3 -right-3 flex items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-xl ring-1 ring-black/5">
          <Star className="size-5 fill-amber-400 text-amber-400" />
          <div className="leading-tight">
            <p className="text-base font-bold text-slate-900">{stats.avgRating}</p>
            <p className="text-[11px] text-slate-500">{stats.reviews} avaliações</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activity Card — individual activity in the feed
// ---------------------------------------------------------------------------

function ActivityCard({ activity, index }: { activity: ActivityItem; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08, duration: 0.35, ease: "easeOut" }}
      className="group flex items-start gap-3 rounded-xl bg-white/5 p-3 transition-colors hover:bg-white/10"
    >
      {/* Avatar with photo and action badge */}
      <div className="relative shrink-0">
        <Avatar className="size-10 shadow-sm ring-2 ring-white/20">
          {activity.userAvatar ? (
            <AvatarImage
              src={activity.userAvatar}
              alt={activity.userName}
              className="size-full object-cover"
            />
          ) : null}
          <AvatarFallback
            className={cn(
              "flex size-full items-center justify-center bg-gradient-to-br text-xs font-bold text-white shadow-inner",
              getAvatarBg(activity.userName),
            )}
          >
            {getInitials(activity.userName)}
          </AvatarFallback>
        </Avatar>
        {/* Activity type badge */}
        <span
          className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-slate-900/80 text-[10px] shadow-sm ring-1 ring-white/20"
          aria-hidden
        >
          {activity.emoji}
        </span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug font-medium text-white/90">
          <span className="font-semibold">{activity.userName}</span>{" "}
          <span className="text-emerald-200/80">{activity.action}</span>
        </p>
        <p className="mt-0.5 truncate text-xs text-emerald-100/60">{activity.target}</p>
        {activity.rating && (
          <div className="mt-1 flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={cn(
                  "size-3",
                  i < (activity.rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-white/20",
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Time */}
      <span className="shrink-0 text-[10px] font-medium text-emerald-200/50">
        {activity.timeAgo}
      </span>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function TrustBadge({
  icon,
  title,
  tooltip,
}: {
  icon: React.ReactNode
  title: string
  tooltip: string
}) {
  return (
    <li className="flex items-center gap-2" title={tooltip}>
      <span className="flex size-6 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
        {icon}
      </span>
      <span className="font-medium whitespace-nowrap">{title}</span>
    </li>
  )
}

function StatItem({
  icon,
  value,
  label,
  suffix,
  accent,
}: {
  icon: React.ReactNode
  value: number | string
  label: string
  suffix?: string
  accent?: boolean
}) {
  const numericValue = typeof value === "number" ? value : 0
  const isNumeric = typeof value === "number"
  const { ref, value: animatedValue } = useCountUp(numericValue, {
    duration: 1800,
  })

  return (
    <div className="flex items-center gap-3 sm:border-l sm:border-white/20 sm:px-6 sm:first:border-l-0 sm:first:pl-0 sm:last:pr-0">
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl ring-1",
          accent ? "bg-emerald-400/20 ring-emerald-300/30" : "bg-white/10 ring-white/15",
        )}
      >
        {icon}
      </span>
      <div className="leading-tight">
        <p className="text-2xl font-bold tracking-tight text-white">
          {isNumeric ? <span ref={ref}>{animatedValue.toLocaleString("pt-BR")}</span> : value}
          {suffix && <span className="ml-1 text-sm font-normal text-emerald-200">{suffix}</span>}
        </p>
        <p className="text-xs text-emerald-100/80">{label}</p>
      </div>
    </div>
  )
}
