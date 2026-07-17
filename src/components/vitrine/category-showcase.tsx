"use client"

/**
 * CategoryShowcase — horizontal scroll / grid of category cards.
 *
 * Clicking a card selects that category in the parent (filters the vitrine).
 * Icons are mapped per category by `slug` (lucide-react).
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
  type LucideIcon,
} from "lucide-react"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"
import type { Category } from "@/lib/api"
import { useScrollReveal } from "@/hooks/use-animation"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"

const FALLBACK_ICON = MoreHorizontal

const ICON_BY_SLUG: Record<string, LucideIcon> = {
  reparos: Wrench,
  limpeza: Sparkles,
  reforma: Hammer,
  pintura: PaintRoller,
  jardinagem: Leaf,
  transporte: Truck,
  eletricista: Plug,
  encanador: Droplets,
  encanamento: Droplets,
  beleza: Scissors,
  tecnologia: Laptop,
  fotografia: Camera,
  gastronomia: Utensils,
  compras: ShoppingCart,
  pets: PawPrint,
  educacao: GraduationCap,
  fitness: Dumbbell,
  eventos: PartyPopper,
  saude: HeartPulse,
}

export type CategoryShowcaseProps = {
  categories: Category[]
  activeId?: string | null
  onSelect?: (id: string | null) => void
  isLoading?: boolean
  className?: string
}

export default function CategoryShowcase({
  categories,
  activeId,
  onSelect,
  isLoading,
  className,
}: CategoryShowcaseProps) {
  const { ref, visible } = useScrollReveal<HTMLDivElement>()

  return (
    <section
      aria-label="Categorias"
      className={cn(
        "mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8",
        className,
      )}
    >
      <div ref={ref}>
      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={visible ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.45 }}
        className="mb-4 flex items-end justify-between gap-4"
      >
        <div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Explore por categoria
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Serviços verificados perto de você — escolha e receba orçamentos em
            minutos.
          </p>
        </div>
      </motion.header>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : categories.length === 0 ? null : (
        <ScrollArea className="w-full pb-2">
          <div className="flex gap-3 sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {categories.map((c, idx) => {
              const Icon = resolveIcon(c)
              const active = activeId === c.id
              return (
                <motion.button
                  key={c.id}
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={
                    visible
                      ? { opacity: 1, y: 0, scale: 1 }
                      : {}
                  }
                  transition={{ duration: 0.4, delay: idx * 0.05 }}
                  type="button"
                  onClick={() => onSelect?.(active ? null : c.id)}
                  aria-pressed={active}
                  className={cn(
                    "group flex min-w-[140px] flex-col items-start gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-all sm:min-w-0",
                    "hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "dark:hover:border-emerald-700 dark:hover:bg-emerald-950/20",
                    active &&
                      "border-primary bg-primary/5 ring-1 ring-primary",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-10 items-center justify-center rounded-lg transition-all group-hover:scale-110",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-emerald-50 text-emerald-700 group-hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:group-hover:bg-emerald-950/60",
                    )}
                  >
                    <Icon className="size-5" />
                  </span>
                  <span className="text-sm font-medium leading-tight">
                    {c.name}
                  </span>
                </motion.button>
              )
            })}
          </div>
        </ScrollArea>
      )}
      </div>
    </section>
  )
}

function resolveIcon(c: Category): LucideIcon {
  if (c.icon && ICON_BY_SLUG[c.icon]) return ICON_BY_SLUG[c.icon]!
  if (ICON_BY_SLUG[c.slug]) return ICON_BY_SLUG[c.slug]!
  // Best-effort slug substring match
  for (const [slug, Icon] of Object.entries(ICON_BY_SLUG)) {
    if (c.slug.includes(slug) || c.name.toLowerCase().includes(slug)) {
      return Icon
    }
  }
  return FALLBACK_ICON
}
