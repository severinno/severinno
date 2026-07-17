"use client"

/**
 * VitrineResults — the main results area of the vitrine.
 *
 * Layout:
 *   - Filters sidebar (lg+) + content
 *   - Content header: result count + active filter chips + view toggle (Lista/Mapa)
 *   - Lista view: responsive grid of provider cards
 *   - Mapa view: split list + map; clicking a marker highlights a card
 *   - Loading: skeleton grid; Empty: friendly state with CTA; Pagination at bottom
 */

import * as React from "react"
import dynamic from "next/dynamic"
import {
  List,
  MapIcon,
  MapPin,
  SlidersHorizontal,
  SearchX,
  X,
  Loader2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { Category, ProviderCard as ProviderCardType } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

import Filters, {
  DEFAULT_FILTERS,
  type FiltersState,
} from "./filters"
import ProviderCard, { ProviderCardSkeleton } from "./provider-card"

// MapLibre is client-only — dynamic import with ssr:false to be safe
const ProvidersMap = dynamic(() => import("./providers-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[400px] items-center justify-center rounded-xl border bg-muted">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  ),
})

export type VitrineResultsProps = {
  providers: ProviderCardType[]
  total: number
  page: number
  limit: number
  isLoading: boolean
  isFetching: boolean
  error: unknown
  filters: FiltersState
  onFiltersChange: (next: FiltersState) => void
  categories: Category[]
  favorites: Set<string>
  userLat?: number | null
  userLng?: number | null
  onQuote?: (id: string) => void
  onBook?: (id: string, serviceId?: string) => void
  onView?: (id: string) => void
  onPageChange?: (page: number) => void
  resultsAnchorId?: string
  className?: string
  radiusExpanded?: boolean
}

type ViewMode = "list" | "map"

