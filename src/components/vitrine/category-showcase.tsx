"use client"

/**
 * CategoryShowcase — redesigned with Jakob Nielsen's 10 Usability Heuristics.
 *
 * Heuristics applied:
 *   H1 – Rich loading skeleton with shimmer + animated pulse on active filter badge
 *   H2 – Real category examples, provider count per category, emoji + icon combos
 *   H3 – Click to select/deselect, clear filter button, "Ver todas" expand section
 *   H4 – Consistent rounded-2xl cards, shadow system, emerald/teal/amber/cyan accents
 *   H5 – Graceful empty state, error state with retry, no broken layouts
 *   H6 – Large prominent icons, color-coded card tints, service examples visible
 *   H7 – Horizontal scroll chips on mobile, grid on desktop, keyboard nav, popular bar
 *   H8 – Clean white background, generous whitespace, subtle shadows, minimal clutter
 *   H9 – Friendly empty/error states with "Tentar novamente" button
 *  H10 – Tooltips explaining each category, info badges on cards
 */

import * as React from "react"
import {
  Wrench,
  Sparkles,
  Hammer,
  PaintRoller,
  Leaf,
  Truck,
  Plug,
  Droplets,
  Scissors,
  Laptop,
  Camera,
  Utensils,
  ShoppingCart,
  PawPrint,
  GraduationCap,
  Dumbbell,
  PartyPopper,
  HeartPulse,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X,
  Info,
  RefreshCw,
  Search,
  Check,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

import { cn } from "@/lib/utils"
import type { Category } from "@/lib/api"
import { useScrollReveal, useCountUp } from "@/hooks/use-animation"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import {
  ScrollArea,
  ScrollBar,
} from "@/components/ui/scroll-area"

// ---------------------------------------------------------------------------
// Color tint system — each category gets a unique subtle background tint
// ---------------------------------------------------------------------------

type CategoryTint = {
  bg: string
  bgActive: string
  gradientFrom: string
  gradientTo: string
  gradientActiveFrom: string
  gradientActiveTo: string
  text: string
  textActive: string
  ring: string
  hoverBorder: string
  darkBg: string
  darkBgActive: string
  darkGradientFrom: string
  darkGradientTo: string
  darkText: string
  darkRing: string
}

const TINTS: Record<string, CategoryTint> = {
  emerald: {
    bg: "bg-emerald-50",
    bgActive: "bg-emerald-100/70",
    gradientFrom: "from-emerald-100",
    gradientTo: "to-teal-100",
    gradientActiveFrom: "from-emerald-500",
    gradientActiveTo: "to-teal-600",
    text: "text-emerald-600",
    textActive: "text-white",
    ring: "ring-emerald-400",
    hoverBorder: "hover:border-emerald-300",
    darkBg: "dark:bg-emerald-950/40",
    darkBgActive: "dark:bg-emerald-950/60",
    darkGradientFrom: "dark:from-emerald-950/60",
    darkGradientTo: "dark:to-teal-950/60",
    darkText: "dark:text-emerald-400",
    darkRing: "dark:ring-emerald-600",
  },
  teal: {
    bg: "bg-teal-50",
    bgActive: "bg-teal-100/70",
    gradientFrom: "from-teal-100",
    gradientTo: "to-cyan-100",
    gradientActiveFrom: "from-teal-500",
    gradientActiveTo: "to-cyan-600",
    text: "text-teal-600",
    textActive: "text-white",
    ring: "ring-teal-400",
    hoverBorder: "hover:border-teal-300",
    darkBg: "dark:bg-teal-950/40",
    darkBgActive: "dark:bg-teal-950/60",
    darkGradientFrom: "dark:from-teal-950/60",
    darkGradientTo: "dark:to-cyan-950/60",
    darkText: "dark:text-teal-400",
    darkRing: "dark:ring-teal-600",
  },
  amber: {
    bg: "bg-amber-50",
    bgActive: "bg-amber-100/70",
    gradientFrom: "from-amber-100",
    gradientTo: "to-orange-100",
    gradientActiveFrom: "from-amber-500",
    gradientActiveTo: "to-orange-500",
    text: "text-amber-600",
    textActive: "text-white",
    ring: "ring-amber-400",
    hoverBorder: "hover:border-amber-300",
    darkBg: "dark:bg-amber-950/40",
    darkBgActive: "dark:bg-amber-950/60",
    darkGradientFrom: "dark:from-amber-950/60",
    darkGradientTo: "dark:to-orange-950/60",
    darkText: "dark:text-amber-400",
    darkRing: "dark:ring-amber-600",
  },
  cyan: {
    bg: "bg-cyan-50",
    bgActive: "bg-cyan-100/70",
    gradientFrom: "from-cyan-100",
    gradientTo: "to-sky-100",
    gradientActiveFrom: "from-cyan-500",
    gradientActiveTo: "to-sky-600",
    text: "text-cyan-600",
    textActive: "text-white",
    ring: "ring-cyan-400",
    hoverBorder: "hover:border-cyan-300",
    darkBg: "dark:bg-cyan-950/40",
    darkBgActive: "dark:bg-cyan-950/60",
    darkGradientFrom: "dark:from-cyan-950/60",
    darkGradientTo: "dark:to-sky-950/60",
    darkText: "dark:text-cyan-400",
    darkRing: "dark:ring-cyan-600",
  },
  rose: {
    bg: "bg-rose-50",
    bgActive: "bg-rose-100/70",
    gradientFrom: "from-rose-100",
    gradientTo: "to-pink-100",
    gradientActiveFrom: "from-rose-500",
    gradientActiveTo: "to-pink-500",
    text: "text-rose-600",
    textActive: "text-white",
    ring: "ring-rose-400",
    hoverBorder: "hover:border-rose-300",
    darkBg: "dark:bg-rose-950/40",
    darkBgActive: "dark:bg-rose-950/60",
    darkGradientFrom: "dark:from-rose-950/60",
    darkGradientTo: "dark:to-pink-950/60",
    darkText: "dark:text-rose-400",
    darkRing: "dark:ring-rose-600",
  },
  violet: {
    bg: "bg-violet-50",
    bgActive: "bg-violet-100/70",
    gradientFrom: "from-violet-100",
    gradientTo: "to-purple-100",
    gradientActiveFrom: "from-violet-500",
    gradientActiveTo: "to-purple-500",
    text: "text-violet-600",
    textActive: "text-white",
    ring: "ring-violet-400",
    hoverBorder: "hover:border-violet-300",
    darkBg: "dark:bg-violet-950/40",
    darkBgActive: "dark:bg-violet-950/60",
    darkGradientFrom: "dark:from-violet-950/60",
    darkGradientTo: "dark:to-purple-950/60",
    darkText: "dark:text-violet-400",
    darkRing: "dark:ring-violet-600",
  },
}

const TINT_KEYS = Object.keys(TINTS)

function getTint(slug: string): CategoryTint {
  let hash = 0
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0
  }
  return TINTS[TINT_KEYS[Math.abs(hash) % TINT_KEYS.length]]!
}

