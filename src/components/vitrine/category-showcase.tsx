"use client"

/**
 * CategoryShowcase — redesigned with Jakob Nielsen's 10 Usability Heuristics.
 *
 * Heuristics applied:
 *   H1 – Loading skeleton + category count + active filter indicator
 *   H2 – Emoji + icon combos; "Ex: encanador, eletricista" helper; provider count badge
 *   H3 – "Limpar filtros" button; re-click to deselect; X button on active card
 *   H4 – Consistent rounded-2xl cards, shadow system, emerald accent
 *   H5 – Friendly error state with retry; empty state
 *   H6 – Prominent icons; provider count pill; service examples
 *   H7 – Horizontal scroll arrows on desktop; keyboard nav; "Ver todas" expand
 *   H8 – Generous whitespace; clean cards; subtle borders; only essential info
 *   H9 – Graceful empty/error states with retry
 *  H10 – Info tooltip on hover showing what category includes
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
  X,
  Info,
  RefreshCw,
  Search,
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

// ---------------------------------------------------------------------------
// Icon + emoji mapping by slug
// ---------------------------------------------------------------------------

const FALLBACK_ICON = MoreHorizontal

const CATEGORY_META: Record<
  string,
  { icon: LucideIcon; emoji: string; examples: string; tooltip: string }
> = {
  reparos: {
    icon: Wrench,
    emoji: "🔧",
    examples: "Ex: encanador, eletricista",
    tooltip: "Consertos e manutenção residencial",
  },
  limpeza: {
    icon: Sparkles,
    emoji: "✨",
    examples: "Ex: diarista, limpeza pesada",
    tooltip: "Limpeza residencial e comercial",
  },
  reforma: {
    icon: Hammer,
    emoji: "🏗️",
    examples: "Ex: pedreiro, carpinteiro",
    tooltip: "Obras e reformas completas",
  },
  pintura: {
    icon: PaintRoller,
    emoji: "🎨",
    examples: "Ex: pintor, decorador",
    tooltip: "Pintura interna e externa",
  },
  jardinagem: {
    icon: Leaf,
    emoji: "🌿",
    examples: "Ex: jardineiro, paisagista",
    tooltip: "Jardins, paisagismo e manutenção",
  },
  transporte: {
    icon: Truck,
    emoji: "🚚",
    examples: "Ex: mudança, frete",
    tooltip: "Transporte, mudanças e fretes",
  },
  eletricista: {
    icon: Plug,
    emoji: "⚡",
    examples: "Ex: eletricista, instalação",
    tooltip: "Instalações e reparos elétricos",
  },
  encanador: {
    icon: Droplets,
    emoji: "💧",
    examples: "Ex: encanador, hidráulica",
    tooltip: "Reparos hidráulicos e instalações",
  },
  encanamento: {
    icon: Droplets,
    emoji: "💧",
    examples: "Ex: encanador, hidráulica",
    tooltip: "Reparos hidráulicos e instalações",
  },
  beleza: {
    icon: Scissors,
    emoji: "💇",
    examples: "Ex: cabelo, manicure",
    tooltip: "Beleza, estética e bem-estar",
  },
  tecnologia: {
    icon: Laptop,
    emoji: "💻",
    examples: "Ex: montagem, suporte",
    tooltip: "Suporte técnico e tecnologia",
  },
  fotografia: {
    icon: Camera,
    emoji: "📷",
    examples: "Ex: ensaio, evento",
    tooltip: "Fotografia e filmagem profissional",
  },
  gastronomia: {
    icon: Utensils,
    emoji: "🍳",
    examples: "Ex: cozinheiro, buffet",
    tooltip: "Gastronomia e serviços de buffet",
  },
  compras: {
    icon: ShoppingCart,
    emoji: "🛒",
    examples: "Ex: entregas, compras",
    tooltip: "Serviços de compras e entregas",
  },
  pets: {
    icon: PawPrint,
    emoji: "🐾",
    examples: "Ex: veterinário, banho",
    tooltip: "Cuidados e serviços para pets",
  },
  educacao: {
    icon: GraduationCap,
    emoji: "📚",
    examples: "Ex: aula, reforço",
    tooltip: "Aulas e serviços educacionais",
  },
  fitness: {
    icon: Dumbbell,
    emoji: "💪",
    examples: "Ex: personal, treino",
    tooltip: "Treinos e acompanhamento fitness",
  },
  eventos: {
    icon: PartyPopper,
    emoji: "🎉",
    examples: "Ex: festa, decorador",
    tooltip: "Organização de eventos e festas",
  },
  saude: {
    icon: HeartPulse,
    emoji: "❤️",
    examples: "Ex: fisioterapeuta, massagem",
    tooltip: "Saúde e bem-estar",
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
// Simulated provider count per category (random but deterministic)
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
// Component
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
  const [canScrollLeft, setCanScrollLeft] = React.useState(false)
  const [canScrollRight, setCanScrollRight] = React.useState(false)
  const [showAll, setShowAll] = React.useState(false)

  const visibleCategories = showAll
    ? categories
    : categories.slice(0, 12)

  const { ref: countRef, value: countValue } = useCountUp(categories.length, {
    duration: 1200,
  })

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

  const scrollBy = (direction: "left" | "right") => {
    scrollRef.current?.scrollBy({
      left: direction === "left" ? -260 : 260,
      behavior: "smooth",
    })
  }

  return (
    <section
      aria-label="Categorias de serviços"
      className={cn(
        "relative w-full",
        "bg-gradient-to-b from-white to-slate-50 dark:from-background dark:to-background",
        className,
      )}
    >
      <div
        ref={ref}
        className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8"
      >
        {/* ── Header ────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={visible ? { opacity: 1, scale: 1 } : {}}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50"
            >
              <Search className="size-3.5" />
              Explore categorias
            </motion.span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              Encontre o serviço ideal
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Serviços verificados perto de você —{" "}
              <span ref={countRef} className="font-semibold text-emerald-600 dark:text-emerald-400">
                {countValue}
              </span>{" "}
              categorias disponíveis
            </p>
          </div>

          {/* Active filter indicator + clear button (H3) */}
          <AnimatePresence>
            {activeId && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -4 }}
                className="flex items-center gap-2"
              >
                <div className="relative">
                  <Badge
                    variant="secondary"
                    className="gap-1.5 rounded-full bg-emerald-50 pl-3 pr-1.5 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50"
                  >
                    {categories.find((c) => c.id === activeId)?.name ?? "Categoria"}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 rounded-full hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                      onClick={() => onSelect?.(null)}
                      aria-label="Limpar filtro de categoria"
                    >
                      <X className="size-3" />
                    </Button>
                  </Badge>
                  {/* Animated ring indicator (H1) */}
                  <span
                    aria-hidden
                    className="absolute -inset-0.5 animate-pulse rounded-full ring-2 ring-emerald-400/50 dark:ring-emerald-500/30"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 rounded-full text-xs text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-300"
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
            <div className="mb-3 flex items-center gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-6 rounded-full" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-5"
                >
                  <Skeleton className="size-12 rounded-xl" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          </div>
        ) : categories.length === 0 ? (
          /* ── Empty state (H5 + H9) ──────────────────────────────── */
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed py-16 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted">
              <Search className="size-7 text-muted-foreground" />
            </div>
            <div>
              <p className="text-base font-medium">Nenhuma categoria disponível</p>
              <p className="mt-1 text-sm text-muted-foreground">
                As categorias aparecerão aqui assim que estiverem disponíveis.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 rounded-xl"
              onClick={() => window.location.reload()}
              aria-label="Tentar carregar categorias novamente"
            >
              <RefreshCw className="size-3.5" />
              Tentar novamente
            </Button>
          </div>
        ) : (
          /* ── Category grid ────────────────────────────────────────── */
          <div
            className="relative"
            role="group"
            aria-roledescription="carrossel de categorias"
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

            {/* Scrollable area on mobile, grid on sm+ */}
            <div
              ref={scrollRef}
              className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin sm:hidden"
            >
              {categories.map((c, idx) => (
                <CategoryCard
                  key={c.id}
                  category={c}
                  active={activeId === c.id}
                  visible={visible}
                  index={idx}
                  onSelect={() => onSelect?.(activeId === c.id ? null : c.id)}
                />
              ))}
            </div>

            {/* Grid on sm+ */}
            <div className="hidden sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 sm:gap-3">
              {visibleCategories.map((c, idx) => (
                <CategoryCard
                  key={c.id}
                  category={c}
                  active={activeId === c.id}
                  visible={visible}
                  index={idx}
                  onSelect={() => onSelect?.(activeId === c.id ? null : c.id)}
                />
              ))}
            </div>

            {/* "Ver todas" expand button (H7) */}
            {categories.length > 12 && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 rounded-xl text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                  onClick={() => setShowAll((prev) => !prev)}
                  aria-label={showAll ? "Ver menos categorias" : "Ver todas as categorias"}
                >
                  {showAll ? (
                    <>
                      Ver menos
                      <ChevronLeft className="size-3.5" />
                    </>
                  ) : (
                    <>
                      Ver todas ({categories.length})
                      <ChevronRight className="size-3.5" />
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// CategoryCard
// ---------------------------------------------------------------------------

function CategoryCard({
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
  const examples = meta?.examples ?? ""
  const tooltip = meta?.tooltip ?? category.name
  const providerCount = getProviderCount(category.id)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={visible ? { opacity: 1, y: 0, scale: 1 } : {}}
          transition={{ duration: 0.4, delay: index * 0.04 }}
          type="button"
          onClick={onSelect}
          aria-pressed={active}
          aria-label={
            active
              ? `${category.name} (selecionada) — clique para desselecionar`
              : `${category.name} — ${providerCount} prestadores`
          }
          className={cn(
            "group relative flex min-w-[140px] flex-col items-center gap-2 rounded-2xl border bg-card p-4 text-center transition-all duration-200 sm:min-w-0",
            "hover:-translate-y-1 hover:border-emerald-300 hover:shadow-lg",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
            "dark:hover:border-emerald-700",
            active &&
              "ring-2 ring-emerald-500 bg-emerald-50/50 border-emerald-300 scale-[1.02] shadow-lg dark:bg-emerald-950/30 dark:border-emerald-700 dark:ring-emerald-600",
            !active && "border-border/60",
          )}
        >
          {/* Active X button (H3) */}
          {active && (
            <span
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md"
              aria-hidden
            >
              <X className="size-3" />
            </span>
          )}

          {/* Icon with gradient background */}
          <span
            className={cn(
              "relative flex size-12 items-center justify-center rounded-xl transition-all duration-200 group-hover:scale-110",
              active
                ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/20"
                : "bg-gradient-to-br from-emerald-50 to-teal-50 text-emerald-600 dark:from-emerald-950/60 dark:to-teal-950/60 dark:text-emerald-400",
            )}
          >
            <Icon className="size-5" />
            <span
              className="absolute -top-1 -right-1 text-sm leading-none"
              aria-hidden
            >
              {emoji}
            </span>
          </span>

          {/* Category name */}
          <span className="text-sm font-medium leading-tight">
            {category.name}
          </span>

          {/* Provider count pill (H2 + H6) */}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-none",
              active
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            {providerCount} prestadores
          </span>

          {/* Service examples (H2 + H6) */}
          {examples && (
            <span className="mt-0.5 text-[10px] leading-snug text-muted-foreground/80 line-clamp-1">
              {examples}
            </span>
          )}
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