export default function VitrineResults({
  providers,
  total,
  page,
  limit,
  isLoading,
  isFetching,
  error,
  filters,
  onFiltersChange,
  categories,
  favorites,
  userLat,
  userLng,
  onQuote,
  onBook,
  onView,
  onPageChange,
  resultsAnchorId,
  className,
  radiusExpanded,
}: VitrineResultsProps) {
  const [view, setView] = React.useState<ViewMode>("list")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false)

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)))
  const showingFrom = total === 0 ? 0 : (page - 1) * limit + 1
  const showingTo = Math.min(total, page * limit)

  const activeChips = buildChips(filters, categories)

  const handleChipRemove = (key: keyof FiltersState) => {
    const next = { ...filters }
    if (key === "q") next.q = ""
    else if (key === "categoryId") next.categoryId = null
    else if (key === "radius") next.radius = DEFAULT_FILTERS.radius
    else if (key === "sort") next.sort = DEFAULT_FILTERS.sort
    else if (key === "verifiedOnly") next.verifiedOnly = false
    else if (key === "minRating") next.minRating = 0
    onFiltersChange(next)
  }

  // Reset selection when providers change
  React.useEffect(() => {
    if (selectedId && !providers.some((p) => p.id === selectedId)) {
      setSelectedId(null)
    }
  }, [providers, selectedId])

  return (
    <section
      id={resultsAnchorId}
      className={cn(
        "mx-auto w-full max-w-7xl scroll-mt-32 px-4 py-8 sm:px-6 lg:px-8",
        className,
      )}
      aria-label="Resultados da busca"
    >
      <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-8">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:block">
          <div className="sticky top-32 max-h-[calc(100vh-9rem)] overflow-y-auto rounded-xl border bg-card p-4 shadow-sm">
            <Filters
              value={filters}
              onChange={onFiltersChange}
              categories={categories}
              total={total}
            />
          </div>
        </aside>

        {/* Main column */}
        <div className="min-w-0">
          {/* Header: count + chips + view toggle + mobile filter button */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight">
                  {isLoading ? (
                    <Skeleton className="h-6 w-40" />
                  ) : (
                    <>
                      {total}{" "}
                      <span className="text-muted-foreground">
                        {total === 1 ? "prestador encontrado" : "prestadores encontrados"}
                      </span>
                    </>
                  )}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Exibindo {showingFrom}–{showingTo} de {total}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* Mobile filters trigger */}
                <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
                  <SheetTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="lg:hidden"
                      aria-label="Abrir filtros"
                    >
                      <SlidersHorizontal className="size-4" />
                      Filtros
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[88vw] sm:max-w-sm">
                    <SheetHeader>
                      <SheetTitle>Filtros</SheetTitle>
                    </SheetHeader>
                    <div className="flex-1 overflow-y-auto p-4">
                      <Filters
                        value={filters}
                        onChange={(v) => {
                          onFiltersChange(v)
                        }}
                        categories={categories}
                      />
                    </div>
                    <div className="border-t p-3">
                      <Button
                        className="w-full"
                        onClick={() => setMobileFiltersOpen(false)}
                      >
                        Ver {total} resultados
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>

                {/* View toggle (segmented control) + sort indicator */}
                <span className="hidden items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-[11px] text-muted-foreground sm:inline-flex">
                  Ordenado por:{" "}
                  <span className="font-medium text-foreground">
                    {filters.sort === "distance" ? "Mais próximos" : "Melhor avaliação"}
                  </span>
                </span>
                <div
                  role="tablist"
                  aria-label="Visualização"
                  className="inline-flex items-center rounded-lg border bg-card p-0.5 shadow-sm"
                >
                  <ViewToggle
                    active={view === "list"}
                    onClick={() => setView("list")}
                    label="Lista"
                  >
                    <List className="size-4" />
                  </ViewToggle>
                  <ViewToggle
                    active={view === "map"}
                    onClick={() => setView("map")}
                    label="Mapa"
                  >
                    <MapIcon className="size-4" />
                  </ViewToggle>
                </div>
              </div>
            </div>

            {/* Active chips */}
            {activeChips.length > 0 ? (
              <ul className="flex flex-wrap items-center gap-1.5">
                {activeChips.map((chip) => (
                  <li key={chip.key}>
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 py-1 pr-1 pl-2.5 text-[11px] font-medium text-emerald-800">
                      <span>{chip.label}</span>
                      <button
                        type="button"
                        onClick={() => handleChipRemove(chip.key)}
                        className="flex size-4 items-center justify-center rounded-full text-emerald-700 transition-colors hover:bg-emerald-200/60"
                        aria-label={`Remover filtro ${chip.label}`}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => onFiltersChange({ ...DEFAULT_FILTERS, q: filters.q })}
                    className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                  >
                    Limpar tudo
                  </button>
                </li>
              </ul>
            ) : null}

            <Separator className="mt-1" />
          </div>

          {/* Radius expanded notice (Nielsen H9 — help users recover) */}
          {radiusExpanded && !isLoading && !error && providers.length > 0 ? (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
              <MapPin className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  Nenhum prestador encontrado no raio de {filters.radius} km
                </p>
                <p className="mt-0.5 text-amber-700 dark:text-amber-300">
                  Mostrando os prestadores mais próximos da sua localização. Aumente o raio na barra de filtros para ver mais opções ou ajuste sua localização.
                </p>
              </div>
            </div>
          ) : null}

          {/* Content */}
          <div className="mt-4">
            {error ? (
              <ErrorState
                onRetry={() => onFiltersChange({ ...filters })}
              />
            ) : isLoading ? (
              <ResultsGrid>
                {Array.from({ length: 6 }).map((_, i) => (
                  <ProviderCardSkeleton key={i} />
                ))}
              </ResultsGrid>
            ) : providers.length === 0 ? (
              <EmptyState
                hasFilters={activeChips.length > 0}
                onClear={() =>
                  onFiltersChange({ ...DEFAULT_FILTERS, q: filters.q })
                }
              />
            ) : view === "list" ? (
              <ResultsGrid>
                {providers.map((p) => (
                  <ProviderCard
                    key={p.id}
                    provider={p}
                    favorited={favorites.has(p.id)}
                    onQuote={onQuote}
                    onBook={onBook}
                    onView={onView}
                  />
                ))}
              </ResultsGrid>
            ) : (
              <MapView
                providers={providers}
                favorites={favorites}
                userLat={userLat}
                userLng={userLng}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onQuote={onQuote}
                onBook={onBook}
                onView={onView}
              />
            )}

            {/* Subtle refetching indicator */}
            {isFetching && !isLoading && providers.length > 0 ? (
              <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Atualizando…
              </div>
            ) : null}
          </div>

          {/* Pagination */}
          {!error && !isLoading && total > limit ? (
            <Pagination className="mt-8">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      if (page > 1) onPageChange?.(page - 1)
                    }}
                    aria-disabled={page <= 1}
                    className={cn(page <= 1 && "pointer-events-none opacity-50")}
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="text-sm tabular-nums">
                    Página {page} de {totalPages}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      if (page < totalPages) onPageChange?.(page + 1)
                    }}
                    aria-disabled={page >= totalPages}
                    className={cn(
                      page >= totalPages && "pointer-events-none opacity-50",
                    )}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          ) : null}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Internal view components
