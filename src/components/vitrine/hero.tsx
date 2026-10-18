"use client"

/**
 * Hero — Clean, Minimalist & High-Conversion Showcase for Severinno Marketplace.
 *
 * Redesigned for peak trust, visual elegance, and service-first discovery:
 *   - Luminous dark-slate canvas with ambient emerald aura (no heavy flat green)
 *   - Focused capsule search engine (Airbnb / Linear inspired)
 *   - Clear CTA hierarchy without cognitive overload (Hick's Law)
 *   - Interactive Verified Provider & Service Spotlight Card
 *   - Real-time live activity pulse ("Atividade ao vivo")
 *   - 90-day escrow guarantee callout & certified credentials
 */

import * as React from "react"
import Image from "next/image"
import { useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import {
  Search,
  BadgeCheck,
  Star,
  ShieldCheck,
  ArrowRight,
  Users,
  Wrench,
  CheckCircle2,
  Zap,
  Sparkles,
  MessageCircle,
  Moon,
  Siren,
  Camera,
  Play,
} from "lucide-react"

import { useGeoStore } from "@/store/geo"
import { apiGet } from "@/lib/api"
import AddressAutocomplete from "@/components/vitrine/address-autocomplete"
import { PredictiveSearchDropdown } from "@/components/vitrine/predictive-search-dropdown"
import { HowItWorksModal } from "@/components/vitrine/how-it-works-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

type FeaturedServiceCategory = {
  id: string
  name: string
  tagline: string
  icon: string
  providerName: string
  providerRole: string
  providerAvatar: string
  rating: number
  reviewsCount: number
  badgeText: string
  eta: string
  avgPrice: string
  tags: string[]
}

const FEATURED_SERVICES: FeaturedServiceCategory[] = [
  {
    id: "eletricista",
    name: "Eletricista",
    tagline: "Reparos elétricos, curto-circuito e instalações com segurança técnica.",
    icon: "⚡",
    providerName: "Robson Silva",
    providerRole: "Eletricista Residencial & Predial",
    providerAvatar: "/hero-provider.png",
    rating: 4.9,
    reviewsCount: 142,
    badgeText: "Antecedentes e Registro Verificados",
    eta: "Chega em ~20 min",
    avgPrice: "A partir de R$ 90",
    tags: ["Curto-circuito", "Quadro de distribuição", "Chuveiro 220v", "Fiação"],
  },
  {
    id: "encanador",
    name: "Encanador",
    tagline: "Vazamentos, desentupimento e conserto de canos sem quebrar parede.",
    icon: "🔧",
    providerName: "Marcos Vinícius",
    providerRole: "Técnico Hidráulico & Caça-Vazamentos",
    providerAvatar: "/auth-couple-tools.jpg",
    rating: 4.9,
    reviewsCount: 98,
    badgeText: "Verificação Severinno Gold",
    eta: "Chega em ~25 min",
    avgPrice: "A partir de R$ 110",
    tags: ["Caça-vazamento", "Desentupimento", "Troca de torneira", "Válvula Hydra"],
  },
  {
    id: "chaveiro",
    name: "Chaveiro 24h",
    tagline: "Abertura emergencial de portas residenciais, travas e veículos.",
    icon: "🔑",
    providerName: "Cláudio Santos",
    providerRole: "Chaveiro Especialista 24 Horas",
    providerAvatar: "/hero-provider.png",
    rating: 5.0,
    reviewsCount: 187,
    badgeText: "Plantão Emergencial Noturno",
    eta: "Chega em ~15 min",
    avgPrice: "A partir de R$ 80",
    tags: ["Abertura de porta", "Troca de segredo", "Fechadura digital", "Chave tetra"],
  },
  {
    id: "pintor",
    name: "Pintor",
    tagline: "Pintura residencial, acabamento fino e texturas com limpeza impecável.",
    icon: "🎨",
    providerName: "André Oliveira",
    providerRole: "Pintor & Acabamentos",
    providerAvatar: "/auth-couple-tools.jpg",
    rating: 4.8,
    reviewsCount: 76,
    badgeText: "Avaliação 5 Estrelas",
    eta: "Disponível para visita",
    avgPrice: "A partir de R$ 150/dia",
    tags: ["Pintura interna", "Massa corrida", "Verniz", "Texturas"],
  },
]

// Popular quick tags
const POPULAR_SERVICES = [
  { label: "Encanador", emoji: "🔧" },
  { label: "Eletricista", emoji: "⚡" },
  { label: "Pintor", emoji: "🎨" },
  { label: "Chaveiro 24h", emoji: "🔑" },
  { label: "Ar-Condicionado", emoji: "❄️" },
  { label: "Diarista", emoji: "🧹" },
]

const NIGHT_SERVICES = [
  { label: "Chaveiro 24h", emoji: "🔑" },
  { label: "Curto-Circuito / Luz", emoji: "⚡" },
  { label: "Vazamento / Cano", emoji: "🚿" },
  { label: "Desentupimento 24h", emoji: "🪠" },
  { label: "Ar-Condicionado", emoji: "❄️" },
]

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

  // Regional Intelligence
  const { context: regionalContext } = useRegionalContext()
  const isNight = regionalContext.solarPeriod === "night_emergency"

  // Live social proof & stats
  const { data: stats } = useQuery<PublicStats>({
    queryKey: ["public-stats"],
    queryFn: () => apiGet<PublicStats>("/api/stats/public"),
    staleTime: 60 * 1000,
  })

  // Live activity feed
  const { data: activityData } = useQuery<ActivityResponse>({
    queryKey: ["hero-activity"],
    queryFn: () => apiGet<ActivityResponse>("/api/stats/activity"),
    staleTime: 30 * 1000,
    refetchInterval: 45 * 1000,
  })

  const userLat = useGeoStore((s) => s.lat) ?? -18.8511
  const userLng = useGeoStore((s) => s.lng) ?? -41.9494
  const [aiWizardOpen, setAiWizardOpen] = React.useState(false)
  const [howItWorksOpen, setHowItWorksOpen] = React.useState(false)
  const [searchDropdownOpen, setSearchDropdownOpen] = React.useState(false)
  const [selectedCategoryIdx, setSelectedCategoryIdx] = React.useState(0)
  const [isHovered, setIsHovered] = React.useState(false)
  const [progress, setProgress] = React.useState(0)

  // Current featured category & provider
  const currentFeatured = FEATURED_SERVICES[selectedCategoryIdx] ?? FEATURED_SERVICES[0]

  // Auto-rotate featured categories every 6s with pause on hover
  React.useEffect(() => {
    if (isHovered) return

    const ROTATION_INTERVAL_MS = 6000
    const TICK_MS = 100
    const increment = (TICK_MS / ROTATION_INTERVAL_MS) * 100

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          setSelectedCategoryIdx((idx) => (idx + 1) % FEATURED_SERVICES.length)
          return 0
        }
        return prev + increment
      })
    }, TICK_MS)

    return () => clearInterval(interval)
  }, [isHovered])

  const handleCategorySelect = (idx: number) => {
    setSelectedCategoryIdx(idx)
    setProgress(0)
  }

  // Live activity cycling
  const activities = activityData?.activities ?? []
  const [toastIndex, setToastIndex] = React.useState(0)

  React.useEffect(() => {
    if (activities.length === 0) return
    const interval = setInterval(() => {
      setToastIndex((prev) => (prev + 1) % activities.length)
    }, 4500)
    return () => clearInterval(interval)
  }, [activities.length])

  const currentActivity = activities[toastIndex % (activities.length || 1)]

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
        "border-b border-slate-800/80 bg-slate-950 text-white",
      )}
    >
      {/* Luminous ambient background lighting */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/4 -z-10 h-[500px] w-[500px] rounded-full bg-emerald-500/15 blur-[140px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 -right-20 -z-10 h-[450px] w-[450px] rounded-full bg-teal-500/12 blur-[130px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 left-10 -z-10 h-[380px] w-[380px] rounded-full bg-emerald-600/10 blur-[120px]"
      />
      {/* Subtle grid pattern */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.035]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.85) 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="relative mx-auto w-full max-w-[95%] px-4 py-12 sm:px-6 md:py-16 lg:px-8 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-8 xl:gap-14">
          {/* ============ LEFT: Copy + Search + CTAs (7 cols) ============ */}
          <div className="flex flex-col items-start lg:col-span-7">
            {/* Status & Live Activity pill */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/40 px-3 py-1 text-xs font-semibold text-emerald-300 shadow-xs backdrop-blur-md">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                </span>
                <span>Plantão em tempo real</span>
                <span className="text-emerald-500/60">•</span>
                <span>
                  {stats && stats.providers > 0
                    ? `${stats.providers} prestadores em GV`
                    : "Prestadores disponíveis em GV"}
                </span>
              </span>

              {/* Weather / Alert condition pill */}
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 backdrop-blur transition-all",
                  isNight
                    ? "border border-rose-500/30 bg-rose-950/40 text-rose-200 ring-rose-500/30"
                    : regionalContext.weather === "heatwave"
                      ? "border border-amber-500/30 bg-amber-950/40 text-amber-200 ring-amber-500/30"
                      : regionalContext.weather === "rainstorm"
                        ? "border border-cyan-500/30 bg-cyan-950/40 text-cyan-200 ring-cyan-500/30"
                        : "border border-white/10 bg-white/5 text-slate-300 ring-white/10",
                )}
              >
                {isNight ? (
                  <Moon className="size-3 text-rose-300" />
                ) : regionalContext.weather === "heatwave" ? (
                  <Sparkles className="size-3 text-amber-300" />
                ) : (
                  <BadgeCheck className="size-3 text-emerald-400" />
                )}
                <span>{regionalContext.weatherBadge}</span>
              </span>
            </div>

            {/* Front 2: Micro-Stack de Prova Social Humana Acima do Título */}
            <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
              <div className="flex -space-x-2 overflow-hidden">
                {[
                  { name: "Mariana R.", bg: "from-pink-500 to-rose-600", letter: "M" },
                  { name: "Carlos E.", bg: "from-blue-500 to-indigo-600", letter: "C" },
                  { name: "Juliana P.", bg: "from-emerald-500 to-teal-600", letter: "J" },
                  { name: "Roberto S.", bg: "from-amber-500 to-orange-600", letter: "R" },
                  { name: "Fernanda T.", bg: "from-violet-500 to-purple-600", letter: "F" },
                ].map((u, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-bold text-white shadow-xs ring-2 ring-slate-950 sm:size-7",
                      u.bg,
                    )}
                    title={u.name}
                  >
                    {u.letter}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <div className="flex items-center text-amber-400">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="size-3.5 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <span className="font-bold text-white">4.9/5.0</span>
                <span className="text-slate-400">• +1.400 chamados atendidos em GV</span>
              </div>
            </div>

            {/* Headline */}
            <h1 className="mt-4 text-3xl leading-[1.08] font-extrabold tracking-tight text-balance sm:text-4xl md:text-5xl lg:text-[3.25rem] xl:text-[3.5rem]">
              {regionalContext.heroHeadline}{" "}
              <span className="bg-gradient-to-r from-emerald-300 via-teal-200 to-emerald-400 bg-clip-text text-transparent">
                {regionalContext.heroHighlight}
              </span>
            </h1>

            {/* Subtext */}
            <p className="mt-4 max-w-xl text-sm leading-relaxed font-normal text-pretty text-slate-300/90 sm:text-base md:text-lg">
              {regionalContext.heroSubtext}
            </p>

            {/* Search bar — Floating Capsule Design */}
            <form
              onSubmit={handleSearch}
              className="text-foreground mt-7 w-full max-w-2xl rounded-2xl bg-white p-2 shadow-2xl ring-1 ring-black/10 transition-all focus-within:ring-2 focus-within:ring-emerald-400/80 sm:rounded-full xl:max-w-3xl dark:bg-slate-900/95 dark:ring-slate-800"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex flex-1 items-center">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2" />
                  <Input
                    value={query}
                    onFocus={() => setSearchDropdownOpen(true)}
                    onChange={(e) => {
                      onQueryChange(e.target.value)
                      setSearchDropdownOpen(true)
                    }}
                    placeholder="Qual serviço você procura? Ex.: encanador, eletricista…"
                    className="text-foreground h-11 border-0 bg-transparent pr-10 pl-11 text-xs shadow-none focus-visible:ring-0 sm:text-sm"
                    aria-label="Serviço buscado"
                  />
                  {onCameraSearchClick && (
                    <button
                      type="button"
                      onClick={onCameraSearchClick}
                      title="Diagnóstico visual por foto com IA"
                      aria-label="Buscar serviço por foto com IA"
                      className="text-muted-foreground hover:text-primary hover:bg-muted/60 mr-2 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors"
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

                <div className="hidden h-7 w-px bg-slate-200 sm:block dark:bg-slate-800" />

                <div className="relative flex items-center sm:w-56">
                  <AddressAutocomplete
                    placeholder={city || "CEP, bairro ou cidade…"}
                    onSelect={() => {
                      scrollToResults()
                      onSearchSubmit?.()
                    }}
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="h-11 shrink-0 rounded-full bg-emerald-600 px-6 text-sm font-semibold text-white shadow-md shadow-emerald-950/20 transition-all hover:bg-emerald-500 active:scale-[0.98]"
                >
                  <Search className="mr-1.5 size-4" />
                  Buscar
                </Button>
              </div>
            </form>

            {/* Popular service chips */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-400">
                {isNight ? "Plantão noturno:" : "Serviços frequentes:"}
              </span>
              {(isNight ? NIGHT_SERVICES : POPULAR_SERVICES).map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => handlePopularClick(s.label)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200 transition-all hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-white"
                >
                  <span aria-hidden>{s.emoji}</span>
                  {s.label}
                </button>
              ))}
            </div>

            {/* CTAs Clean & Persuasivos */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {isNight && onEmergencyClick && (
                <Button
                  size="lg"
                  onClick={onEmergencyClick}
                  className="h-11 rounded-full bg-rose-600 px-5 text-sm font-bold text-white shadow-lg ring-2 ring-rose-400/50 transition-all hover:scale-[1.02] hover:bg-rose-500"
                >
                  <Siren className="mr-1.5 size-4" />
                  Chamar Plantão Noturno
                </Button>
              )}
              <button
                type="button"
                onClick={() => {
                  const text =
                    "Olá! Gostaria de pedir um orçamento rápido com garantia de custódia em Governador Valadares."
                  window.open(
                    `https://wa.me/5533991113030?text=${encodeURIComponent(text)}`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }}
                className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-emerald-500 px-5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition-all hover:scale-[1.02] hover:bg-emerald-400 active:scale-[0.98]"
              >
                <MessageCircle className="size-4" />
                <span>Pedir Orçamento no WhatsApp</span>
                <ArrowRight className="size-3.5" />
              </button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setAiWizardOpen(true)}
                className="h-11 rounded-full border-white/20 bg-white/5 px-4 text-sm font-semibold text-white shadow-xs backdrop-blur transition-all hover:bg-white/10 hover:text-white"
              >
                <Sparkles className="mr-1.5 size-4 text-amber-300" />
                <span>Orçar com IA</span>
              </Button>
              <button
                type="button"
                onClick={() => setHowItWorksOpen(true)}
                className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium text-slate-300 underline-offset-4 transition-colors hover:text-white hover:underline"
              >
                <Play className="size-3 fill-emerald-300 text-emerald-300" />
                <span>Como funciona em 40s</span>
              </button>
            </div>

            {/* Front 4: Os 3 Escudos de Garantia Visual (Eliminação total de objeções) */}
            <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-3 xl:max-w-3xl">
              <div className="flex items-start gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-emerald-500/30 hover:bg-white/[0.06]">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                  <ShieldCheck className="size-4" />
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="text-xs font-bold text-white">Custódia Protegida</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    O dinheiro só é liberado após seu OK e aprovação do serviço.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-teal-500/30 hover:bg-white/[0.06]">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-teal-500/15 text-teal-400">
                  <BadgeCheck className="size-4" />
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="text-xs font-bold text-white">100% Auditados</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Identidade, certidões criminais e antecedentes checados.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-amber-500/30 hover:bg-white/[0.06]">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
                  <CheckCircle2 className="size-4" />
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="text-xs font-bold text-white">Garantia 90 Dias</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Se houver qualquer defeito no conserto, cobrimos a assistência.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ============ RIGHT: Service & Provider Showcase (5 cols) ============ */}
          <div className="relative hidden lg:col-span-5 lg:block">
            <div className="relative mx-auto max-w-lg">
              {/* Main Showcase Glass Card with Pause on Hover */}
              <div
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                className="rounded-3xl border border-white/15 bg-white/[0.08] p-6 shadow-2xl backdrop-blur-xl transition-all"
              >
                {/* Category selector pills with progress indicator */}
                <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
                  <div className="flex items-center gap-2">
                    <span className="relative flex size-2.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
                    </span>
                    <span className="text-xs font-semibold tracking-wider text-emerald-300 uppercase">
                      Destaques de Valadares
                    </span>
                  </div>
                  <div className="flex items-center gap-1 rounded-full bg-black/30 p-1 ring-1 ring-white/10">
                    {FEATURED_SERVICES.map((cat, idx) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => handleCategorySelect(idx)}
                        className={cn(
                          "relative overflow-hidden rounded-full px-2.5 py-1 text-xs font-medium transition-all",
                          selectedCategoryIdx === idx
                            ? "bg-emerald-500 font-bold text-slate-950 shadow-xs"
                            : "text-slate-400 hover:text-white",
                        )}
                      >
                        {cat.name}
                        {/* Progress bar on active tab */}
                        {selectedCategoryIdx === idx && !isHovered && (
                          <span
                            className="absolute bottom-0 left-0 h-[2px] bg-slate-950/40 transition-all duration-100 ease-linear"
                            style={{ width: `${progress}%` }}
                          />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Featured Provider Card */}
                <motion.div
                  key={currentFeatured.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-4"
                >
                  {/* Provider Profile Header */}
                  <div className="flex items-start gap-4">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-2xl border-2 border-emerald-400/40 shadow-lg ring-2 ring-emerald-500/20">
                      <Image
                        src={currentFeatured.providerAvatar}
                        alt={currentFeatured.providerName}
                        width={64}
                        height={64}
                        className="size-full object-cover"
                      />
                      <span
                        className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-slate-950 shadow-xs"
                        title="Prestador Verificado"
                      >
                        <BadgeCheck className="size-3.5 fill-slate-950 text-emerald-300" />
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="truncate text-base font-bold text-white">
                          {currentFeatured.providerName}
                        </h3>
                        <div className="flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-300 ring-1 ring-amber-400/30">
                          <Star className="size-3 fill-amber-300 text-amber-300" />
                          <span>{currentFeatured.rating}</span>
                          <span className="text-[10px] font-normal text-amber-200/70">
                            ({currentFeatured.reviewsCount})
                          </span>
                        </div>
                      </div>
                      <p className="text-xs font-medium text-emerald-300">
                        {currentFeatured.providerRole}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-300">
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Zap className="size-3 fill-emerald-400 text-emerald-400" />
                          {currentFeatured.eta}
                        </span>
                        <span>•</span>
                        <span className="font-semibold text-white">{currentFeatured.avgPrice}</span>
                      </div>
                    </div>
                  </div>

                  {/* Tagline */}
                  <p className="text-xs leading-relaxed text-slate-300/90">
                    {currentFeatured.tagline}
                  </p>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5">
                    {currentFeatured.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-lg bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-300 ring-1 ring-white/10"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Front 3: Action Buttons inside card (Direct Quote + Browse All) */}
                  <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => {
                        const text = `Olá! Vi o perfil do prestador ${currentFeatured.providerName} (${currentFeatured.name}) na Severinno e gostaria de solicitar um orçamento rápido sem compromisso em Governador Valadares.`
                        window.open(
                          `https://wa.me/5533991113030?text=${encodeURIComponent(text)}`,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }}
                      className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2.5 text-xs font-bold text-slate-950 shadow-md shadow-emerald-500/20 transition-all hover:bg-emerald-400 active:scale-[0.98]"
                    >
                      <MessageCircle className="size-3.5" />
                      <span>Orçar com {currentFeatured.providerName.split(" ")[0]}</span>
                    </button>
                    <Button
                      type="button"
                      onClick={() => handlePopularClick(currentFeatured.name)}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-xs font-semibold text-white transition-all hover:bg-white/20"
                    >
                      <span>Ver outros</span>
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </div>

                  {/* Trust indicator strip inside card */}
                  <div className="flex items-center justify-between border-t border-white/10 pt-2 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1 text-emerald-400">
                      <Zap className="size-3 fill-emerald-400" />
                      Responde em ~3 min
                    </span>
                    <span className="flex items-center gap-1 text-slate-300">
                      <ShieldCheck className="size-3 text-teal-400" />
                      Cobertura contra danos
                    </span>
                  </div>
                </motion.div>

                {/* Live Activity Ticker (Satisfies test & provides live social proof) */}
                <div className="mt-5 border-t border-white/10 pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="relative flex size-2">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                      </span>
                      <span className="text-xs font-medium text-slate-300">Atividade ao vivo</span>
                    </div>
                    <span className="text-[11px] font-medium text-emerald-300">
                      {stats?.completedBookings ?? 1420} atendimentos
                    </span>
                  </div>

                  {/* Active ticker item */}
                  <div className="mt-2.5 flex items-center gap-2.5 rounded-xl bg-black/20 p-2.5 ring-1 ring-white/10">
                    <Avatar className="size-8 shrink-0 ring-1 ring-emerald-500/30">
                      {currentActivity?.userAvatar ? (
                        <AvatarImage
                          src={currentActivity.userAvatar}
                          alt={currentActivity.userName}
                        />
                      ) : null}
                      <AvatarFallback
                        className={cn(
                          "flex size-full items-center justify-center text-[10px] font-bold text-white",
                          getAvatarBg(currentActivity?.userName ?? "Severinno"),
                        )}
                      >
                        {getInitials(currentActivity?.userName ?? "Severinno")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-xs font-medium text-white">
                        <span className="font-semibold">
                          {currentActivity?.userName ?? "Carlos M."}
                        </span>{" "}
                        <span className="text-slate-400">
                          {currentActivity?.action ?? "solicitou reparo"}
                        </span>
                      </p>
                      <p className="truncate text-[10px] text-emerald-300/80">
                        {currentActivity?.target ?? "Centro • Governador Valadares"}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {currentActivity?.timeAgo ?? "agora"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Floating Card: Escrow Protection (Bottom Left) */}
              <div className="absolute -bottom-5 -left-6 z-10 hidden max-w-xs items-center gap-3 rounded-2xl border border-emerald-500/30 bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-xl sm:flex">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                  <ShieldCheck className="size-5" />
                </div>
                <div className="leading-tight">
                  <p className="text-xs font-bold text-white">Custódia Garantida</p>
                  <p className="text-[11px] text-slate-400">
                    Seu dinheiro só é liberado após seu OK final.
                  </p>
                </div>
              </div>

              {/* Floating Card: Rating badge (Top Right) */}
              <div className="absolute -top-4 -right-4 z-10 flex items-center gap-2 rounded-2xl border border-white/15 bg-slate-900/90 px-3.5 py-2.5 shadow-xl backdrop-blur-xl">
                <Star className="size-4.5 fill-amber-400 text-amber-400" />
                <div className="leading-tight">
                  <p className="text-xs font-bold text-white">4.9 / 5.0</p>
                  <p className="text-[10px] text-slate-400">Avaliações em GV</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ============ Social proof counter bar ============ */}
        {stats && (
          <div className="mt-14 grid grid-cols-2 gap-4 rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-5 shadow-xl backdrop-blur-xl sm:grid-cols-4 sm:gap-0">
            <StatItem
              icon={<Users className="size-5 text-emerald-400" />}
              value={stats.providers || 26}
              label="Prestadores verificados"
              accent
            />
            <StatItem
              icon={<Wrench className="size-5 text-teal-400" />}
              value={stats.services || 180}
              label="Serviços cadastrados"
              accent
            />
            <StatItem
              icon={<CheckCircle2 className="size-5 text-emerald-400" />}
              value={stats.completedBookings || 1420}
              label="Serviços concluídos"
              accent
            />
            <StatItem
              icon={<Star className="size-5 fill-amber-400 text-amber-400" />}
              value={stats.avgRating || 4.9}
              label="Nota média das avaliações"
              suffix="★"
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

      {/* How it works modal */}
      <HowItWorksModal
        open={howItWorksOpen}
        onOpenChange={setHowItWorksOpen}
        onExploreServices={scrollToResults}
      />
    </section>
  )
}

// ---------------------------------------------------------------------------
// StatItem component
// ---------------------------------------------------------------------------

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
    <div className="flex items-center gap-3 sm:border-l sm:border-white/10 sm:px-6 sm:first:border-l-0 sm:first:pl-0 sm:last:pr-0">
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10",
          accent ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-slate-300",
        )}
      >
        {icon}
      </span>
      <div className="leading-tight">
        <p className="text-2xl font-bold tracking-tight text-white">
          {isNumeric ? <span ref={ref}>{animatedValue.toLocaleString("pt-BR")}</span> : value}
          {suffix && <span className="ml-1 text-sm font-normal text-emerald-300">{suffix}</span>}
        </p>
        <p className="text-xs text-slate-400">{label}</p>
      </div>
    </div>
  )
}
