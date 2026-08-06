"use client"

/**
 * Filters — sidebar / sheet of vitrine filters.
 *
 * The component itself renders only the controls. The parent decides whether
 * to mount it in a desktop sidebar (`<aside class="hidden lg:block">`) or in a
 * mobile Sheet. Sub-categories are fetched lazily via TanStack Query.
 *
 * FiltersState is owned by the parent (vitrine orchestrator) so the providers
 * query can be driven from it.
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, SlidersHorizontal, Star, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { fetchCategories, type Category } from "@/lib/api"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

export type FiltersState = {
  q: string
  categoryId: string | null
  radius: number // 1-100 km
  sort: "rating" | "distance"
  verifiedOnly: boolean
  minRating: 0 | 3 | 4 | 5
}

export const DEFAULT_FILTERS: FiltersState = {
  q: "",
  categoryId: null,
  radius: 15,
  sort: "rating",
  verifiedOnly: false,
  minRating: 0,
}

export type FiltersProps = {
  value: FiltersState
  onChange: (next: FiltersState) => void
  categories: Category[]
  /** Total result count — when provided, a disabled "Ver N resultados"
   *  button is rendered at the bottom of the filters (desktop sidebar). */
  total?: number
  /** Whether the user has shared their location (lat/lng available).
   *  When false, the "Mais próximos" sort option is disabled. */
  hasGeo?: boolean
  /** Called when the user clicks a disabled "Mais próximos" — lets the parent
   *  trigger a location-permission prompt (geo awareness flow). */
  onRequestGeo?: () => void
  className?: string
}

