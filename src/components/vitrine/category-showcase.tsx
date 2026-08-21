"use client"

/**
 * CategoryShowcase — Minimalist, clean category selector.
 *
 * Provides a horizontal scrollable strip of curated categories with smooth
 * interaction, crisp icons, and clear active state indicators.
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
  PawPrint,
  GraduationCap,
  Dumbbell,
  HeartPulse,
  LayoutGrid,
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
  eletrica: Plug,
  eletricista: Plug,
  hidraulica: Droplets,
  encanador: Droplets,
  pintura: PaintRoller,
  pintor: PaintRoller,
  reforma: Hammer,
  pedreiro: Hammer,
  limpeza: Sparkles,
  diarista: Sparkles,
  jardinagem: Leaf,
  jardineiro: Leaf,
  mudanca: Truck,
  frete: Truck,
  beleza: Scissors,
  tecnologia: Laptop,
  informatica: Laptop,
  fotografia: Camera,
  gastronomia: Utensils,
  pets: PawPrint,
  aulas: GraduationCap,
  fitness: Dumbbell,
  saude: HeartPulse,
}

function getCategoryIcon(slug?: string, name?: string): LucideIcon {
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

  if (isLoading) {
    return (
      <section className={cn("border-border/40 border-b bg-background/50 py-3", className)}>
        <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-hidden px-4 sm:px-6 lg:px-8">
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-32 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-36 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
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
        "border-border/40 sticky top-16 z-20 border-b bg-background/80 backdrop-blur-md transition-all",
        className,
      )}
      aria-label="Filtrar por categoria"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div
          ref={scrollRef}
          tabIndex={0}
          aria-label="Lista de categorias navegável"
          className="no-scrollbar flex items-center gap-2 overflow-x-auto py-3 focus-visible:outline-none"
        >
          {/* "Todas" pill */}
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={cn(
              "flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-xs font-medium transition-all",
              activeId === null
                ? "bg-primary text-primary-foreground shadow-sm shadow-emerald-500/20"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <LayoutGrid className="size-3.5" />
            <span>Todas as categorias</span>
          </button>

          {/* Individual Category Pills */}
          {categories.map((cat) => {
            const Icon = getCategoryIcon(cat.slug, cat.name)
            const isActive = activeId === cat.id

            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onSelect(isActive ? null : cat.id)}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2 rounded-full border px-4 text-xs font-medium transition-all",
                  isActive
                    ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                    : "border-border/50 bg-card/60 text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className={cn("size-3.5", isActive ? "text-primary" : "text-muted-foreground")} />
                <span>{cat.name}</span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