// ---------------------------------------------------------------------------

function ResultsGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {children}
    </div>
  )
}

function ViewToggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={label}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-md px-3.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
      <span className="inline">{label}</span>
    </button>
  )
}

function MapView({
  providers,
  favorites,
  userLat,
  userLng,
  selectedId,
  onSelect,
  onQuote,
  onBook,
  onView,
}: {
  providers: ProviderCardType[]
  favorites: Set<string>
  userLat?: number | null
  userLng?: number | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  onQuote?: (id: string) => void
  onBook?: (id: string, serviceId?: string) => void
  onView?: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
      {/* Map */}
      <div className="order-1 h-[500px] overflow-hidden rounded-xl lg:order-2 lg:h-[calc(100vh-12rem)] lg:sticky lg:top-32">
        <ProvidersMap
          providers={providers}
          userLat={userLat}
          userLng={userLng}
          selectedId={selectedId}
          onSelectProvider={(id) => onSelect(id)}
        />
      </div>

      {/* List */}
      <div className="order-2 lg:order-1">
        <p className="mb-2 text-xs text-muted-foreground">
          Toque em um marcador para destacar o prestador.
        </p>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 lg:max-h-[calc(100vh-12rem)]">
          {providers.map((p) => (
            <div
              key={p.id}
              data-selected={selectedId === p.id}
              onClick={() => onSelect(p.id)}
              className={cn(
                "cursor-pointer rounded-xl transition-all",
                selectedId === p.id
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "ring-1 ring-transparent hover:ring-border",
              )}
            >
              <ProviderCard
                provider={p}
                favorited={favorites.has(p.id)}
                onQuote={onQuote}
                onBook={onBook}
                onView={onView}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function EmptyState({
  hasFilters,
  onClear,
}: {
  hasFilters: boolean
  onClear: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card px-6 py-16 text-center shadow-sm">
      <div className="flex size-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
        <SearchX className="size-8" />
      </div>
      <h3 className="mt-4 text-base font-semibold tracking-tight">
        Nenhum prestador encontrado
      </h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {hasFilters
          ? "Tente ajustar os filtros ou aumentar o raio de busca para ver mais resultados."
          : "Compartilhe sua localização ou busque por uma categoria para começar."}
      </p>
      {hasFilters ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-4 border-primary/30 text-primary hover:border-primary hover:bg-primary/10 hover:text-primary"
          onClick={onClear}
        >
          Limpar filtros
        </Button>
      ) : null}
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10">
        <X className="size-7 text-destructive" />
      </div>
      <h3 className="mt-4 text-base font-semibold tracking-tight">
        Algo deu errado
      </h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Não foi possível carregar os prestadores. Verifique sua conexão e tente
        novamente.
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Active filter chips
// ---------------------------------------------------------------------------

type Chip = { key: keyof FiltersState; label: string }

function buildChips(
  filters: FiltersState,
  categories: Category[],
): Chip[] {
  const chips: Chip[] = []
  if (filters.q.trim()) {
    chips.push({ key: "q", label: `“${filters.q.trim()}”` })
  }
  if (filters.categoryId) {
    const name = resolveCategoryName(filters.categoryId, categories)
    if (name) chips.push({ key: "categoryId", label: `Categoria: ${name}` })
  }
  if (filters.radius !== DEFAULT_FILTERS.radius) {
    chips.push({ key: "radius", label: `Raio: ${filters.radius} km` })
  }
  if (filters.sort !== DEFAULT_FILTERS.sort) {
    chips.push({
      key: "sort",
      label: filters.sort === "distance" ? "Mais próximos" : "Melhor avaliação",
    })
  }
  if (filters.verifiedOnly) {
    chips.push({ key: "verifiedOnly", label: "Verificados" })
  }
  if (filters.minRating > 0) {
    chips.push({ key: "minRating", label: `★ ${filters.minRating}+` })
  }
  return chips
}

function resolveCategoryName(
  id: string,
  categories: Category[],
): string | null {
  for (const c of categories) {
    if (c.id === id) return c.name
    if (c.children?.length) {
      const found = resolveCategoryName(id, c.children)
      if (found) return found
    }
  }
  return null
}
