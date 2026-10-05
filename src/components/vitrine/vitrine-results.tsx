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
import { List, MapIcon, MapPin, SlidersHorizontal, SearchX, X, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import type { Category, ProviderCard as ProviderCardType } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

import Filters, { DEFAULT_FILTERS, type FiltersState } from "./filters"
import ProviderCard, { ProviderCardSkeleton } from "./provider-card"

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
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false)
  // Derive valid selection — automatically clears if the selected provider
  // is no longer in the current results (e.g. after pagination or filter change).
  const activeSelectedId = React.useMemo(() => {
    if (selectedId && !providers.some((p) => p.id === selectedId)) return null
    return selectedId
  }, [selectedId, providers])

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
      className={cn("mx-auto w-full max-w-7xl scroll-mt-32 px-4 py-8 sm:px-6 lg:px-8", className)}
      aria-label="Resultados da busca"
    >
      <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-8">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:block">
          <div className="sticky top-32 max-h-[calc(100vh-9rem)] overflow-y-auto rounded-xl border border-slate-200 bg-slate-100 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <Filters
              value={filters}
              onChange={onFiltersChange}
              categories={categories}
              total={total}
              hasGeo={hasGeo}
            />
          </div>
        </aside>

        {/* Main column */}
        <div className="min-w-0">
          {/* Header: count + chips + view toggle + mobile filter button */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2
                  ref={headingResultadosRef}
                  tabIndex={-1}
                  className="text-lg font-semibold tracking-tight outline-none"
                >
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
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Exibindo {providers.length} de {total}
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
                    <div className="flex-1 overflow-y-auto bg-slate-100 p-4 dark:bg-slate-800">
                      <Filters
                        value={filters}
                        onChange={(v) => {
                          onFiltersChange(v)
                        }}
                        categories={categories}
                        hasGeo={hasGeo}
                      />
                    </div>
                    <div className="border-t p-3">
                      <Button className="w-full" onClick={() => setMobileFiltersOpen(false)}>
                        Ver {total} resultados
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>

                {/* View toggle (segmented control) + sort indicator */}
                <span className="bg-card text-muted-foreground hidden items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] sm:inline-flex">
                  Ordenado por:{" "}
                  <span className="text-foreground font-medium">
                    {filters.sort === "distance" ? "Mais próximos" : "Melhor avaliação"}
                  </span>
                </span>
                <div
                  role="tablist"
                  aria-label="Visualização"
                  className="bg-card inline-flex items-center rounded-lg border p-0.5 shadow-sm"
                >
                  <ViewToggle
                    active={view === "list"}
                    onClick={() => setView("list")}
                    label="Lista"
                  >
                    <List className="size-4" />
                  </ViewToggle>
                  <ViewToggle active={view === "map"} onClick={() => setView("map")} label="Mapa">
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
                    className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 transition-colors hover:underline"
                  >
                    Limpar tudo
                  </button>
                </li>
              </ul>
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
              <ResultsGrid>
                {Array.from({ length: 6 }).map((_, i) => (
                  <ProviderCardSkeleton key={i} />
                ))}
              </ResultsGrid>
            ) : providers.length === 0 ? (
              <EmptyState
                hasFilters={activeChips.length > 0}
                onClear={() => onFiltersChange({ ...DEFAULT_FILTERS, q: filters.q })}
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
                selectedId={activeSelectedId}
                onSelect={setSelectedId}
                onQuote={onQuote}
                onBook={onBook}
                onView={onView}
                radius={filters.radius}
                onRadiusChange={(r) => onFiltersChange({ ...filters, radius: r })}
              />
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
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Internal view components
// ---------------------------------------------------------------------------

function ResultsGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
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
        "focus-visible:ring-ring flex h-9 items-center gap-1.5 rounded-md px-3.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2",
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

function EmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="bg-card flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center shadow-sm">
      <div className="flex size-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
        <SearchX className="size-8" />
      </div>
      <h3 className="mt-4 text-base font-semibold tracking-tight">Nenhum prestador encontrado</h3>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
        {hasFilters
          ? "Tente ajustar os filtros ou aumentar o raio de busca para ver mais resultados."
          : "Compartilhe sua localização ou busque por uma categoria para começar."}
      </p>
      {hasFilters ? (
        <Button
          variant="outline"
          size="sm"
          className="border-primary/30 text-primary hover:border-primary hover:bg-primary/10 hover:text-primary mt-4"
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

function buildChips(filters: FiltersState, categories: Category[]): Chip[] {
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

function resolveCategoryName(id: string, categories: Category[]): string | null {
  for (const c of categories) {
    if (c.id === id) return c.name
    if (c.children?.length) {
      const found = resolveCategoryName(id, c.children)
      if (found) return found
    }
  }
  return null
}