export default function Filters({
  value,
  onChange,
  categories,
  total,
  hasGeo = false,
  onRequestGeo,
  className,
}: FiltersProps) {
  // Resolve category chain for the currently-selected leaf
  const { data: l1Children } = useQuery({
    queryKey: ["categories", "children", resolveL1Id(value.categoryId, categories)],
    queryFn: () =>
      fetchCategories({
        parentId: resolveL1Id(value.categoryId, categories) ?? "",
      }),
    enabled: !!resolveL1Id(value.categoryId, categories),
    staleTime: 5 * 60 * 1000,
  })

  const { data: l2Children } = useQuery({
    queryKey: ["categories", "children", resolveL2Id(value.categoryId, categories, l1Children)],
    queryFn: () =>
      fetchCategories({
        parentId: resolveL2Id(value.categoryId, categories, l1Children) ?? "",
      }),
    enabled: !!resolveL2Id(value.categoryId, categories, l1Children),
    staleTime: 5 * 60 * 1000,
  })

  const setField = <K extends keyof FiltersState>(key: K, v: FiltersState[K]) =>
    onChange({ ...value, [key]: v })

  const l1Id = resolveL1Id(value.categoryId, categories)
  const l2Id = resolveL2Id(value.categoryId, categories, l1Children)
  const l3Id = resolveL3Id(value.categoryId, l2Children)

  const handleClear = () => onChange({ ...DEFAULT_FILTERS, q: value.q })

  // Breadcrumb path of selected category
  const breadcrumb = React.useMemo(() => {
    const parts: string[] = []
    if (!value.categoryId) return parts
    const l1 = categories.find((c) => c.id === l1Id)
    if (l1) parts.push(l1.name)
    if (l1Children && l2Id) {
      const l2 = l1Children.find((c) => c.id === l2Id)
      if (l2) parts.push(l2.name)
    }
    if (l2Children && l3Id) {
      const l3 = l2Children.find((c) => c.id === l3Id)
      if (l3) parts.push(l3.name)
    }
    return parts
  }, [value.categoryId, categories, l1Id, l2Id, l3Id, l1Children, l2Children])

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <header className="flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <SlidersHorizontal className="text-primary size-4" />
          Filtros
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClear}
          className="text-muted-foreground hover:text-foreground h-8 text-xs"
        >
          Limpar filtros
        </Button>
      </header>

      {/* Search */}
      <div className="space-y-1.5">
        <Label htmlFor="filter-q" className="text-muted-foreground text-xs font-medium">
          Buscar
        </Label>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            id="filter-q"
            value={value.q}
            onChange={(e) => setField("q", e.target.value)}
            placeholder="Serviço, prestador…"
            className="h-9 pl-8"
          />
        </div>
      </div>

      {/* Radius — moved up: most-used filter after category/search */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <Label className="text-muted-foreground text-xs font-medium">Raio de busca</Label>
          <span className="inline-flex min-w-[3rem] items-center justify-center rounded-full bg-emerald-50 px-2 py-0.5 text-center text-[11px] font-semibold text-emerald-700">
            {value.radius} km
          </span>
        </div>
        <Slider
          min={1}
          max={100}
          step={1}
          value={[value.radius]}
          onValueChange={(v) => setField("radius", v[0] ?? 15)}
          aria-label="Raio de busca em quilômetros"
          className="[&_[data-slot=slider-track]]:h-2"
        />
        <div className="text-muted-foreground flex justify-between text-[10px]">
          <span>1 km</span>
          <span>100 km</span>
        </div>
      </div>

      {/* Category cascade (3 levels) */}
      <div className="space-y-2">
        <Label className="text-muted-foreground text-xs font-medium">Categoria</Label>

        {/* Selected path breadcrumb */}
        {breadcrumb.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2 py-1.5">
            {breadcrumb.map((p, idx) => (
              <React.Fragment key={`${p}-${idx}`}>
                {idx > 0 ? <span className="text-[11px] text-emerald-700/60">/</span> : null}
                <span className="text-[11px] font-medium text-emerald-800">{p}</span>
              </React.Fragment>
            ))}
            <button
              type="button"
              onClick={() => setField("categoryId", null)}
              className="ml-auto inline-flex size-4 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-200/60"
              aria-label="Remover filtro de categoria"
            >
              <X className="size-3" />
            </button>
          </div>
        ) : null}

        <Select
          value={l1Id ?? "__all__"}
          onValueChange={(v) => setField("categoryId", v === "__all__" ? null : v)}
        >
          <SelectTrigger className="w-full" size="sm">
            <SelectValue placeholder="Todas as categorias" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as categorias</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {l1Id && l1Children && l1Children.length > 0 ? (
          <Select
            value={l2Id ?? "__all__"}
            onValueChange={(v) => setField("categoryId", v === "__all__" ? l1Id : v)}
          >
            <SelectTrigger className="w-full" size="sm">
              <SelectValue placeholder="Todas as subcategorias" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas</SelectItem>
              {l1Children.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {l2Id && l2Children && l2Children.length > 0 ? (
          <Select
            value={l3Id ?? "__all__"}
            onValueChange={(v) => setField("categoryId", v === "__all__" ? l2Id : v)}
          >
            <SelectTrigger className="w-full" size="sm">
              <SelectValue placeholder="Todas as opções" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas</SelectItem>
              {l2Children.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {/* Sort — segmented control */}
      <div className="space-y-2">
        <Label className="text-muted-foreground text-xs font-medium">Ordenar por</Label>
        <div role="radiogroup" aria-label="Ordenar por" className="grid grid-cols-2 gap-2">
          <SortOption
            active={value.sort === "rating"}
            onClick={() => setField("sort", "rating")}
            label="Melhor avaliação"
          />
          <SortOption
            active={value.sort === "distance"}
            onClick={() => (hasGeo ? setField("sort", "distance") : onRequestGeo?.())}
            disabled={!hasGeo}
            label="Mais próximos"
            title={!hasGeo ? "Compartilhe sua localização para ordenar por distância" : undefined}
          />
        </div>
      </div>

      {/* Minimum rating */}
      <div className="space-y-2">
        <Label className="text-muted-foreground text-xs font-medium">Avaliação mínima</Label>
        <RadioGroup
          value={String(value.minRating)}
          onValueChange={(v) => setField("minRating", Number(v) as FiltersState["minRating"])}
          className="grid grid-cols-4 gap-2"
        >
          <RatingRadio value="0" label="Todas" />
          <RatingRadio value="3" label="3+" />
          <RatingRadio value="4" label="4+" />
          <RatingRadio value="5" label="5" />
        </RadioGroup>
      </div>

      {/* Verified only */}
      <label
        htmlFor="filter-verified"
        className="bg-card flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors hover:border-emerald-200"
      >
        <span className="flex items-center gap-2">
          <Star className="text-primary size-4" />
          <span className="text-sm font-medium">Somente verificados</span>
        </span>
        <Switch
          id="filter-verified"
          checked={value.verifiedOnly}
          onCheckedChange={(v) => setField("verifiedOnly", v)}
        />
      </label>

      {/* Sticky count feedback (desktop sidebar only — caller passes `total`) */}
      {typeof total === "number" ? (
        <Button
          type="button"
          variant="secondary"
          disabled
          className="mt-2 w-full"
          aria-live="polite"
        >
          Ver {total} {total === 1 ? "resultado" : "resultados"}
        </Button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SortOption({
  active,
  onClick,
  label,
  disabled,
  title,
}: {
  active: boolean
  onClick: () => void
  label: string
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        "focus-visible:ring-ring flex h-9 items-center justify-center rounded-lg border px-2 text-xs font-medium transition-all outline-none focus-visible:ring-2",
        active
          ? "border-primary bg-primary/10 text-primary"
          : disabled
            ? "border-muted text-muted-foreground/50 cursor-not-allowed"
            : "bg-background text-muted-foreground hover:text-foreground hover:border-emerald-200",
      )}
    >
      {label}
    </button>
  )
}

function RatingRadio({ value, label }: { value: string; label: string }) {
  return (
    <Label
      htmlFor={`rating-${value}`}
      className="has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/10 has-[[data-state=checked]]:text-primary flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border p-2 text-xs transition-colors"
    >
      <RadioGroupItem id={`rating-${value}`} value={value} className="sr-only" />
      <span className="font-medium">{label}</span>
    </Label>
  )
}

function resolveL1Id(categoryId: string | null, l1Categories: Category[]): string | null {
  if (!categoryId) return null
  // If the leaf is in L1 directly
  if (l1Categories.some((c) => c.id === categoryId)) return categoryId
  // Otherwise: try to find via children (the API may include `children`).
  // As a fallback, return the first L1 that contains the leaf id (best-effort).
  for (const l1 of l1Categories) {
    if (
      l1.children?.some((c) => c.id === categoryId || c.children?.some((g) => g.id === categoryId))
    ) {
      return l1.id
    }
  }
  // If we can't resolve, treat the categoryId itself as L1 (the API will
  // hydrate children of it).
  return categoryId
}

function resolveL2Id(
  categoryId: string | null,
  l1Categories: Category[],
  l1Children?: Category[],
): string | null {
  if (!categoryId) return null
  if (!l1Children) return null
  if (l1Children.some((c) => c.id === categoryId)) return categoryId
  for (const l2 of l1Children) {
    if (l2.children?.some((g) => g.id === categoryId)) return l2.id
  }
  return null
}

function resolveL3Id(categoryId: string | null, l2Children?: Category[]): string | null {
  if (!categoryId || !l2Children) return null
  if (l2Children.some((c) => c.id === categoryId)) return categoryId
  return null
}
