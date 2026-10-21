"use client"

/**
 * HorizontalFilterBar — Barra de Filtros Horizontal Superior da Vitrine (Desktop & Mobile).
 *
 * Substitui a sidebar vertical de 260px por uma barra horizontal moderna estilo Airbnb/Maps,
 * liberando 100% da largura útil da tela para a grade de prestadores de serviços.
 */

import * as React from "react"
import {
  ChevronDown,
  SlidersHorizontal,
  MapPin,
  Star,
  BadgeCheck,
  Zap,
  X,
  List,
  MapIcon,
  Check,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { triggerHaptic } from "@/lib/haptics"
import type { Category } from "@/lib/api"
import type { FiltersState } from "@/components/vitrine/filters"
import { DEFAULT_FILTERS } from "@/components/vitrine/filters"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export type HorizontalFilterBarProps = {
  value: FiltersState
  onChange: (next: FiltersState) => void
  categories: Category[]
  hasGeo?: boolean
  onRequestGeo?: () => void
  onOpenAdvancedFilters: () => void
  activeFiltersCount: number
  view: "list" | "map"
  onViewChange: (view: "list" | "map") => void
  className?: string
  showCategorySelector?: boolean
}

const RADIUS_PRESETS = [5, 15, 30, 50, 100]

export function HorizontalFilterBar({
  value,
  onChange,
  categories,
  hasGeo = false,
  onRequestGeo,
  onOpenAdvancedFilters,
  activeFiltersCount,
  view,
  onViewChange,
  className,
  showCategorySelector = true,
}: HorizontalFilterBarProps) {
  // Popover open states
  const [categoryOpen, setCategoryOpen] = React.useState(false)
  const [radiusOpen, setRadiusOpen] = React.useState(false)
  const [sortOpen, setSortOpen] = React.useState(false)
  const [ratingOpen, setRatingOpen] = React.useState(false)
  const [categorySearch, setCategorySearch] = React.useState("")

  // Discrete filter changes get a light selection haptic; continuous slider drags do not.
  const selectChange = (next: FiltersState) => {
    triggerHaptic("selection")
    onChange(next)
  }

  // Selected category object
  const selectedCategory = React.useMemo(() => {
    if (!value.categoryId) return null
    return categories.find((c) => c.id === value.categoryId) ?? null
  }, [categories, value.categoryId])

  // Filtered categories in popover
  const filteredCategories = React.useMemo(() => {
    if (!categorySearch.trim()) return categories
    const term = categorySearch.toLowerCase()
    return categories.filter((c) => c.name.toLowerCase().includes(term))
  }, [categories, categorySearch])

  // Check if any filter is active compared to defaults (excluding presentation sort)
  const isFiltered =
    (showCategorySelector && value.categoryId !== null) ||
    value.radius !== DEFAULT_FILTERS.radius ||
    value.verifiedOnly !== false ||
    value.minRating !== 0

  return (
    <div
      className={cn(
        "relative z-20 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/95 p-3 shadow-sm backdrop-blur-md transition-all lg:sticky lg:top-[7.8rem] dark:border-slate-800 dark:bg-slate-900/95",
        className,
      )}
    >
      {/* ── Left/Center: Horizontal Filter Pills ── */}
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {/* 1. Category Pill Dropdown (optional when CategoryShowcase macro-bar is active) */}
        {showCategorySelector && (
          <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-95",
                  selectedCategory
                    ? "border-emerald-500 bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
                )}
              >
                <span>{selectedCategory ? selectedCategory.name : "Todas as categorias"}</span>
                <ChevronDown className="size-3.5 opacity-60" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3">
              <p className="mb-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                Categorias de Serviços
              </p>
              <div className="mb-2">
                <Input
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  placeholder="Buscar categoria…"
                  className="h-8 text-xs"
                />
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                <button
                  type="button"
                  onClick={() => {
                    selectChange({ ...value, categoryId: null })
                    setCategoryOpen(false)
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                    value.categoryId === null
                      ? "bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                  )}
                >
                  <span>Todas as categorias</span>
                  {value.categoryId === null && <Check className="size-3.5 text-emerald-600" />}
                </button>
                {filteredCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      selectChange({ ...value, categoryId: cat.id })
                      setCategoryOpen(false)
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                      value.categoryId === cat.id
                        ? "bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                    )}
                  >
                    <span className="truncate">{cat.name}</span>
                    {value.categoryId === cat.id && <Check className="size-3.5 text-emerald-600" />}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* 2. Radius Pill Popover */}
        <Popover open={radiusOpen} onOpenChange={setRadiusOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-95",
                value.radius !== DEFAULT_FILTERS.radius
                  ? "border-emerald-500 bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
              )}
            >
              <MapPin className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Raio: {value.radius} km</span>
              <ChevronDown className="size-3.5 opacity-60" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Raio de Atendimento
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                {value.radius} km
              </span>
            </div>

            <div className="mt-4">
              <Slider
                value={[value.radius]}
                onValueChange={(vals) => onChange({ ...value, radius: vals[0] })}
                min={1}
                max={100}
                step={1}
                className="py-1"
              />
              <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                <span>1 km</span>
                <span>50 km</span>
                <span>100 km</span>
              </div>
            </div>

            {/* Quick Presets */}
            <div className="mt-3 flex items-center justify-between gap-1 border-t border-slate-100 pt-3 dark:border-slate-800">
              {RADIUS_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => selectChange({ ...value, radius: p })}
                  className={cn(
                    "flex-1 rounded-lg border py-1 text-center text-[11px] font-medium transition-colors",
                    value.radius === p
                      ? "border-emerald-500 bg-emerald-50 font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300",
                  )}
                >
                  {p} km
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* 4. Rating Popover */}
        <Popover open={ratingOpen} onOpenChange={setRatingOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-95",
                value.minRating > 0
                  ? "border-emerald-500 bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
              )}
            >
              <Star className="size-3.5 fill-amber-400 text-amber-400" />
              <span>{value.minRating > 0 ? `${value.minRating}+ estrelas` : "Avaliação"}</span>
              <ChevronDown className="size-3.5 opacity-60" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2">
            <p className="px-2 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100">
              Nota Mínima
            </p>
            <div className="mt-1 grid grid-cols-4 gap-1">
              {[0, 3, 4, 5].map((stars) => (
                <button
                  key={stars}
                  type="button"
                  onClick={() => {
                    selectChange({ ...value, minRating: stars as FiltersState["minRating"] })
                    setRatingOpen(false)
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center rounded-lg border py-2 text-xs transition-colors",
                    value.minRating === stars
                      ? "border-emerald-500 bg-emerald-50 font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300",
                  )}
                >
                  <span>{stars === 0 ? "Todas" : `${stars}+`}</span>
                  {stars > 0 && <Star className="mt-0.5 size-3 fill-amber-400 text-amber-400" />}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* 5. Quick Toggle Chip: Verified */}
        <button
          type="button"
          onClick={() => selectChange({ ...value, verifiedOnly: !value.verifiedOnly })}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-95",
            value.verifiedOnly
              ? "border-emerald-500 bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
          )}
        >
          <BadgeCheck
            className={cn(
              "size-4",
              value.verifiedOnly ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400",
            )}
          />
          <span>Verificados</span>
        </button>

        {/* 6. Advanced Filters Modal Trigger */}
        <button
          type="button"
          onClick={() => {
            triggerHaptic("light")
            onOpenAdvancedFilters()
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-all duration-150 outline-none hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <SlidersHorizontal className="size-3.5 text-slate-500" />
          <span>Mais Filtros</span>
          {activeFiltersCount > 0 && (
            <span className="flex size-4.5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
              {activeFiltersCount}
            </span>
          )}
        </button>

        {/* Clear filters quick button if any active */}
        {isFiltered && (
          <button
            type="button"
            onClick={() =>
              selectChange({
                ...DEFAULT_FILTERS,
                q: value.q,
                categoryId: value.categoryId,
                sort: value.sort,
              })
            }
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-2 transition-colors hover:underline"
          >
            <X className="size-3" />
            Limpar
          </button>
        )}
      </div>

      {/* ── Right: Sort Order & View Mode Toggle (Lista / Mapa) ── */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Sort Order Popover */}
        <Popover open={sortOpen} onOpenChange={setSortOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-95",
                value.sort === "distance"
                  ? "border-emerald-500 bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
              )}
            >
              <Zap className="size-3.5 text-amber-500" />
              <span>{value.sort === "distance" ? "Mais próximos" : "Melhor avaliação"}</span>
              <ChevronDown className="size-3.5 opacity-60" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2">
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => {
                  if (!hasGeo) {
                    onRequestGeo?.()
                    return
                  }
                  selectChange({ ...value, sort: "distance" })
                  setSortOpen(false)
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors",
                  value.sort === "distance"
                    ? "bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                  !hasGeo && "cursor-pointer opacity-60",
                )}
              >
                <div>
                  <p className="font-medium">📍 Mais próximos (por GPS)</p>
                  {!hasGeo && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400">
                      Compartilhe localização para ativar
                    </p>
                  )}
                </div>
                {value.sort === "distance" && <Check className="size-3.5 text-emerald-600" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  selectChange({ ...value, sort: "rating" })
                  setSortOpen(false)
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors",
                  value.sort === "rating"
                    ? "bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                )}
              >
                <div>
                  <p className="font-medium">⭐ Melhor avaliação</p>
                  <p className="text-[10px] text-slate-400">Ordena por estrelas e feedbacks</p>
                </div>
                {value.sort === "rating" && <Check className="size-3.5 text-emerald-600" />}
              </button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Subtle divider */}
        <div
          className="hidden h-5 w-px bg-slate-200 sm:block dark:bg-slate-700"
          aria-hidden="true"
        />

        {/* View Mode Toggle */}
        <div
          role="tablist"
          aria-label="Visualização"
          className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-100/80 p-0.5 shadow-inner dark:border-slate-700 dark:bg-slate-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            onClick={() => {
              triggerHaptic("selection")
              onViewChange("list")
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150 active:scale-95",
              view === "list"
                ? "bg-white font-semibold text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white",
            )}
          >
            <List className="size-3.5" />
            <span className="hidden sm:inline">Lista</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "map"}
            onClick={() => {
              triggerHaptic("selection")
              onViewChange("map")
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150 active:scale-95",
              view === "map"
                ? "bg-white font-semibold text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white",
            )}
          >
            <MapIcon className="size-3.5" />
            <span className="hidden sm:inline">Mapa</span>
          </button>
        </div>
      </div>
    </div>
  )
}