// ---------------------------------------------------------------------------
// Icon + emoji mapping by slug
// ---------------------------------------------------------------------------

const FALLBACK_ICON = MoreHorizontal

const CATEGORY_META: Record<
  string,
  {
    icon: LucideIcon
    emoji: string
    examples: string
    tooltip: string
    popular?: boolean
    tint?: string
  }
> = {
  reparos: {
    icon: Wrench,
    emoji: "🔧",
    examples: "Encanador, eletricista, marido de aluguel",
    tooltip: "Consertos e manutenção residencial geral",
    popular: true,
    tint: "emerald",
  },
  eletrica: {
    icon: Plug,
    emoji: "⚡",
    examples: "Eletricista, instalação, troca de fiação",
    tooltip: "Instalações e reparos elétricos residenciais e comerciais",
    popular: true,
    tint: "amber",
  },
  hidraulica: {
    icon: Droplets,
    emoji: "💧",
    examples: "Encanador, desentupimento, caixa d'água",
    tooltip: "Reparos hidráulicos e instalações de água e esgoto",
    popular: true,
    tint: "cyan",
  },
  eletricista: {
    icon: Plug,
    emoji: "⚡",
    examples: "Eletricista, instalação, troca de fiação",
    tooltip: "Instalações e reparos elétricos",
    popular: true,
    tint: "amber",
  },
  encanador: {
    icon: Droplets,
    emoji: "💧",
    examples: "Encanador, desentupimento, vazamento",
    tooltip: "Reparos hidráulicos e instalações",
    tint: "cyan",
  },
  encanamento: {
    icon: Droplets,
    emoji: "💧",
    examples: "Encanador, hidráulica, desentupimento",
    tooltip: "Reparos hidráulicos e instalações",
    tint: "cyan",
  },
  limpeza: {
    icon: Sparkles,
    emoji: "✨",
    examples: "Diarista, limpeza pesada, vidros",
    tooltip: "Limpeza residencial e comercial",
    popular: true,
    tint: "teal",
  },
  reforma: {
    icon: Hammer,
    emoji: "🏗️",
    examples: "Pedreiro, carpinteiro, azulejista",
    tooltip: "Obras e reformas completas",
    popular: true,
    tint: "amber",
  },
  pintura: {
    icon: PaintRoller,
    emoji: "🎨",
    examples: "Pintor, decorador, textura",
    tooltip: "Pintura interna, externa e decorativa",
    popular: true,
    tint: "rose",
  },
  jardinagem: {
    icon: Leaf,
    emoji: "🌿",
    examples: "Jardineiro, paisagista, poda",
    tooltip: "Jardins, paisagismo e manutenção de áreas verdes",
    tint: "emerald",
  },
  transporte: {
    icon: Truck,
    emoji: "🚚",
    examples: "Mudança, frete, carreto",
    tooltip: "Transporte, mudanças e fretes",
    tint: "teal",
  },
  beleza: {
    icon: Scissors,
    emoji: "💇",
    examples: "Cabelo, manicure, maquiagem",
    tooltip: "Beleza, estética e bem-estar",
    popular: true,
    tint: "rose",
  },
  tecnologia: {
    icon: Laptop,
    emoji: "💻",
    examples: "Montagem, suporte, redes",
    tooltip: "Suporte técnico, informática e tecnologia",
    tint: "cyan",
  },
  fotografia: {
    icon: Camera,
    emoji: "📷",
    examples: "Ensaio, evento, edição",
    tooltip: "Fotografia e filmagem profissional",
    tint: "violet",
  },
  gastronomia: {
    icon: Utensils,
    emoji: "🍳",
    examples: "Cozinheiro, buffet, chef",
    tooltip: "Gastronomia e serviços de buffet",
    tint: "amber",
  },
  compras: {
    icon: ShoppingCart,
    emoji: "🛒",
    examples: "Entregas, compras, mandados",
    tooltip: "Serviços de compras e entregas",
    tint: "teal",
  },
  pets: {
    icon: PawPrint,
    emoji: "🐾",
    examples: "Veterinário, banho, passeio",
    tooltip: "Cuidados e serviços para pets",
    tint: "amber",
  },
  educacao: {
    icon: GraduationCap,
    emoji: "📚",
    examples: "Aula, reforço, idiomas",
    tooltip: "Aulas e serviços educacionais",
    tint: "violet",
  },
  fitness: {
    icon: Dumbbell,
    emoji: "💪",
    examples: "Personal, treino, consultoria",
    tooltip: "Treinos e acompanhamento fitness",
    tint: "emerald",
  },
  eventos: {
    icon: PartyPopper,
    emoji: "🎉",
    examples: "Festa, decorador, som",
    tooltip: "Organização de eventos e festas",
    tint: "rose",
  },
  saude: {
    icon: HeartPulse,
    emoji: "❤️",
    examples: "Fisioterapeuta, massagem, consultas",
    tooltip: "Saúde e bem-estar",
    tint: "rose",
  },
}

