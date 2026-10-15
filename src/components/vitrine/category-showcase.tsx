"use client"

/**
 * CategoryShowcase — Modern 2-Tier Category Selector for the Severinno Marketplace.
 *
 * Implements the official 7-pillar taxonomy:
 *   1. Reforma e Construção
 *   2. Reparos e Instalações
 *   3. Acabamento e Decoração
 *   4. Limpeza e Casa
 *   5. Jardim e Piscina
 *   6. Mudança e Organização
 *   7. Emergência 24h (Card/Pill com destaque visual de alerta e acesso imediato)
 *
 * Features:
 *   - Tier 1: 7 Macro-Domains with slogans, icons, and emergency alert styling
 *   - Tier 2: Dynamic subcategory drawer/strip when a root with children is active
 *   - Full keyboard navigation and accessible ARIA attributes
 */

import * as React from "react"
import {
  Wrench,
  Sparkles,
  Hammer,
  HardHat,
  PaintRoller,
  Trees,
  Truck,
  Siren,
  Plug,
  Droplets,
  Scissors,
  Laptop,
  Camera,
  Utensils,
  PawPrint,
  GraduationCap,
  Dumbbell,
  HeartPulse,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  X,
  Flame,
  Fan,
  Shield,
  Palette,
  Box,
  DoorClosed,
  Armchair,
  Leaf,
  Waves,
  Ruler,
  BrickWall,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { Category } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"

export type CategoryShowcaseProps = {
  categories: Category[]
  activeId: string | null
  onSelect: (id: string | null) => void
  isLoading?: boolean
  className?: string
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  // 7 Macro-Pilares
  "reforma-e-construcao": HardHat,
  "reparos-e-instalacoes": Wrench,
  "acabamento-e-decoracao": PaintRoller,
  "limpeza-e-casa": Sparkles,
  "jardim-e-piscina": Trees,
  "mudanca-e-organizacao": Truck,
  "emergencia-24h": Siren,

  // Subcategorias e itens
  eletrica: Plug,
  eletricista: Plug,
  hidraulica: Droplets,
  encanador: Droplets,
  pintura: PaintRoller,
  reforma: Hammer,
  obra: BrickWall,
  projetos: Ruler,
  limpeza: Sparkles,
  diarista: Sparkles,
  jardim: Leaf,
  jardinagem: Leaf,
  piscina: Waves,
  mudanca: Truck,
  frete: Truck,
  clima: Fan,
  gas: Flame,
  tecnologia: Laptop,
  acesso: Shield,
  marcenaria: DoorClosed,
  vidro: Box,
  estofados: Armchair,
  decoracao: Palette,
  beleza: Scissors,
  fotografia: Camera,
  gastronomia: Utensils,
  pets: PawPrint,
  aulas: GraduationCap,
  fitness: Dumbbell,
  saude: HeartPulse,
}

const CATEGORY_COUNTS: Record<string, number> = {
  "reforma-e-construcao": 34,
  "reparos-e-instalacoes": 48,
  "acabamento-e-decoracao": 29,
  "limpeza-e-casa": 37,
  "jardim-e-piscina": 19,
  "mudanca-e-organizacao": 16,
  "emergencia-24h": 14,
}

export function getCategoryCount(cat: Category): number {
  const slugKey = (cat.slug || "").toLowerCase()
  for (const [k, v] of Object.entries(CATEGORY_COUNTS)) {
    if (slugKey.includes(k)) return v
  }
  if (cat.children && cat.children.length > 0) {
    return cat.children.length * 6
  }
  return 12
}

export function getCategoryIcon(slug?: string, name?: string): LucideIcon {
  const key = (slug || name || "").toLowerCase()
  for (const [k, icon] of Object.entries(CATEGORY_ICONS)) {
    if (key.includes(k)) return icon
  }
  return Wrench
}

export default function CategoryShowcase({
  categories,
  activeId,
  onSelect,
  isLoading = false,
  className,
}: CategoryShowcaseProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const subScrollRef = React.useRef<HTMLDivElement>(null)

  const handleScroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return
    const delta = direction === "left" ? -280 : 280
    scrollRef.current.scrollBy({ left: delta, behavior: "smooth" })
  }

  // Identificar se a categoria ativa é raiz ou filha
  const activeRoot = React.useMemo(() => {
    if (!activeId) return null
    for (const cat of categories) {
      if (cat.id === activeId) return cat
      if (
        cat.children?.some(
          (ch) => ch.id === activeId || ch.children?.some((g) => g.id === activeId),
        )
      ) {
        return cat
      }
    }
    return null
  }, [categories, activeId])

  if (isLoading) {
    return (
      <section className={cn("border-border/40 bg-background/50 border-b py-3", className)}>
        <div className="mx-auto flex w-full max-w-[95%] items-center gap-2 overflow-hidden px-2 sm:px-4">
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-9 w-32 rounded-full" />
          <Skeleton className="h-9 w-36 rounded-full" />
          <Skeleton className="h-9 w-32 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-36 rounded-full" />
          <Skeleton className="h-9 w-32 rounded-full" />
        </div>
      </section>
    )
  }

  if (!categories || categories.length === 0) {
    return null
  }

  return (
    <section
      className={cn(
        "border-border/40 bg-background/85 sticky top-16 z-20 border-b shadow-xs backdrop-blur-md transition-all",
        className,
      )}
      aria-label="Filtrar por categoria"
    >
      <div className="mx-auto w-full max-w-[95%] px-2 sm:px-4">
        {/* ── Nível 1: Os 7 Macro-Domínios + Setas de Rolagem Desktop ──── */}
        <div className="relative flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleScroll("left")}
            aria-label="Rolar categorias para a esquerda"
            className="border-border/60 bg-card/90 text-muted-foreground hover:text-foreground hidden size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border shadow-2xs transition-colors lg:flex"
          >
            <ChevronLeft className="size-3.5" />
          </button>

          <div
            ref={scrollRef}
            tabIndex={0}
            aria-label="Macro categorias navegáveis"
            className="no-scrollbar flex flex-1 items-center gap-2 overflow-x-auto py-3 focus-visible:outline-none"
          >
            {/* Botão "Todas" */}
            <button
              type="button"
              onClick={() => onSelect(null)}
              className={cn(
                "flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 text-xs font-medium transition-all",
                activeId === null
                  ? "bg-primary text-primary-foreground font-semibold shadow-sm shadow-emerald-500/20"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <LayoutGrid className="size-3.5" />
              <span>Todas as categorias</span>
            </button>

            {/* Os 7 Pilares Oficiais */}
            {categories.map((cat) => {
              const Icon = getCategoryIcon(cat.slug, cat.name)
              const count = getCategoryCount(cat)
              const isEmergency = cat.slug.includes("emergencia") || cat.name.includes("Emergência")
              const isRootActive = activeRoot?.id === cat.id
              const isExactActive = activeId === cat.id

              if (isEmergency) {
                return (
                  <button
                    key={cat.id}
                    type="button"
                    title={cat.slug}
                    onClick={() => onSelect(isExactActive ? null : cat.id)}
                    className={cn(
                      "relative flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-4 text-xs font-semibold transition-all",
                      isExactActive
                        ? "border-rose-600 bg-rose-600 text-white shadow-md ring-2 shadow-rose-600/30 ring-rose-500/30"
                        : "border-rose-500/40 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-300",
                    )}
                  >
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex size-2 rounded-full bg-rose-500"></span>
                    </span>
                    <Icon className="size-3.5" />
                    <span>{cat.name}</span>
                    <span
                      className={cn(
                        "py-0.2 rounded-full px-1.5 text-[10px] font-extrabold",
                        isExactActive
                          ? "bg-white/20 text-white"
                          : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                )
              }

              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => onSelect(isExactActive ? null : cat.id)}
                  className={cn(
                    "flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-4 text-xs font-medium transition-all",
                    isRootActive
                      ? "border-primary bg-primary/10 text-primary ring-primary/20 font-semibold shadow-xs ring-1"
                      : "border-border/50 bg-card/60 text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-3.5",
                      isRootActive ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span>{cat.name}</span>
                  <span
                    className={cn(
                      "py-0.2 rounded-full px-1.5 text-[10px] font-bold",
                      isRootActive
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {activeId !== null && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              aria-label="Limpar categoria selecionada"
              className="border-border/60 bg-muted/70 text-muted-foreground hover:text-foreground inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-3 text-[11px] font-semibold transition-colors"
            >
              <X className="size-3" />
              <span className="hidden sm:inline">Limpar</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => handleScroll("right")}
            aria-label="Rolar categorias para a direita"
            className="border-border/60 bg-card/90 text-muted-foreground hover:text-foreground hidden size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border shadow-2xs transition-colors lg:flex"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>

        {/* ── Nível 2: Subcategorias Expansíveis da Categoria Ativa ────── */}
        {activeRoot && activeRoot.children && activeRoot.children.length > 0 && (
          <div className="border-border/40 animate-in fade-in slide-in-from-top-1 border-t py-2.5 transition-all duration-200">
            <div
              ref={subScrollRef}
              tabIndex={0}
              aria-label={`Subcategorias de ${activeRoot.name}`}
              className="no-scrollbar flex items-center gap-2 overflow-x-auto focus-visible:outline-none"
            >
              {/* Botão para manter filtro no macro-domínio inteiro */}
              <button
                type="button"
                onClick={() => onSelect(activeRoot.id)}
                className={cn(
                  "flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition-all",
                  activeId === activeRoot.id
                    ? "bg-foreground/10 text-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                <span>Tudo em {activeRoot.name.split(" ")[0]}</span>
              </button>

              <ChevronRight className="text-muted-foreground/40 size-3 shrink-0" />

              {/* Subcategorias filhas */}
              {activeRoot.children.map((sub) => {
                const SubIcon = getCategoryIcon(sub.slug, sub.name)
                const isSubActive = activeId === sub.id

                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => onSelect(isSubActive ? activeRoot.id : sub.id)}
                    className={cn(
                      "flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition-all",
                      isSubActive
                        ? "border-primary bg-primary text-primary-foreground shadow-xs"
                        : "border-border/60 bg-muted/40 text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <SubIcon className="size-3" />
                    <span>{sub.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
