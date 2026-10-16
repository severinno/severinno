"use client"

/**
 * VitrineResults — the main results area of the vitrine.
 *
 * Layout:
 *   - Filters sidebar (lg+) + content
 *   - Content header: result count + active filter chips + view toggle (Lista/Mapa)
 *   - Lista view: responsive grid of provider cards
 *   - Mapa view: split list + map; clicking a marker highlights a card
 *   - Loading: skeleton grid; Empty: friendly state with CTA; Load-more (cursor) at bottom
 */

import * as React from "react"
import dynamic from "next/dynamic"
import {
  MapPin,
  SlidersHorizontal,
  SearchX,
  X,
  Loader2,
  LayoutGrid,
  Rows,
  Zap,
  MessageCircle,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { triggerHaptic } from "@/lib/haptics"
import { playPopSound, playCopySuccessSound } from "@/lib/sounds"
import { useGeoStore } from "@/store/geo"
import { toast } from "sonner"
import type { Category, ProviderCard as ProviderCardType } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

import Filters, { DEFAULT_FILTERS, type FiltersState } from "./filters"
import { HorizontalFilterBar } from "./horizontal-filter-bar"
import ProviderCard, { ProviderCardSkeleton } from "./provider-card"
import ProviderCompactRow from "./provider-compact-row"

// MapLibre is client-only — dynamic import with ssr:false to be safe
const ProvidersMap = dynamic(() => import("./enhanced-providers-map"), {
  ssr: false,
  loading: () => (
    <div className="bg-muted relative flex h-[400px] items-center justify-center overflow-hidden rounded-xl border">
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-gray-100 to-gray-200" />
      <div className="relative z-10 flex flex-col items-center gap-2">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
        <span className="text-muted-foreground text-xs">Carregando mapa...</span>
      </div>
    </div>
  ),
})

export type VitrineResultsProps = {
  providers: ProviderCardType[]
  total: number
  isLoading: boolean
  isFetching: boolean
  error: unknown
  filters: FiltersState
  onFiltersChange: (next: FiltersState) => void
  categories: Category[]
  favorites: Set<string>
  userLat?: number | null
  userLng?: number | null
  /** Whether the user has shared their location — used to disable distance sort. */
  hasGeo?: boolean
  onRequestGeo?: () => void
  onQuote?: (id: string) => void
  onBook?: (id: string, serviceId?: string) => void
  onView?: (id: string) => void
  /** Paginação real (/?pagina=N): página corrente, total e navegação. */
  hasPrevPage?: boolean
  hasNextPage?: boolean
  currentPage?: number
  totalPages?: number
  onPrevPage?: () => void
  onNextPage?: () => void
  /** Pré-busca da página seguinte (hover/focus/touch no Próxima — cobre o
   *  cache expirado: revalida antes do clique; no-op com cache fresco). */
  onPrefetchNext?: () => void
  /** Pré-busca da página anterior (hover/focus/touch no Anterior) — só com a
   *  âncora de N-1 em memória; cobre o cache expirado. */
  onPrefetchPrev?: () => void
  resultsAnchorId?: string
  /** Assinatura de COMPOSIÇÃO dos resultados (q|categoria|raio|ordenacao|
   *  verificados|nota — o recorte de usuário do filterKey do PAI, sem geo).
   *  Muda quando busca/filtro definem um NOVO dataset: dispara o anúncio de
   *  re-renderização quando os DADOS assentam — imune ao tranco do slider
   *  (onValueChange contínuo) e à digitação da busca (debounce do pai). */
  filterUserKey?: string
  className?: string
  /** Raio efetivo usado na expansão. null = sem expansão, número = km usado, -1 = além de 100km (sem filtro) */
  expandedRadius?: number | null
}

type ViewMode = "list" | "map"

export default function VitrineResults({
  providers,
  total,
  isLoading,
  isFetching,
  error,
  filters,
  onFiltersChange,
  categories,
  favorites,
  userLat,
  userLng,
  hasGeo,
  onRequestGeo,
  onQuote,
  onBook,
  onView,
  hasPrevPage,
  hasNextPage,
  currentPage,
  totalPages,
  onPrevPage,
  onNextPage,
  onPrefetchNext,
  onPrefetchPrev,
  resultsAnchorId,
  filterUserKey,
  className,
  expandedRadius,
}: VitrineResultsProps) {
  const [view, setView] = React.useState<ViewMode>("list")
  const [layoutMode, setLayoutMode] = React.useState<"grid" | "compact">("grid")
  const [availableToday, setAvailableToday] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false)
  const userDistrict = useGeoStore((s) => s.district)
  const [focusedIndex, setFocusedIndex] = React.useState<number>(-1)

  // Filter providers if availableToday filter is active
  const displayedProviders = React.useMemo(() => {
    if (!availableToday) return providers
    const currentDay = new Date().getDay()
    return providers.filter((p) => {
      if (!p.availability || p.availability.length === 0) {
        return currentDay >= 1 && currentDay <= 6
      }
      return p.availability.some((a) => a.dayOfWeek === currentDay)
    })
  }, [providers, availableToday])

  // Keyboard navigation through results list (ArrowDown / J, ArrowUp / K, Enter)
  React.useEffect(() => {
    if (typeof window === "undefined" || view !== "list" || displayedProviders.length === 0) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      ) {
        return
      }

      if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
        e.preventDefault()
        setFocusedIndex((prev) => {
          const next = Math.min(displayedProviders.length - 1, prev + 1)
          playPopSound()
          return next
        })
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
        e.preventDefault()
        setFocusedIndex((prev) => {
          const next = Math.max(0, prev - 1)
          playPopSound()
          return next
        })
      } else if (
        e.key === "Enter" &&
        focusedIndex >= 0 &&
        focusedIndex < displayedProviders.length
      ) {
        e.preventDefault()
        const targetProvider = displayedProviders[focusedIndex]
        if (targetProvider) onView?.(targetProvider.id)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [view, displayedProviders, focusedIndex, onView])

  // Derive valid selection — automatically clears if the selected provider
  // is no longer in the current results (e.g. after pagination or filter change).
  const activeSelectedId = React.useMemo(() => {
    if (selectedId && !providers.some((p) => p.id === selectedId)) return null
    return selectedId
  }, [selectedId, providers])

  const activeChips = buildChips(filters)

  const handleChipRemove = (key: keyof FiltersState) => {
    playPopSound()
    const next = { ...filters }
    if (key === "q") next.q = ""
    else if (key === "categoryId") next.categoryId = null
    else if (key === "radius") next.radius = DEFAULT_FILTERS.radius
    else if (key === "sort") next.sort = DEFAULT_FILTERS.sort
    else if (key === "verifiedOnly") next.verifiedOnly = false
    else if (key === "minRating") next.minRating = 0
    onFiltersChange(next)
  }

  // Paginação real: botões Anterior/Próxima no rodapé da listagem
  // (o seek do servidor continua keyset — a página N busca com a âncora
  // de cursor da N-1; o sentinela/observer do scroll infinito saiu).

  // ── Acessibilidade da troca de resultados (página E busca/filtro) ──
  // Após paginar ou trocar busca/filtro, o foco do usuário fica nos controles
  // enquanto o conteúdo muda centenas de px acima: quem navega por teclado ou
  // leitor de tela perde o contexto. O heading dos resultados recebe o foco
  // (tabIndex=-1, programático — nunca na ordem de tab) e a região viva
  // assertiva anuncia o novo estado — o role="status" do contador é educado e
  // pode ser engolido no meio da fala.
  const headingResultadosRef = React.useRef<HTMLHeadingElement>(null)
  /** Página e composição do render ANTERIOR. `undefined` no primeiro render:
   *  chegada/pouso não anuncia nem rouba foco (deep-link é narrado pelo URL). */
  const paginaAnteriorRef = React.useRef<number | undefined>(undefined)
  const composicaoAnteriorRef = React.useRef<string | undefined>(undefined)
  /** A TROCA aguardando os dados assentarem — em REF (sem setState no gatilho:
   *  registrar intenção não é motivo para render em cascata). Um anúncio por
   *  ação: o tranco do slider (onValueChange contínuo), a digitação da busca e
   *  a revalidação de fundo (isFetching) não anunciam nada. */
  const trocaPendenteRef = React.useRef<{ tipo: "pagina" | "filtro"; pagina: number } | null>(null)
  /** Texto do anúncio; null = região vazia (elemento estável no DOM — trocar
   *  o nó da região viva re-registra e engole o anúncio). */
  const [anuncio, setAnuncio] = React.useState<string | null>(null)

  React.useEffect(() => {
    const pagAnterior = paginaAnteriorRef.current
    const compAnterior = composicaoAnteriorRef.current
    paginaAnteriorRef.current = currentPage
    composicaoAnteriorRef.current = filterUserKey

    // GATILHOS: composição (busca/filtro) vence a página — quando o filtro
    // reseta para a p1, o anúncio é do NOVO dataset, não da p1; paginar é
    // navegação. Chegada do primeiro valor (undefined) é carregamento, não.
    const novaTroca =
      compAnterior !== undefined && !!filterUserKey && compAnterior !== filterUserKey
        ? { tipo: "filtro" as const, pagina: currentPage ?? 0 }
        : pagAnterior !== undefined && currentPage !== undefined && pagAnterior !== currentPage
          ? { tipo: "pagina" as const, pagina: currentPage }
          : null
    if (novaTroca) trocaPendenteRef.current = novaTroca

    // CONSEQUÊNCIA — os dados da troca assentam (sai do carregamento): move o
    // foco e anuncia UMA vez; revalidação de fundo não re-anuncia.
    if (!trocaPendenteRef.current || isLoading) return
    const pendente = trocaPendenteRef.current
    trocaPendenteRef.current = null
    headingResultadosRef.current?.focus({ preventScroll: true })
    const paginas = typeof totalPages === "number" && totalPages > 0 ? ` de ${totalPages}` : ""
    setAnuncio(
      pendente.tipo === "pagina"
        ? `Página ${pendente.pagina}${paginas} — ${providers.length} ${
            providers.length === 1 ? "prestador" : "prestadores"
          }`
        : `Resultados atualizados — ${providers.length} ${
            providers.length === 1 ? "prestador" : "prestadores"
          } encontrado${providers.length === 1 ? "" : "s"}`,
    )
  }, [currentPage, filterUserKey, isLoading, totalPages, providers.length])

  return (
    <section
      id={resultsAnchorId}
      className={cn("mx-auto w-full max-w-[95%] scroll-mt-32 px-4 py-8 sm:px-6 lg:px-8", className)}
      aria-label="Resultados da busca"
    >
      {/* ── Horizontal Filter Bar (Desktop & Responsive) ── */}
      <HorizontalFilterBar
        value={filters}
        onChange={onFiltersChange}
        categories={categories}
        hasGeo={hasGeo}
        onRequestGeo={onRequestGeo}
        onOpenAdvancedFilters={() => setMobileFiltersOpen(true)}
        activeFiltersCount={activeChips.length}
        view={view}
        onViewChange={setView}
        showCategorySelector={false}
      />

      {/* Main content */}
      <div className="min-w-0">
        {/* Header: count + chips + mobile filter button */}
        <div className="mb-4 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <h2
                ref={headingResultadosRef}
                tabIndex={-1}
                className="text-base font-bold tracking-tight text-slate-900 outline-none sm:text-lg dark:text-slate-100"
              >
                {isLoading ? (
                  <Skeleton className="h-6 w-36" />
                ) : (
                  <>
                    {total}{" "}
                    <span className="text-muted-foreground text-sm font-normal">
                      {total === 1 ? "prestador encontrado" : "prestadores encontrados"}
                    </span>
                  </>
                )}
              </h2>
              {!isLoading && (
                <span className="text-muted-foreground hidden text-xs font-medium sm:inline">
                  • Exibindo {providers.length}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Layout mode switcher: Grid vs Compact List */}
              {view === "list" && providers.length > 0 && (
                <div
                  className="hidden items-center rounded-lg border border-slate-200 bg-slate-100/90 p-0.5 text-xs shadow-2xs sm:inline-flex dark:border-slate-800 dark:bg-slate-900/60"
                  role="group"
                  aria-label="Modo de visualização dos resultados"
                >
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection")
                      playPopSound()
                      setLayoutMode("grid")
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all",
                      layoutMode === "grid"
                        ? "bg-white font-bold text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white"
                        : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white",
                    )}
                    aria-pressed={layoutMode === "grid"}
                    aria-label="Visualização em grade de cards"
                    title="Exibição em Cards"
                  >
                    <LayoutGrid className="size-3.5" />
                    <span>Cards</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection")
                      playPopSound()
                      setLayoutMode("compact")
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all",
                      layoutMode === "compact"
                        ? "bg-white font-bold text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white"
                        : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white",
                    )}
                    aria-pressed={layoutMode === "compact"}
                    aria-label="Visualização em lista compacta"
                    title="Exibição em Linhas"
                  >
                    <Rows className="size-3.5" />
                    <span>Linhas</span>
                  </button>
                </div>
              )}

              {/* Quick Filter: Atende Hoje */}
              {view === "list" && providers.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    playPopSound()
                    setAvailableToday((v) => !v)
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all",
                    availableToday
                      ? "border-amber-500/60 bg-amber-500/10 font-bold text-amber-800 shadow-2xs dark:text-amber-300"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400",
                  )}
                  aria-pressed={availableToday}
                  title="Filtrar prestadores com expediente hoje"
                >
                  <Zap
                    className={cn(
                      "size-3.5",
                      availableToday ? "fill-amber-500 text-amber-500" : "text-slate-400",
                    )}
                  />
                  <span className="hidden sm:inline">Atende Hoje</span>
                </button>
              )}

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
                  <div className="flex-1 overflow-y-auto bg-slate-100 p-4 dark:bg-slate-800">
                    <Filters
                      value={filters}
                      onChange={(v) => {
                        onFiltersChange(v)
                      }}
                      categories={categories}
                      hasGeo={hasGeo}
                      onRequestGeo={onRequestGeo}
                    />
                  </div>
                  <div className="border-t p-3">
                    <Button className="w-full" onClick={() => setMobileFiltersOpen(false)}>
                      Ver {total} resultados
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>

          {/* Active filter chips bar (only for secondary search filters, category is handled by CategoryShowcase) */}
          {activeChips.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/60 bg-slate-50/50 px-3 py-1.5 dark:border-slate-800/60 dark:bg-slate-900/30">
              <ul className="flex flex-wrap items-center gap-1.5">
                <li className="text-muted-foreground mr-1 text-[11px] font-medium">
                  Filtros ativos:
                </li>
                {activeChips.map((chip) => (
                  <li key={chip.key}>
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200/80 bg-white py-0.5 pr-1 pl-2 text-xs font-medium text-slate-700 shadow-2xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      <span>{chip.label}</span>
                      <button
                        type="button"
                        onClick={() => handleChipRemove(chip.key)}
                        className="flex size-3.5 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                        aria-label={`Remover filtro ${chip.label}`}
                      >
                        <X className="size-2.5" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() =>
                  onFiltersChange({
                    ...DEFAULT_FILTERS,
                    categoryId: filters.categoryId,
                    sort: filters.sort,
                  })
                }
                className="text-xs font-medium text-emerald-700 underline-offset-2 transition-colors hover:underline dark:text-emerald-400"
              >
                Limpar filtros
              </button>
            </div>
          ) : null}

          <Separator className="mt-1" />
        </div>

        {/* Radius expanded notice — mostra quando o raio foi automaticamente expandido */}
        {expandedRadius !== undefined &&
        expandedRadius !== null &&
        !isLoading &&
        !error &&
        providers.length > 0 ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
            <MapPin className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              {expandedRadius === -1 ? (
                <>
                  <p className="font-medium text-amber-900 dark:text-amber-200">
                    Nenhum prestador encontrado num raio de até 100 km
                  </p>
                  <p className="mt-0.5 text-amber-700 dark:text-amber-300">
                    Mostrando todos os prestadores disponíveis. Aumente o raio de busca ou ajuste
                    sua localização para ver resultados mais próximos.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-amber-900 dark:text-amber-200">
                    Nenhum prestador encontrado no raio de {filters.radius} km
                  </p>
                  <p className="mt-0.5 text-amber-700 dark:text-amber-300">
                    Busca expandida automaticamente para <strong>{expandedRadius} km</strong>.
                    Aumente o raio na barra de filtros para refinar ou ajuste sua localização.
                  </p>
                </>
              )}
            </div>
          </div>
        ) : null}

        {/* Content */}
        <div className="mt-4">
          {error ? (
            <ErrorState onRetry={() => onFiltersChange({ ...filters })} />
          ) : isLoading ? (
            layoutMode === "grid" ? (
              <ResultsGrid>
                {Array.from({ length: 6 }).map((_, i) => (
                  <ProviderCardSkeleton key={i} />
                ))}
              </ResultsGrid>
            ) : (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="border-border/50 bg-card flex animate-pulse items-center justify-between gap-4 rounded-2xl border p-4 shadow-2xs"
                  >
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-11 rounded-xl" />
                      <div className="space-y-1.5">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-8.5 w-20 rounded-xl" />
                      <Skeleton className="h-8.5 w-20 rounded-xl" />
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : providers.length === 0 ? (
            <EmptyState
              hasFilters={
                activeChips.length > 0 ||
                !!filters.categoryId ||
                filters.radius !== DEFAULT_FILTERS.radius ||
                filters.minRating > 0 ||
                filters.verifiedOnly
              }
              onClear={() => onFiltersChange({ ...DEFAULT_FILTERS })}
              onSuggestionSelect={(term) => onFiltersChange({ ...DEFAULT_FILTERS, q: term })}
              onExpandRadius={() =>
                onFiltersChange({
                  ...filters,
                  radius: Math.min(50, (filters.radius || 15) + 15),
                })
              }
              currentRadius={filters.radius}
              userDistrict={userDistrict}
            />
          ) : view === "list" ? (
            <div className="animate-in fade-in duration-200">
              {availableToday && displayedProviders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
                    <Zap className="size-6" />
                  </div>
                  <p className="text-base font-bold">Nenhum prestador disponível hoje</p>
                  <p className="text-muted-foreground mt-1 max-w-sm text-xs">
                    Nenhum dos {providers.length} profissionais encontrados possui expediente
                    cadastrado para hoje.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      playPopSound()
                      setAvailableToday(false)
                    }}
                    className="mt-4 text-xs font-semibold"
                  >
                    Exibir todos os {providers.length} prestadores
                  </Button>
                </div>
              ) : layoutMode === "grid" ? (
                <ResultsGrid>
                  {displayedProviders.map((p, idx) => (
                    <div
                      key={p.id}
                      className={cn(
                        "rounded-2xl transition-all duration-150",
                        focusedIndex === idx &&
                          "ring-offset-background ring-2 ring-emerald-500 ring-offset-2",
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
                </ResultsGrid>
              ) : (
                <div className="flex flex-col gap-3">
                  {displayedProviders.map((p, idx) => (
                    <div
                      key={p.id}
                      className={cn(
                        "rounded-2xl transition-all duration-150",
                        focusedIndex === idx &&
                          "ring-offset-background ring-2 ring-emerald-500 ring-offset-2",
                      )}
                    >
                      <ProviderCompactRow
                        provider={p}
                        favorited={favorites.has(p.id)}
                        onQuote={onQuote}
                        onBook={onBook}
                        onView={onView}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="animate-in fade-in duration-200">
              <MapView
                providers={providers}
                favorites={favorites}
                userLat={userLat}
                userLng={userLng}
                selectedId={activeSelectedId}
                onSelect={setSelectedId}
                onQuote={onQuote}
                onBook={onBook}
                onView={onView}
                radius={filters.radius}
                onRadiusChange={(r) => onFiltersChange({ ...filters, radius: r })}
              />
            </div>
          )}

          {/* Subtle refetching indicator */}
          {isFetching && !isLoading && providers.length > 0 ? (
            <div className="text-muted-foreground mt-3 flex items-center justify-center gap-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              Atualizando…
            </div>
          ) : null}
        </div>

        {/* Paginação — Anterior/Próxima (navegação real, pushState). */}
        {!error && !isLoading && (hasPrevPage || hasNextPage) ? (
          <nav
            aria-label="Paginação de resultados"
            className="mt-8 flex items-center justify-center gap-3"
          >
            {/* Hover/focus/touch pré-busam (ou revalidam, se expirado) a
                  página anterior — o componente decide pela âncora. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasPrevPage || isFetching}
              onClick={() => onPrevPage?.()}
              onPointerEnter={onPrefetchPrev}
              onFocus={onPrefetchPrev}
              onTouchStart={onPrefetchPrev}
            >
              ← Anterior
            </Button>
            <span className="text-muted-foreground text-xs" role="status">
              {typeof currentPage === "number" && currentPage > 0 ? (
                <>
                  Página {currentPage}
                  {typeof totalPages === "number" && totalPages > 0 ? ` de ${totalPages}` : ""}
                </>
              ) : null}
            </span>
            {/* Hover/focus/touch pré-busam (ou revalidam, se expirado) a
                  página seguinte antes do clique. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasNextPage || isFetching}
              onClick={() => onNextPage?.()}
              onPointerEnter={onPrefetchNext}
              onFocus={onPrefetchNext}
              onTouchStart={onPrefetchNext}
            >
              Próxima →
            </Button>
          </nav>
        ) : null}
        {/* Anúncio da troca de resultados para leitores de tela —
              `role="alert"` (região viva assertiva implícita): a troca foi AÇÃO
              do usuário e um anúncio educado aqui é perdido. SEMPRE montado
              (vazio quando ocioso) e FORA do condicional da paginação: uma
              troca de filtro pode remover a paginação inteira, e a região não
              pode morrer junto com o anúncio que ela carrega. */}
        <p role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
          {anuncio}
        </p>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Internal view components
// ---------------------------------------------------------------------------

function ResultsGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4">
      {children}
    </div>
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
  radius,
  onRadiusChange,
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
  radius?: number
  onRadiusChange?: (radius: number) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Map */}
      <div className="order-1 h-[480px] min-h-[400px] w-full overflow-hidden rounded-xl lg:sticky lg:top-32 lg:order-2 lg:h-[calc(100vh-12rem)]">
        <ProvidersMap
          className="h-full w-full"
          providers={providers}
          userLat={userLat}
          userLng={userLng}
          selectedId={selectedId}
          onSelectProvider={(id) => onSelect(id)}
          radius={radius}
          onRadiusChange={onRadiusChange}
        />
      </div>

      {/* List */}
      <div className="order-2 lg:order-1">
        <p className="text-muted-foreground mb-2 text-xs">
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
                  ? "ring-primary ring-offset-background ring-2 ring-offset-2"
                  : "hover:ring-border ring-1 ring-transparent",
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

const POPULAR_RECOVERY_SUGGESTIONS = [
  "Eletricista",
  "Encanador",
  "Pintor",
  "Diarista",
  "Ar-condicionado",
  "Montador de Móveis",
]

function EmptyState({
  hasFilters,
  onClear,
  onSuggestionSelect,
  onExpandRadius,
  currentRadius,
  userDistrict,
}: {
  hasFilters: boolean
  onClear: () => void
  onSuggestionSelect?: (term: string) => void
  onExpandRadius?: () => void
  currentRadius?: number
  userDistrict?: string | null
}) {
  const [quickQuoteText, setQuickQuoteText] = React.useState("")

  return (
    <div className="bg-card flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 px-6 py-14 text-center shadow-xs dark:border-slate-800">
      <div className="flex size-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-900/50">
        <SearchX className="size-8" />
      </div>
      <h3 className="mt-4 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        Nenhum prestador encontrado
      </h3>
      <p className="text-muted-foreground mt-1.5 max-w-sm text-sm">
        {hasFilters
          ? "Tente ajustar os filtros ou aumentar o raio de busca para ver profissionais disponíveis."
          : "Compartilhe sua localização ou busque por uma categoria para começar."}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {hasFilters ? (
          <Button
            variant="outline"
            size="sm"
            className="border-primary/30 text-primary hover:border-primary hover:bg-primary/10 hover:text-primary rounded-xl font-medium"
            onClick={() => {
              playPopSound()
              triggerHaptic("selection")
              onClear()
            }}
          >
            Limpar todos os filtros
          </Button>
        ) : null}

        {onExpandRadius && (currentRadius == null || currentRadius < 50) ? (
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => {
              playPopSound()
              triggerHaptic("selection")
              onExpandRadius()
            }}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-700"
          >
            <MapPin className="size-3.5" />
            <span>Expandir busca para toda GV (+15 km)</span>
          </Button>
        ) : null}
      </div>

      {/* Orçamento Relâmpago em Valadares */}
      <div className="mt-6 w-full max-w-md rounded-2xl border border-emerald-500/20 bg-emerald-50/50 p-4 text-left shadow-2xs dark:border-emerald-800/40 dark:bg-emerald-950/20">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-2xs">
            <Zap className="size-3.5" />
          </span>
          <div>
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Pedir Orçamento Relâmpago para GV
            </h4>
            <p className="text-muted-foreground text-[11px]">
              Avisamos os profissionais mais próximos no WhatsApp.
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!quickQuoteText.trim()) return
            const text = encodeURIComponent(
              `Olá! Preciso de um orçamento no Severinno (Governador Valadares):\n\n📝 Serviço solicitado: ${quickQuoteText.trim()}\n📍 Região/Bairro: ${userDistrict || "Governador Valadares"}`,
            )
            playCopySuccessSound()
            toast.success("Redirecionando para o WhatsApp do atendimento...")
            window.open(`https://wa.me/5533991113030?text=${text}`, "_blank", "noopener,noreferrer")
          }}
          className="mt-2.5 flex flex-col gap-2"
        >
          <input
            type="text"
            value={quickQuoteText}
            onChange={(e) => setQuickQuoteText(e.target.value)}
            placeholder="Ex.: Trocar disjuntor ou consertar vazamento..."
            className="bg-background text-foreground placeholder:text-muted-foreground/70 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none dark:border-slate-800"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!quickQuoteText.trim()}
            className="h-8.5 gap-1.5 rounded-xl bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <MessageCircle className="size-3.5" />
            <span>Enviar Pedido de Orçamento</span>
          </Button>
        </form>
      </div>

      <div className="mt-6 flex flex-col items-center">
        <span className="text-muted-foreground mb-2.5 text-xs font-medium">
          Ou busque por serviços populares em Governador Valadares:
        </span>
        <div className="flex max-w-md flex-wrap items-center justify-center gap-1.5">
          {POPULAR_RECOVERY_SUGGESTIONS.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onSuggestionSelect?.(term)
              }}
              className="border-border/60 bg-muted/50 hover:border-primary/40 hover:bg-primary/10 hover:text-primary cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors"
            >
              {term}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="border-destructive/30 bg-destructive/5 flex flex-col items-center justify-center rounded-xl border px-6 py-16 text-center">
      <div className="bg-destructive/10 flex size-14 items-center justify-center rounded-full">
        <X className="text-destructive size-7" />
      </div>
      <h3 className="mt-4 text-base font-semibold tracking-tight">Algo deu errado</h3>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
        Não foi possível carregar os prestadores. Verifique sua conexão e tente novamente.
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

function buildChips(filters: FiltersState): Chip[] {
  const chips: Chip[] = []
  if (filters.q.trim()) {
    chips.push({ key: "q", label: `“${filters.q.trim()}”` })
  }
  if (filters.radius !== DEFAULT_FILTERS.radius) {
    chips.push({ key: "radius", label: `Raio: ${filters.radius} km` })
  }
  if (filters.verifiedOnly) {
    chips.push({ key: "verifiedOnly", label: "Verificados" })
  }
  if (filters.minRating > 0) {
    chips.push({ key: "minRating", label: `★ ${filters.minRating}+` })
  }
  return chips
}