function resolveMeta(c: Category) {
  if (c.slug && CATEGORY_META[c.slug]) return CATEGORY_META[c.slug]!
  if (c.icon && CATEGORY_META[c.icon]) return CATEGORY_META[c.icon]!
  // Best-effort slug substring match
  for (const [slug, meta] of Object.entries(CATEGORY_META)) {
    if (c.slug.includes(slug) || c.name.toLowerCase().includes(slug)) {
      return meta
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Simulated provider count per category (deterministic hash)
// In production, this would come from the API
// ---------------------------------------------------------------------------

function getProviderCount(categoryId: string): number {
  let hash = 0
  for (let i = 0; i < categoryId.length; i++) {
    hash = (hash * 31 + categoryId.charCodeAt(i)) | 0
  }
  return (Math.abs(hash) % 45) + 3 // 3–47 range
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type CategoryShowcaseProps = {
  categories: Category[]
  activeId?: string | null
  onSelect?: (id: string | null) => void
  isLoading?: boolean
  className?: string
}

// ---------------------------------------------------------------------------
// Staggered entrance animation variants
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.04,
    },
  },
}

const cardVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: "easeOut" as const },
  },
}

const chipVariants = {
  hidden: { opacity: 0, scale: 0.85 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.3, ease: "easeOut" as const },
  },
}

// ---------------------------------------------------------------------------
// Decorative dot pattern for section header
// ---------------------------------------------------------------------------

function DecorativeDots() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -top-4 right-0 hidden lg:block"
    >
      <svg width="120" height="80" fill="none" className="opacity-[0.07] dark:opacity-[0.05]">
        {Array.from({ length: 24 }).map((_, i) => (
          <circle
            key={i}
            cx={12 + (i % 6) * 20}
            cy={12 + Math.floor(i / 6) * 20}
            r="3"
            fill="currentColor"
            className="text-emerald-600 dark:text-emerald-400"
          />
        ))}
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function CategoryShowcase({
  categories,
  activeId,
  onSelect,
  isLoading,
  className,
}: CategoryShowcaseProps) {
  const { ref, visible } = useScrollReveal<HTMLDivElement>()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const popularRef = React.useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = React.useState(false)
  const [canScrollRight, setCanScrollRight] = React.useState(false)
  const [showAll, setShowAll] = React.useState(false)
  const [focusIndex, setFocusIndex] = React.useState(-1)

  const POPULAR_LIMIT = 8
  const GRID_LIMIT = 12
  const popularCategories = categories.filter((c) => {
    const meta = resolveMeta(c)
    return meta?.popular
  }).slice(0, POPULAR_LIMIT)

  const visibleCategories = showAll
    ? categories
    : categories.slice(0, GRID_LIMIT)

  const { ref: countRef, value: countValue } = useCountUp(categories.length, {
    duration: 1200,
  })

  // Active category info
  const activeCategory = categories.find((c) => c.id === activeId)

  // Update scroll arrow visibility
  const updateScrollButtons = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 8)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8)
  }, [])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateScrollButtons()
    el.addEventListener("scroll", updateScrollButtons, { passive: true })
    window.addEventListener("resize", updateScrollButtons)
    return () => {
      el.removeEventListener("scroll", updateScrollButtons)
      window.removeEventListener("resize", updateScrollButtons)
    }
  }, [updateScrollButtons, categories, showAll])

  // Keyboard navigation for scroll
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        scrollRef.current?.scrollBy({ left: 200, behavior: "smooth" })
      } else if (e.key === "ArrowLeft") {
        scrollRef.current?.scrollBy({ left: -200, behavior: "smooth" })
      }
    },
    [],
  )

  // Grid keyboard navigation
  const handleGridKeyDown = React.useCallback(
    (e: React.KeyboardEvent, idx: number) => {
      const cols = typeof window !== "undefined" && window.innerWidth >= 1024 ? 6 : window.innerWidth >= 768 ? 4 : window.innerWidth >= 640 ? 3 : 2
      let nextIdx = idx
      if (e.key === "ArrowRight") nextIdx = idx + 1
      else if (e.key === "ArrowLeft") nextIdx = idx - 1
      else if (e.key === "ArrowDown") nextIdx = idx + cols
      else if (e.key === "ArrowUp") nextIdx = idx - cols
      else return

      e.preventDefault()
      if (nextIdx >= 0 && nextIdx < visibleCategories.length) {
        setFocusIndex(nextIdx)
        const el = document.getElementById(`cat-card-${visibleCategories[nextIdx]?.id}`)
        el?.focus()
      }
    },
    [visibleCategories],
  )

  const scrollBy = (direction: "left" | "right") => {
    scrollRef.current?.scrollBy({
      left: direction === "left" ? -260 : 260,
      behavior: "smooth",
    })
  }

  const scrollPopularBy = (direction: "left" | "right") => {
    popularRef.current?.scrollBy({
      left: direction === "left" ? -300 : 300,
      behavior: "smooth",
    })
  }

  return (
    <section
      aria-label="Categorias de serviços"
      className={cn(
        "relative w-full",
        "bg-gradient-to-b from-white to-slate-50/80 dark:from-background dark:to-background",
        className,
      )}
    >
      <div
        ref={ref}
        className="relative mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20"
      >
        <DecorativeDots />

        {/* ── Header ────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={visible ? { opacity: 1, scale: 1 } : {}}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50"
            >
              <Search className="size-3.5" />
              Explore categorias
            </motion.span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
              Encontre o serviço ideal
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
              Serviços verificados perto de você —{" "}
              <span ref={countRef} className="font-semibold text-emerald-600 dark:text-emerald-400">
                {isLoading ? "…" : countValue}
              </span>{" "}
              {isLoading ? "carregando categorias" : "categorias disponíveis"}
            </p>
          </div>

          {/* Active filter indicator + clear button (H1 + H3) */}
          <AnimatePresence>
            {activeId && activeCategory && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -4 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                className="flex items-center gap-2.5"
              >
                <div className="relative">
                  <Badge
                    variant="secondary"
                    className="gap-1.5 rounded-full bg-emerald-50 pl-3 pr-1.5 py-1 text-sm text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50"
                  >
                    {resolveMeta(activeCategory)?.emoji ?? ""}{" "}
                    {activeCategory.name}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 rounded-full hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                      onClick={() => onSelect?.(null)}
                      aria-label="Remover filtro de categoria"
                    >
                      <X className="size-3" />
                    </Button>
                  </Badge>
                  {/* Animated pulse ring (H1) */}
                  <span
                    aria-hidden
                    className="absolute -inset-1 animate-pulse rounded-full ring-2 ring-emerald-400/40 dark:ring-emerald-500/25"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 rounded-full text-xs text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-300"
                  onClick={() => onSelect?.(null)}
                  aria-label="Limpar todos os filtros"
                >
                  <RefreshCw className="size-3" />
                  Limpar filtros
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ── Loading state (H1 + H5) ─────────────────────────────── */}
        {isLoading ? (
          <div aria-busy aria-label="Carregando categorias">
            {/* Popular skeleton */}
            <div className="mb-6">
              <Skeleton className="mb-3 h-5 w-40" />
              <div className="flex gap-2 overflow-hidden">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="h-9 w-28 shrink-0 rounded-full"
                  />
                ))}
              </div>
            </div>
            {/* Grid skeleton */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-5"
                >
                  <Skeleton className="size-14 rounded-xl" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3 w-14 rounded-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          </div>
        ) : categories.length === 0 ? (
          /* ── Empty state (H5 + H9) ──────────────────────────────── */
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed py-20 text-center">
            <div className="flex size-20 items-center justify-center rounded-2xl bg-muted">
              <Search className="size-9 text-muted-foreground" />
            </div>
            <div>
              <p className="text-lg font-semibold">
                Nenhuma categoria disponível
              </p>
              <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
                As categorias aparecerão aqui assim que estiverem disponíveis.
                Tente recarregar a página.
              </p>
            </div>
            <Button
              variant="outline"
              size="default"
              className="gap-2 rounded-xl"
              onClick={() => window.location.reload()}
              aria-label="Tentar carregar categorias novamente"
            >
              <RefreshCw className="size-4" />
              Tentar novamente
            </Button>
          </div>
        ) : (
          <>
            {/* ── Popular categories quick-access bar (H7) ─────────── */}
            {popularCategories.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={visible ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.4, delay: 0.15 }}
                className="mb-8"
              >
                <div className="mb-3 flex items-center gap-2">
                  <TrendingUp className="size-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm font-medium text-muted-foreground">
                    Mais buscadas
                  </span>
                </div>

                {/* Desktop: horizontal scroll with arrows */}
                <div className="relative hidden sm:block">
                  {canScrollLeft && (
                    <button
                      aria-label="Rolar categorias populares à esquerda"
                      onClick={() => scrollPopularBy("left")}
                      className="absolute -left-3 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border bg-card shadow-lg transition-all hover:bg-emerald-50 hover:shadow-xl dark:hover:bg-emerald-950/40"
                    >
                      <ChevronLeft className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                    </button>
                  )}
                  <ScrollArea className="w-full" type="scroll">
                    <div
                      ref={popularRef}
                      className="flex gap-2 pb-1"
                    >
                      {popularCategories.map((c, idx) => (
                        <PopularChip
                          key={c.id}
                          category={c}
                          active={activeId === c.id}
                          index={idx}
                          visible={visible}
                          onSelect={() =>
                            onSelect?.(activeId === c.id ? null : c.id)
                          }
                        />
                      ))}
                    </div>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                </div>

                {/* Mobile: compact chip row */}
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin sm:hidden">
                  {popularCategories.map((c, idx) => (
                    <PopularChip
                      key={c.id}
                      category={c}
                      active={activeId === c.id}
                      index={idx}
                      visible={visible}
                      onSelect={() =>
                        onSelect?.(activeId === c.id ? null : c.id)
                      }
                    />
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── Category grid ──────────────────────────────────────── */}
            <div
              className="relative"
              role="group"
              aria-roledescription="grade de categorias"
              onKeyDown={handleKeyDown}
            >
              {/* Scroll arrows — desktop only (H7) */}
              {canScrollLeft && (
                <button
                  aria-label="Rolar categorias à esquerda"
                  onClick={() => scrollBy("left")}
                  className="absolute -left-3 top-1/2 z-10 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border bg-card shadow-lg transition-all hover:bg-emerald-50 hover:shadow-xl lg:flex dark:hover:bg-emerald-950/40"
                >
                  <ChevronLeft className="size-4 text-emerald-600 dark:text-emerald-400" />
                </button>
              )}
              {canScrollRight && (
                <button
                  aria-label="Rolar categorias à direita"
                  onClick={() => scrollBy("right")}
                  className="absolute -right-3 top-1/2 z-10 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border bg-card shadow-lg transition-all hover:bg-emerald-50 hover:shadow-xl lg:flex dark:hover:bg-emerald-950/40"
                >
                  <ChevronRight className="size-4 text-emerald-600 dark:text-emerald-400" />
                </button>
              )}

              {/* Mobile: horizontal scroll chips */}
              <div
                ref={scrollRef}
                className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin sm:hidden"
              >
                {categories.map((c, idx) => (
                  <MobileCategoryChip
                    key={c.id}
                    category={c}
                    active={activeId === c.id}
                    visible={visible}
                    index={idx}
                    onSelect={() =>
                      onSelect?.(activeId === c.id ? null : c.id)
                    }
                  />
                ))}
              </div>

              {/* Desktop: grid layout */}
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate={visible ? "visible" : "hidden"}
                className="hidden sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 sm:gap-4"
              >
                {visibleCategories.map((c, idx) => (
                  <CategoryCard
                    key={c.id}
                    id={`cat-card-${c.id}`}
                    category={c}
                    active={activeId === c.id}
                    index={idx}
                    onSelect={() =>
                      onSelect?.(activeId === c.id ? null : c.id)
                    }
                    onKeyDown={(e) => handleGridKeyDown(e, idx)}
                  />
                ))}
              </motion.div>

              {/* "Ver todas" expand button (H3 + H7) */}
              {categories.length > GRID_LIMIT && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={visible ? { opacity: 1 } : {}}
                  transition={{ delay: 0.3 }}
                  className="mt-6 flex justify-center"
                >
                  <Button
                    variant="outline"
                    size="default"
                    className="gap-2 rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800/50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                    onClick={() => setShowAll((prev) => !prev)}
                    aria-label={
                      showAll
                        ? "Ver menos categorias"
                        : "Ver todas as categorias"
                    }
                  >
                    {showAll ? (
                      <>
                        Ver menos
                        <ChevronUp className="size-4" />
                      </>
                    ) : (
                      <>
                        Ver todas as categorias ({categories.length})
                        <ChevronDown className="size-4" />
                      </>
                    )}
                  </Button>
                </motion.div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// PopularChip — compact pill for the quick-access bar
// ---------------------------------------------------------------------------

function PopularChip({
  category,
  active,
  index,
  visible,
  onSelect,
}: {
  category: Category
  active: boolean
  index: number
  visible: boolean
  onSelect: () => void
}) {
  const meta = resolveMeta(category)
  const Icon = meta?.icon ?? FALLBACK_ICON
  const emoji = meta?.emoji ?? "🔹"
  const tintKey = meta?.tint ?? "emerald"
  const tint = TINTS[tintKey] ?? TINTS.emerald

  return (
    <motion.button
      variants={chipVariants}
      initial="hidden"
      animate={visible ? "visible" : "hidden"}
      custom={index}
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={
        active
          ? `${category.name} (selecionada) — clique para desselecionar`
          : `${category.name} — buscar prestadores`
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
        active
          ? `${tint.bgActive} ${tint.darkBgActive} ${tint.ring} ${tint.darkRing} ring-2 border-transparent shadow-sm`
          : `bg-card border-border/60 ${tint.hoverBorder} hover:shadow-sm dark:hover:border-opacity-60`,
        active ? `${tint.text} ${tint.darkText}` : "text-foreground",
      )}
    >
      <span className="text-base leading-none" aria-hidden>
        {emoji}
      </span>
      <Icon className="size-3.5" />
      <span>{category.name}</span>
      {active && (
        <span
          className={cn(
            "flex size-4 items-center justify-center rounded-full",
            `bg-gradient-to-br ${tint.gradientActiveFrom} ${tint.gradientActiveTo} text-white`,
          )}
        >
          <Check className="size-2.5" />
        </span>
      )}
    </motion.button>
  )
}

// ---------------------------------------------------------------------------
// MobileCategoryChip — compact chip for mobile horizontal scroll
// ---------------------------------------------------------------------------

function MobileCategoryChip({
  category,
  active,
  visible,
  index,
  onSelect,
}: {
  category: Category
  active: boolean
  visible: boolean
  index: number
  onSelect: () => void
}) {
  const meta = resolveMeta(category)
  const Icon = meta?.icon ?? FALLBACK_ICON
  const emoji = meta?.emoji ?? "🔹"
  const tooltip = meta?.tooltip ?? category.name
  const tintKey = meta?.tint ?? "emerald"
  const tint = TINTS[tintKey] ?? TINTS.emerald
  const providerCount = getProviderCount(category.id)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          initial={{ opacity: 0, scale: 0.85 }}
          animate={visible ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.3, delay: index * 0.03 }}
          type="button"
          onClick={onSelect}
          aria-pressed={active}
          aria-label={
            active
              ? `${category.name} (selecionada) — clique para desselecionar`
              : `${category.name} — ${providerCount} prestadores`
          }
          className={cn(
            "relative flex min-w-[110px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border px-3 py-3.5 text-center transition-all duration-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
            active
              ? `${tint.bgActive} ${tint.darkBgActive} ${tint.ring} ${tint.darkRing} ring-2 border-transparent shadow-md`
              : "bg-card border-border/60 hover:border-emerald-300 dark:hover:border-emerald-700 hover:shadow-sm",
          )}
        >
          {/* Active checkmark badge */}
          {active && (
            <span
              className={cn(
                "absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full shadow-md",
                `bg-gradient-to-br ${tint.gradientActiveFrom} ${tint.gradientActiveTo} text-white`,
              )}
              aria-hidden
            >
              <Check className="size-3" />
            </span>
          )}

          {/* Icon */}
          <span
            className={cn(
              "relative flex size-10 items-center justify-center rounded-xl transition-all duration-200",
              active
                ? `bg-gradient-to-br ${tint.gradientActiveFrom} ${tint.gradientActiveTo} ${tint.darkGradientFrom} ${tint.darkGradientTo} text-white shadow-sm`
                : `bg-gradient-to-br ${tint.gradientFrom} ${tint.gradientTo} ${tint.darkGradientFrom} ${tint.darkGradientTo} ${tint.text} ${tint.darkText}`,
            )}
          >
            <Icon className="size-4.5" />
            <span
              className="absolute -top-1 -right-1 text-xs leading-none"
              aria-hidden
            >
              {emoji}
            </span>
          </span>

          {/* Category name */}
          <span className="text-xs font-medium leading-tight">
            {category.name}
          </span>

          {/* Provider count */}
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none",
              active
                ? `${tint.bg} ${tint.text} ${tint.darkBg} ${tint.darkText}`
                : "bg-muted text-muted-foreground",
            )}
          >
            {providerCount} prest.
          </span>
        </motion.button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="max-w-[200px] text-center text-xs"
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// CategoryCard — the main card for the desktop grid
// ---------------------------------------------------------------------------

function CategoryCard({
  id,
  category,
  active,
  index,
  onSelect,
  onKeyDown,
}: {
  id: string
  category: Category
  active: boolean
  index: number
  onSelect: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  const meta = resolveMeta(category)
  const Icon = meta?.icon ?? FALLBACK_ICON
  const emoji = meta?.emoji ?? "🔹"
  const examples = meta?.examples ?? ""
  const tooltip = meta?.tooltip ?? category.name
  const tintKey = meta?.tint ?? "emerald"
  const tint = TINTS[tintKey] ?? TINTS.emerald
  const providerCount = getProviderCount(category.id)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.div
          variants={cardVariants}
          id={id}
          role="button"
          tabIndex={0}
          onClick={onSelect}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onSelect()
            } else {
              onKeyDown(e)
            }
          }}
          aria-pressed={active}
          aria-label={
            active
              ? `${category.name} (selecionada) — clique para desselecionar`
              : `${category.name} — ${providerCount} prestadores`
          }
          className={cn(
            "group relative flex flex-col items-center gap-3 rounded-2xl border bg-card p-5 text-center transition-all duration-200 cursor-pointer select-none",
            "hover:-translate-y-1 hover:shadow-lg",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
            active
              ? `${tint.ring} ${tint.darkRing} ring-2 ${tint.bgActive} ${tint.darkBgActive} border-transparent shadow-lg -translate-y-1`
              : `border-border/50 ${tint.hoverBorder} dark:hover:border-opacity-60`,
          )}
        >
          {/* Active checkmark badge (H3 + H6) */}
          <AnimatePresence>
            {active && (
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 25 }}
                className={cn(
                  "absolute -top-2 -right-2 z-10 flex size-6 items-center justify-center rounded-full shadow-lg",
                  `bg-gradient-to-br ${tint.gradientActiveFrom} ${tint.gradientActiveTo} text-white`,
                )}
                aria-hidden
              >
                <Check className="size-3.5" strokeWidth={3} />
              </motion.span>
            )}
          </AnimatePresence>

          {/* Icon with large gradient background (H6) */}
          <span
            className={cn(
              "relative flex size-14 items-center justify-center rounded-xl transition-all duration-300 group-hover:scale-110",
              active
                ? `bg-gradient-to-br ${tint.gradientActiveFrom} ${tint.gradientActiveTo} ${tint.darkGradientFrom} ${tint.darkGradientTo} text-white shadow-md`
                : `bg-gradient-to-br ${tint.gradientFrom} ${tint.gradientTo} ${tint.darkGradientFrom} ${tint.darkGradientTo} ${tint.text} ${tint.darkText}`,
            )}
          >
            <Icon className="size-6" />
            <span
              className="absolute -top-1.5 -right-1.5 text-sm leading-none"
              aria-hidden
            >
              {emoji}
            </span>
          </span>

          {/* Category name */}
          <span className="text-sm font-semibold leading-tight">
            {category.name}
          </span>

          {/* Provider count pill (H2 + H6) */}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium leading-none transition-colors",
              active
                ? `${tint.bg} ${tint.text} ${tint.darkBg} ${tint.darkText}`
                : "bg-muted text-muted-foreground",
            )}
          >
            {providerCount} prestadores
          </span>

          {/* Service examples (H2 + H6) */}
          {examples && (
            <span className="mt-0.5 text-[10px] leading-snug text-muted-foreground/80 line-clamp-2 min-h-[2.5em]">
              {examples}
            </span>
          )}

          {/* Info badge (H10) */}
          <span
            className={cn(
              "absolute top-2.5 left-2.5 flex size-4 items-center justify-center rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-60",
              active ? "opacity-40" : "",
              "text-muted-foreground",
            )}
            aria-hidden
          >
            <Info className="size-3" />
          </span>
        </motion.div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="max-w-[220px] text-center text-xs"
      >
        <span className="font-medium">{category.name}</span>
        <br />
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
