"use client"

/**
 * Vitrine — orchestrator of the public storefront.
 *
 * Composes: Topbar, Hero, CategoryShowcase, VitrineResults, HowItWorks, Footer.
 *
 * Owns:
 *   - Filter state (q, categoryId, radius, sort, verifiedOnly, minRating)
 *   - URL sync — filtros/página/cursor espelhados na query string para buscas
 *     compartilháveis por link (codec em ./search-params.ts)
 *   - Paginação REAL (/?pagina=N): back/forward do browser funcionam; o seek
 *     continua keyset O(log n) — cada página usa a âncora de cursor da
 *     anterior (âncoras em memória; deep-link fundo sem âncora faz walk)
 *   - Server state via TanStack Query (providers, categories, favorites)
 *
 * The providers query is driven by:
 *   - the geo store (user lat/lng)
 *   - the current filter state (debounced `q`)
 *
 * Card actions are wired to the UI store (openQuote / openBooking / openProvider).
 */

import * as React from "react"
import { Suspense } from "react"
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query"

import { reportVitrineMeasure } from "@/lib/vitrine-rum"

import { useAuthStore, useGeoStore, useUIStore } from "@/store"
import {
  fetchCategories,
  fetchFavorites,
  fetchProviders,
  type Category,
  type ProvidersQuery,
} from "@/lib/api"

import Topbar from "./topbar"
import Hero from "./hero"
import CategoryShowcase from "./category-showcase"
import VitrineResults from "./vitrine-results"
import Footer from "../shared/footer"

// Lazy-loaded below-the-fold components (code-split)
const RecentlyViewed = React.lazy(() =>
  import("./recently-viewed").then((m) => ({ default: m.RecentlyViewed })),
)
const NearbyProviders = React.lazy(() => import("./nearby-providers"))
const ProviderSpotlightGeo = React.lazy(() => import("./provider-spotlight-geo"))
const CompareBar = React.lazy(() => import("./compare-bar"))
const BackToTop = React.lazy(() => import("./back-to-top"))
const HowItWorks = React.lazy(() => import("./how-it-works"))
const QuickQuoteCalculator = React.lazy(() => import("./quick-quote-calculator"))
const PartnersTrust = React.lazy(() => import("./partners-trust"))
const Testimonials = React.lazy(() => import("./testimonials"))
const FAQ = React.lazy(() => import("./faq"))
const WhySeverinno = React.lazy(() => import("./why-severinno"))
const CtaBanner = React.lazy(() => import("./cta-banner"))
const ProviderSpotlight = React.lazy(() => import("./provider-spotlight"))
const CompareModal = React.lazy(() => import("./compare-modal"))
const AIChatWidget = React.lazy(() => import("../shared/ai-chat-widget"))
const CookieConsent = React.lazy(() => import("../shared/cookie-consent"))
import { DEFAULT_FILTERS, type FiltersState } from "./filters"
import { parseVitrineSearchParams, serializeVitrineUrlState } from "./search-params"

const RESULTS_ANCHOR_ID = "vitrine-resultados"
const PAGE_LIMIT = 9
/** Alvo máximo de walk (?pagina=N sem âncora): 30 saltos encadeados. */
const MAX_WALK_TARGET = 31

/** Deriva os args de fetchProviders a partir do queryKey da página — MESMA
 *  função para useQuery e prefetch (regra única de serialização:
 *  ""/null/0 → undefined, verifiedOnly → verified). O queryKey carrega tudo
 *  o que os args precisam (q, categoryId, radius, sort, verifiedOnly,
 *  minRating, lat, lng, limit). */
function toFetchArgs(fk: {
  q: string
  categoryId: string | null
  radius: number
  sort: FiltersState["sort"]
  verifiedOnly: boolean
  minRating: number
  lat: number | null
  lng: number | null
  limit: number
}): ProvidersQuery {
  return {
    q: fk.q || undefined,
    categoryId: fk.categoryId ?? undefined,
    radius: fk.radius,
    sort: fk.sort,
    limit: fk.limit,
    verified: fk.verifiedOnly || undefined,
    minRating: fk.minRating > 0 ? fk.minRating : undefined,
    lat: fk.lat ?? undefined,
    lng: fk.lng ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// Lazy section wrapper — defers rendering until section scrolls into view
// ---------------------------------------------------------------------------

function LazySection({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: "300px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (!visible) return <div ref={ref} className="min-h-[100px]" />

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12">
          <div className="border-primary size-5 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      }
    >
      {children}
    </Suspense>
  )
}

// ── Combined state (filters + debouncedQ) via reducer ─────────────
// Filter changes live in a single reducer so a filter switch atomically
// replaces the whole query key (the paged query restarts from page 1).
// As ÂNCORAS de cursor ficam FORA do reducer (anchorsRef, Map<página,
// cursor>): são cache de navegação, não estado de UI.

type VitrineState = {
  filters: FiltersState
  debouncedQ: string
  /** true após a leitura da URL (deep-link). O espelho de URL só escreve
   *  depois dela — evita apagar transientemente os params do link no mount. */
  hydrated: boolean
}

type VitrineAction =
  | { type: "SET_FILTERS"; filters: FiltersState }
  | { type: "SET_CATEGORY"; id: string | null }
  | { type: "DEBOUNCE_Q"; q: string }
  | { type: "HYDRATE_URL"; filters: FiltersState; debouncedQ: string }

function vitrineReducer(state: VitrineState, action: VitrineAction): VitrineState {
  switch (action.type) {
    case "SET_FILTERS":
      return { ...state, filters: action.filters }
    case "SET_CATEGORY":
      return { ...state, filters: { ...state.filters, categoryId: action.id } }
    case "DEBOUNCE_Q":
      return { ...state, debouncedQ: action.q }
    case "HYDRATE_URL":
      return { filters: action.filters, debouncedQ: action.debouncedQ, hydrated: true }
  }
}

export default function Vitrine() {
  const { status: authStatus } = useAuthStore()
  const { lat, lng } = useGeoStore()
  const openQuote = useUIStore((s) => s.openQuote)
  const openBooking = useUIStore((s) => s.openBooking)
  const openProvider = useUIStore((s) => s.openProvider)

  // ---------------------------------------------------------------- state --
  const [state, dispatch] = React.useReducer(vitrineReducer, {
    filters: DEFAULT_FILTERS,
    debouncedQ: "",
    hydrated: false,
  })
  const { filters, debouncedQ } = state

  // ── Deep-link + navegação real (?pagina=N) ──
  // A leitura é pós-mount (client) de propósito: a home é um Server Component
  // estático que hidrata o shell — useSearchParams aqui derrubaria o shell
  // inteiro para renderização dinâmica, matando o HTML/SEO que o app-shell
  // provê. O HTML inicial é idêntico; os filtros do link entram antes do
  // primeiro fetch do cliente, sem flash de conteúdo default.
  //
  // hasGeo via ref de último valor (o store não expõe leitura estável fora
  // do hook): sincronizado a cada render, ANTES do effect de hidratação na
  // ordem de declaração. Se a permissão de geo chegar DEPOIS do mount, um
  // link ?ordenar=distancia já caído em rating permanece em rating — mesmo
  // contrato da UI (o usuário escolhe "Mais próximos" explicitamente).
  const geoRef = React.useRef({ lat, lng })
  React.useEffect(() => {
    geoRef.current = { lat, lng }
  })

  // Página corrente e âncoras keyset por página (STATE, não ref: lidas no
  // render para montar request/URL). A página vem da URL (fonte única —
  // popstate navega de verdade); âncoras são semeadas pelo ?cursor= do
  // deep-link (applyUrl), pela continuação async da queryFn (nextCursor) e
  // pelo walk.
  const [pagina, setPaginaState] = React.useState(1)
  const [anchors, setAnchors] = React.useState<Map<number, string>>(new Map())
  /** Walk em curso (página funda sem âncora) — isFetching sobe, UI segura. */
  const [walkActive, setWalkActive] = React.useState(false)
  /** Token de geração: qualquer reset/navegação aborta o walk async em curso. */
  const walkTokenRef = React.useRef(0)
  /** Navegação por clique em curso (User Timing): marcada no goPage, medida
   *  quando os dados da página alvo assentam (effect de render abaixo). */
  const navStartRef = React.useRef<{
    kind: "pagina" | "walk-anterior" | "deeplink" | "popstate"
    target: number
    at: number
    direction?: "proxima" | "anterior"
    warm?: boolean
    inFlight?: boolean
    walked?: boolean
  } | null>(null)
  /** 1ª execução do applyUrl = pouso do deep-link; as seguintes = popstate
   *  (o closure de applyUrl é estável — deps [startWalk] — então o gatilho
   *  vem do ref, não do state.hydrated do render). */
  const deepLinkRef = React.useRef(true)
  /** Última URL aplicada: o applyUrl re-executa no MESMO load (double-invoke
   *  de effect em dev/StrictMode) com a mesma URL — não é navegação nova e
   *  NÃO deve sobrescrever o pending de instrumentação (roubava o rótulo
   *  deeplink, virando popstate). */
  const appliedUrlRef = React.useRef<string | null>(null)
  const queryClient = useQueryClient()

  // ── Walk: página funda sem âncora (deep-link OU popstate) ──
  // Rotina ASYNC fora do render (react-hooks v6 proíbe setState em effect):
  // busca as páginas encadeadas 1→alvo com queryClient.fetchQuery (dedupe de
  // requests de graça), semeando a âncora de cada página em `anchors`. O
  // token de geração aborta a rotina se qualquer reset/popstate acontecer.
  // Se o dataset acabar antes do alvo, pousa na última página alcançada e
  // normaliza a URL (replaceState). fetchQuery popula o cache — o useQuery
  // da página pousada renderiza na hora, sem novo request.
  const startWalk = React.useCallback(
    async (target: number, walkFilters: FiltersState) => {
      const token = ++walkTokenRef.current
      setWalkActive(true)
      const walkArgs = () => ({
        q: walkFilters.q || undefined,
        categoryId: walkFilters.categoryId ?? undefined,
        radius: walkFilters.radius,
        sort: walkFilters.sort,
        verified: walkFilters.verifiedOnly || undefined,
        minRating: walkFilters.minRating > 0 ? walkFilters.minRating : undefined,
        lat: geoRef.current.lat ?? undefined,
        lng: geoRef.current.lng ?? undefined,
        limit: PAGE_LIMIT,
      })
      let anchor: string | null = null
      try {
        // Páginas 1..alvo-1 encadeadas: página p busca com a âncora semeada
        // pela p-1 (página 1 começa com null). Mesmos queryKeys do useQuery —
        // em produção o fetchQuery deduplica com os requests do render.
        for (let p = 1; p < target; p++) {
          if (walkTokenRef.current !== token) return
          const result = await queryClient.fetchQuery({
            queryKey: [
              "providers",
              "pagina",
              p,
              {
                ...walkFilters,
                lat: geoRef.current.lat,
                lng: geoRef.current.lng,
                limit: PAGE_LIMIT,
              },
            ],
            queryFn: () => fetchProviders({ ...walkArgs(), cursor: anchor }),
            staleTime: 30 * 1000,
          })
          if (walkTokenRef.current !== token) return
          if (!result?.hasMore || !result.nextCursor) {
            // Dataset acabou antes do alvo: pousa onde deu e normaliza a URL.
            // `anchor` (a variável local usada para BUSCAR esta página) e não
            // anchors.get(p): o closure de `anchors` está velho aqui (o walk
            // roda fora do render — setState não retroage no closure).
            setPaginaState(p)
            const qs = serializeVitrineUrlState({
              filters: walkFilters,
              pagina: p,
              cursor: anchor,
              anyParam: true,
            })
            window.history.replaceState(
              window.history.state,
              "",
              `${window.location.pathname}${qs ? `?${qs}` : ""}`,
            )
            return
          }
          anchor = result.nextCursor
          setAnchors((prev) => new Map(prev).set(p + 1, result.nextCursor as string))
        }
        if (walkTokenRef.current !== token) return
        // Alvo alcançado: âncora da página alvo já semeada; pousa nela.
        setPaginaState(target)
        const qs = serializeVitrineUrlState({
          filters: walkFilters,
          pagina: target,
          cursor: anchor,
          anyParam: true,
        })
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${qs ? `?${qs}` : ""}`,
        )
      } finally {
        if (walkTokenRef.current === token) setWalkActive(false)
      }
    },
    [queryClient],
  )

  // Espelho somente-leitura de `anchors` para callbacks estáveis (applyUrl,
  // popstate): ler o valor corrente sem entrar nas deps do useCallback — o
  // closure de applyUrl fica velho quando anchors muda, e o listener de
  // popstate é registrado com o applyUrl do mount. Sincronizado pós-commit
  // (mesmo contrato do geoRef acima; react-hooks v6 proíbe escrever no render).
  const anchorsRef = React.useRef(anchors)
  React.useEffect(() => {
    anchorsRef.current = anchors
  })

  const applyUrl = React.useCallback(() => {
    if (typeof window === "undefined") return
    // ── Instrumentação User Timing: pouso do deep-link (e do popstate) ──
    // O relógio começa na HIDRATAÇÃO da URL (o que o SPA controla — o load
    // de HTML/bundle precede). A 1ª execução é o deep-link; as seguintes,
    // popstate (label próprio para não poluir o baseline do deep-link).
    const at = performance.now()
    const urlNow = window.location.pathname + window.location.search
    const isSameApply = appliedUrlRef.current === urlNow
    appliedUrlRef.current = urlNow
    const parsed = parseVitrineSearchParams(window.location.search)
    // sort=distancia sem geo cai para rating — mesmo contrato do
    // onFiltersChange (o botão "Mais próximos" é desabilitado sem geo).
    const { lat: lat0, lng: lng0 } = geoRef.current
    const urlFilters =
      parsed.filters.sort === "distance" && (lat0 == null || lng0 == null)
        ? { ...parsed.filters, sort: "rating" as const }
        : parsed.filters
    if (parsed.cursor) {
      const target = parsed.pagina
      setAnchors((prev) => new Map(prev).set(target, parsed.cursor as string))
    }
    // Página funda SEM âncora (nem ?cursor= nem memória da sessão): walk a
    // partir da página 1 — idêntico na hidratação e no popstate. A página
    // corrente começa em 1 e o walker sobe até o alvo (com teto).
    const needsWalk =
      parsed.pagina > 1 && !parsed.cursor && anchorsRef.current.get(parsed.pagina) == null
    if (parsed.pagina > 1 && !isSameApply) {
      // A chave do warm-check é construída da URL+geo — a MESMA forma que o
      // filterKey da query montada terá pós-HYDRATE_URL (não referenciar
      // filterKey aqui: é declarado adiante no componente e o array de deps
      // do useCallback avalia NO render — TDZ).
      const warmKey = {
        q: urlFilters.q,
        categoryId: urlFilters.categoryId,
        radius: urlFilters.radius,
        sort: urlFilters.sort,
        verifiedOnly: urlFilters.verifiedOnly,
        minRating: urlFilters.minRating,
        lat: geoRef.current.lat,
        lng: geoRef.current.lng,
        limit: PAGE_LIMIT,
      }
      navStartRef.current = {
        kind: deepLinkRef.current ? "deeplink" : "popstate",
        target: parsed.pagina,
        at,
        walked: needsWalk,
        warm:
          queryClient.getQueryState(["providers", "pagina", parsed.pagina, warmKey])
            ?.dataUpdatedAt != null,
      }
    }
    deepLinkRef.current = false
    setPaginaState(needsWalk ? 1 : parsed.pagina)
    if (needsWalk) startWalk(Math.min(parsed.pagina, MAX_WALK_TARGET), urlFilters)
    // Dispatch SEMPRE (mesmo sem params): liga a flag hydrated do espelho.
    dispatch({ type: "HYDRATE_URL", filters: urlFilters, debouncedQ: urlFilters.q })
  }, [startWalk, queryClient])

  // Hidratação: em MICROTASK (nem render nem setState síncrono em effect —
  // react-hooks v6; o SSR ignora window sem quebrar). O primeiro fetch do
  // useQuery espera `hydrated`, então nada dispara antes da leitura da URL.
  React.useEffect(() => {
    Promise.resolve().then(applyUrl)
  }, [applyUrl])

  // Back/forward do browser navegam DE VERDADE: a página anterior é
  // rehidratada da URL (filtros + página + âncora semeada).
  React.useEffect(() => {
    window.addEventListener("popstate", applyUrl)
    return () => window.removeEventListener("popstate", applyUrl)
  }, [applyUrl])

  // Debounce the free-text query so we don't fire one request per keystroke.
  // Note: typing updates filters.q via SET_FILTERS, which swaps the whole
  // query key — the cursor pagination restarts from the first page.
  React.useEffect(() => {
    const t = window.setTimeout(() => dispatch({ type: "DEBOUNCE_Q", q: filters.q }), 350)
    return () => window.clearTimeout(t)
  }, [filters.q])

  // ── Espelhar filtros/página → barra de endereço ──
  // history.replaceState: o URL acompanha o estado sem entrada no histórico
  // (trocas de página usam pushState em goPage — navegação real). lat/lng
  // NUNCA entram na URL (privacidade — ver search-params.ts). O hash do
  // deep-link ?cursor=… deixa de fazer sentido quando o estado muda; aqui
  // ele é limpo junto.
  const lastUrlRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (typeof window === "undefined") return
    // Antes da hidratação o estado é default — escrever agora apagaria
    // transientemente os params de um deep-link ainda não processado.
    if (!state.hydrated) return
    const qs = serializeVitrineUrlState({
      filters,
      pagina,
      cursor: anchors.get(pagina) ?? null,
      anyParam: true,
    })
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`
    const current = window.location.pathname + window.location.search + window.location.hash
    if (url === lastUrlRef.current || url === current) return
    lastUrlRef.current = url
    window.history.replaceState(window.history.state, "", url)
  }, [filters, pagina, anchors, state.hydrated])

  // ----------------------------------------------------------- categories --
  const categoriesQuery = useQuery({
    queryKey: ["categories", "top"],
    queryFn: () => fetchCategories({ level: 1 }),
    staleTime: 10 * 60 * 1000,
  })
  const categories: Category[] = categoriesQuery.data ?? []

  // ------------------------------------------------------------ providers --
  // Paginação REAL (?pagina=N) com seek keyset: a página N busca com a
  // âncora de cursor da N-1 (O(log n), sem OFFSET). As âncoras vivem em
  // anchorsRef (alimentadas pelo nextCursor de cada resposta e por
  // deep-links ?cursor=). Sem âncora conhecida (deep-link fundo sem
  // ?cursor=), a página alvo é alcançada por WALK: páginas encadeadas a
  // partir da página 1, com placeholderData segurando a última boa.
  // Mudança de filtro zera âncoras e volta para ?pagina=1.
  // useMemo: o effect de prefetch lista filterKey nas deps — identidade
  // estável evita re-executá-lo em render que não trocou filtro/geo.
  // O RECOTE DE USUÁRIO do filterKey (sem lat/lng): é a assinatura de
  // COMPOSIÇÃO dos resultados — muda quando busca/filtros definem um NOVO
  // dataset, não quando a terra se move. O VitrineResults usa para decidir
  // troca de busca/filtro (foco no heading + anúncio assertivo) sem confundir
  // com o tranco do slider ou a digitação da busca (ambos assentam no debounce/
  // commit antes de aqui mudar — um anúncio por composição, não por evento).
  const filterUserKey = React.useMemo(
    () =>
      `${debouncedQ}|${filters.categoryId ?? ""}|${filters.radius}|${filters.sort}|${
        filters.verifiedOnly ? 1 : 0
      }|${filters.minRating}`,
    [
      debouncedQ,
      filters.categoryId,
      filters.radius,
      filters.sort,
      filters.verifiedOnly,
      filters.minRating,
    ],
  )
  const filterKey = React.useMemo(
    () => ({
      q: debouncedQ,
      categoryId: filters.categoryId,
      radius: filters.radius,
      sort: filters.sort,
      verifiedOnly: filters.verifiedOnly,
      minRating: filters.minRating,
      lat,
      lng,
      limit: PAGE_LIMIT,
    }),
    [
      debouncedQ,
      filters.categoryId,
      filters.radius,
      filters.sort,
      filters.verifiedOnly,
      filters.minRating,
      lat,
      lng,
    ],
  )
  const activeAnchor = anchors.get(pagina) ?? null
  const pagedQuery = useQuery({
    queryKey: ["providers", "pagina", pagina, filterKey],
    // O primeiro fetch só depois de ler a URL: sem isso, todo deep-link
    // dispararia um request default (sem os filtros do link) antes da
    // hidratação — request desperdiçado e flash de conteúdo errado.
    enabled: state.hydrated,
    queryFn: async () => {
      const result = await fetchProviders({ ...toFetchArgs(filterKey), cursor: activeAnchor })
      // Semeia a âncora da PÁGINA SEGUINTE com o nextCursor desta resposta —
      // na continuação async, fora do render (react-hooks v6).
      if (result?.hasMore && result.nextCursor) {
        const next = pagina + 1
        const cursor = result.nextCursor
        setAnchors((prev) => (prev.get(next) === cursor ? prev : new Map(prev).set(next, cursor)))
      }
      return result
    },
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  })

  // A âncora da PÁGINA SEGUINTE é semeada pela continuação async da queryFn
  // (abaixo) — sem effect de sincronização (react-hooks v6).

  const pagedData = pagedQuery.data
  const providerItems = pagedData?.items ?? []
  // total/expandedRadius descrevem a query inteira — vêm de qualquer página
  // (o servidor repete o total); com placeholder, a última boa segura a UI.
  const providerTotal = pagedData?.total ?? 0
  const totalPages =
    providerTotal > 0 && pagedData ? Math.max(1, Math.ceil(providerTotal / PAGE_LIMIT)) : undefined

  /** Existe página anterior? pagina > 1 E o alvo é alcançável: âncora em
   *  memória (visita prévia), alvo = p1 (cuja âncora legítima é null) ou
   *  walk reverso cabe no teto. Deep-link direto fundo SEM âncora de N-1 é
   *  alcançável pelo MESMO walk do deep-link sem cursor; além do teto, o
   *  botão desabilita — nada de seek com null (traria o conteúdo da p1
   *  rotulado como N-1) nem de walk que não alcança o alvo. */
  const hasPrevPage = pagina > 1 && (anchors.has(pagina - 1) || pagina - 1 <= MAX_WALK_TARGET)
  /** Próxima existe quando esta resposta tem nextCursor (durante o walk os
   *  botões ficam desabilitados via isFetching — a rotina async pousa na
   *  página alvo sozinha). */
  const hasNextPage = Boolean(pagedData?.hasMore)

  // ── Prefetch da página seguinte (?pagina=N+1) ──
  // Um único corpo para DOIS gatilhos: a CHEGADA da página corrente (effect
  // abaixo) e o HOVER/FOCUS/TOUCH no botão Próxima (onPrefetchNext). O hover
  // cobre o cache EXPIRADO (> staleTime de 30s): o prefetchQuery do TanStack
  // é no-op com dados frescos e REVALIDA vencidos antes do clique — o clique
  // volta a ser render do cache. A queryFn semeia a âncora de N+2 (cache
  // quente ⇒ a queryFn do useQuery de N+1 NÃO roda — sem o seed, N+2
  // seekaria com cursor null, conteúdo errado). Não cascateia: observa só a
  // query MONTADA (pagedQuery.data), nunca a do prefetch.
  const prefetchNextPage = React.useCallback(() => {
    if (!state.hydrated) return
    // PLACEHOLDER (keepPreviousData): durante a transição de página, `data`
    // ainda é da página ANTERIOR — pré-buscar N+1 com esse nextCursor busca
    // o conteúdo ERRADO sob a chave de N+1 (e o dedupe do TanStack impede a
    // correção pelo run seguinte → página repetida rotulada como seguinte).
    if (pagedQuery.isPlaceholderData) return
    const data = pagedQuery.data
    const nextCursor = data?.hasMore ? data.nextCursor : null
    if (!nextCursor) return
    void queryClient.prefetchQuery({
      queryKey: ["providers", "pagina", pagina + 1, filterKey],
      queryFn: () =>
        fetchProviders({ ...toFetchArgs(filterKey), cursor: nextCursor }).then((result) => {
          if (result?.hasMore && result.nextCursor) {
            const cursor = result.nextCursor
            setAnchors((prev) =>
              prev.get(pagina + 2) === cursor ? prev : new Map(prev).set(pagina + 2, cursor),
            )
          }
          return result
        }),
      staleTime: 30 * 1000,
    })
  }, [
    state.hydrated,
    pagedQuery.isPlaceholderData,
    pagedQuery.data,
    pagina,
    filterKey,
    queryClient,
  ])

  React.useEffect(() => {
    // Prefetch de N+1 quando a página corrente assenta — guardas (hydrated,
    // placeholder) e o seed da âncora N+2 moram no callback acima.
    prefetchNextPage()
  }, [
    prefetchNextPage,
    // dataUpdatedAt muda a CADA fetch concluído — com structural sharing, um
    // refetch de dados idênticos mantém a MESMA referência de `data` (e a
    // MESMA identidade do callback) e sem isto o effect não re-roda.
    pagedQuery.dataUpdatedAt,
  ])

  // ── Prefetch da página anterior (Anterior ←) ──
  // Só HOVER/FOCUS/TOUCH (sem trigger de load): a âncora de N-1 existe quando
  // o usuário VEIO de N-1 — e nesse caso o cache de N-1 nasce fresco da
  // visita; o hover cobre o caso EXPIRADO (ficou > staleTime em N). A fonte
  // do cursor é o MAPA DE ÂNCORAS em memória (não o nextCursor da resposta —
  // este é sempre o de N+1). GUARDA ANTI-CORRUPÇÃO: para N-1 > 1 SEM âncora
  // (deep-link direto em N com cursor do link), seekar N-1 com null traria o
  // conteúdo da p1 rotulado como N-1 — o prefetch ABSTÉM-SE (o clique cai no
  // comportamento atual, sem envenenar o cache). Para N-1 = 1, null É a
  // âncora legítima (primeira página da sequência). A queryFn semeia a
  // âncora de N (idempotente — é a que a query montada de N já usou).
  const prefetchPrevPage = React.useCallback(() => {
    if (!state.hydrated) return
    if (pagedQuery.isPlaceholderData) return
    const prev = pagina - 1
    if (prev < 1) return
    const prevCursor = anchors.get(prev) ?? null
    if (prev > 1 && !prevCursor) return
    void queryClient.prefetchQuery({
      queryKey: ["providers", "pagina", prev, filterKey],
      queryFn: () =>
        fetchProviders({ ...toFetchArgs(filterKey), cursor: prevCursor }).then((result) => {
          if (result?.hasMore && result.nextCursor) {
            const cursor = result.nextCursor
            setAnchors((p) => (p.get(pagina) === cursor ? p : new Map(p).set(pagina, cursor)))
          }
          return result
        }),
      staleTime: 30 * 1000,
    })
  }, [state.hydrated, pagedQuery.isPlaceholderData, pagina, filterKey, queryClient, anchors])

  /** Navegação REAL: pushState + estado local. Back/forward rehidratam
   *  tudo da URL (applyUrl via popstate). */
  const goPage = React.useCallback(
    (next: number, opts?: { push?: boolean }) => {
      const target = Math.max(1, next)
      // ── Instrumentação User Timing (Performance API) ──
      // O INÍCIO da medição é o clique; o FIM é o assentamento dos dados da
      // página alvo (effect navStartRef). `warm` diz se havia cache para o
      // alvo no clique (render imediato) ou não (rede) — os dois regimes do
      // baseline em docs/vitrine-pagination-baseline.md.
      const direction: "proxima" | "anterior" = target > pagina ? "proxima" : "anterior"
      const targetState = queryClient.getQueryState(["providers", "pagina", target, filterKey])
      navStartRef.current = {
        kind: "pagina",
        target,
        at: performance.now(),
        direction,
        warm: targetState?.dataUpdatedAt != null,
        // Fetch em voo para o alvo no clique (ex.: o focus-prefetch do botão
        // dispara no mousedown, antes do click): warm=true + inFlight=true ⇒
        // a medida ainda assim inclui o tail da rede.
        inFlight: targetState?.fetchStatus === "fetching",
      }
      // Qualquer navegação aborta um walk async em curso.
      walkTokenRef.current += 1
      setWalkActive(false)
      const qs = serializeVitrineUrlState({
        filters,
        pagina: target,
        cursor: anchors.get(target) ?? null,
        anyParam: true,
      })
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`
      if (opts?.push !== false) {
        window.history.pushState(window.history.state, "", url)
        lastUrlRef.current = url
      }
      setPaginaState(target)
      if (typeof window !== "undefined") {
        const el = document.getElementById(RESULTS_ANCHOR_ID)
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    },
    [filters, anchors, pagina, filterKey, queryClient],
  )

  // ── Medição do clique de paginação (User Timing / Performance API) ──
  // Fim da medição aberta em goPage: os dados da PÁGINA ALVO assentam (não
  // placeholder — placeholder é a página anterior na tela). Com cache quente
  // o measure é ~1 frame; com rede, inclui o fetch. A entrada fica na
  // performance timeline (DevTools → Performance → Timings) e em
  // performance.getEntriesByType("measure") — baseline e limiar de
  // regressão em docs/vitrine-pagination-baseline.md.
  React.useEffect(() => {
    const pending = navStartRef.current
    if (!pending || pending.target !== pagina) return
    if (pagedQuery.isPlaceholderData || !pagedQuery.data) return
    navStartRef.current = null
    // Um nome por regime — filtragem direta no DevTools e no RUM.
    const names = {
      pagina: "vitrine:pagina:render",
      "walk-anterior": "vitrine:walk:render",
      deeplink: "vitrine:deeplink:render",
      popstate: "vitrine:popstate:render",
    } as const
    const settledAt = performance.now()
    try {
      performance.measure(names[pending.kind], {
        start: pending.at,
        end: settledAt,
        detail: pending,
      })
    } catch {
      // User Timing indisponível (ambiente exótico): observabilidade nunca
      // quebra a navegação.
    }
    // RUM leve: a mesma medida vai (amostrada, sem PII — whitelist em
    // src/lib/vitrine-rum.ts) para /api/rum/vitrine virar log estruturado.
    // O reporter engole os próprios erros: RUM nunca quebra a navegação.
    reportVitrineMeasure({
      name: names[pending.kind],
      duration: settledAt - pending.at,
      target: pending.target,
      ...(pending.direction !== undefined ? { direction: pending.direction } : {}),
      ...(pending.warm !== undefined ? { warm: pending.warm } : {}),
      ...(pending.inFlight !== undefined ? { inFlight: pending.inFlight } : {}),
      ...(pending.walked !== undefined ? { walked: pending.walked } : {}),
    })
  }, [pagina, pagedQuery.isPlaceholderData, pagedQuery.data, pagedQuery.dataUpdatedAt])

  /** Anterior: com âncora em memória (ou alvo = p1, cuja âncora legítima é
   *  null), seek direto (goPage com pushState). Deep-link direto SEM âncora
   *  de N-1: o MESMO walk do deep-link sem cursor (p1 → … → N-1, abortável
   *  por walkToken, pousa com replaceState e semeia as âncoras 2..N-1 pelo
   *  caminho — a navegação seguinte sai quente). Alvo além do teto nem
   *  habilita o botão (hasPrevPage). O hover-prefetch permanece abstêmio
   *  nesses casos: hover não pode custar N fetches. */
  const goPrevPage = React.useCallback(() => {
    const target = pagina - 1
    if (target < 1) return
    if (target > 1 && !anchors.has(target)) {
      const walkTarget = Math.min(target, MAX_WALK_TARGET)
      // ── Instrumentação: walk reverso (o pouso no alvo fecha a medida) ──
      navStartRef.current = {
        kind: "walk-anterior",
        target: walkTarget,
        at: performance.now(),
      }
      void startWalk(walkTarget, filters)
      return
    }
    goPage(target)
  }, [pagina, anchors, startWalk, filters, goPage])

  // ------------------------------------------------------------ favorites --
  const favoritesQuery = useQuery({
    queryKey: ["favorites"],
    queryFn: () => fetchFavorites(),
    enabled: authStatus === "authenticated",
    staleTime: 60 * 1000,
  })
  const favorites = React.useMemo(
    () => new Set((favoritesQuery.data ?? []).map((p) => p.id)),
    [favoritesQuery.data],
  )

  // ------------------------------------------------- filter/search reset --
  // Qualquer mudança de filtro ou nova busca: página volta a 1 e âncoras
  // são descartadas (a ordem do keyset muda — âncoras antigas apontariam
  // para outro corte do dataset).
  const resetToFirstPage = React.useCallback(() => {
    walkTokenRef.current += 1
    setWalkActive(false)
    setAnchors(new Map())
    setPaginaState(1)
    lastUrlRef.current = null
  }, [])

  // --------------------------------------------------------- card actions --
  const handleQuote = React.useCallback((id: string) => openQuote({ providerId: id }), [openQuote])
  const handleBook = React.useCallback(
    (id: string, serviceId?: string) => openBooking({ providerId: id, serviceId }),
    [openBooking],
  )
  const handleView = React.useCallback((id: string) => openProvider(id), [openProvider])

  // ---------------------------------------------------- category handlers --
  // Mudança de categoria/filtro: página volta a 1, âncoras descartadas
  // (a ordem do keyset muda — âncoras antigas apontariam para outro corte).
  const handleCategorySelect = React.useCallback(
    (id: string | null) => {
      resetToFirstPage()
      dispatch({ type: "SET_CATEGORY", id })
    },
    [resetToFirstPage],
  )

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <Topbar
        query={filters.q}
        onQueryChange={(q) => {
          resetToFirstPage()
          dispatch({ type: "SET_FILTERS", filters: { ...filters, q } })
        }}
        categories={categories}
        activeCategoryId={filters.categoryId}
        onCategorySelect={handleCategorySelect}
        onSearchSubmit={() => {
          dispatch({ type: "DEBOUNCE_Q", q: filters.q })
          if (typeof window !== "undefined") {
            const el = document.getElementById(RESULTS_ANCHOR_ID)
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        }}
        sort={filters.sort}
        hasGeo={lat != null && lng != null}
      />

      <main className="flex-1">
        {/* 1. Hero — trust engine, search, CTA */}
        <Hero
          query={filters.q}
          onQueryChange={(q) => {
            resetToFirstPage()
            dispatch({ type: "SET_FILTERS", filters: { ...filters, q } })
          }}
          resultsAnchorId={RESULTS_ANCHOR_ID}
          onSearchSubmit={() => {
            dispatch({ type: "DEBOUNCE_Q", q: filters.q })
            if (typeof window !== "undefined") {
              const el = document.getElementById(RESULTS_ANCHOR_ID)
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          }}
        />

        {/* 2. CategoryShowcase — browse by category */}
        <CategoryShowcase
          categories={categories}
          activeId={filters.categoryId}
          onSelect={handleCategorySelect}
          isLoading={categoriesQuery.isLoading}
        />

        <Suspense fallback={null}>
          <RecentlyViewed />
        </Suspense>

        {/* 3b. NearbyProviders — Perto de você (geo-aware) */}
        <Suspense fallback={null}>
          <NearbyProviders />
        </Suspense>

        {/* 3c. ProviderSpotlightGeo — prestadores próximos em destaque */}
        <Suspense fallback={null}>
          <ProviderSpotlightGeo onQuote={handleQuote} onBook={handleBook} onView={handleView} />
        </Suspense>

        {/* 4. VitrineResults — provider listings */}
        <VitrineResults
          providers={providerItems}
          total={providerTotal}
          isLoading={pagedQuery.isLoading}
          isFetching={pagedQuery.isFetching || walkActive}
          error={pagedQuery.error}
          filters={filters}
          onFiltersChange={(next) => {
            const safe =
              next.sort === "distance" && lat == null && lng == null
                ? { ...next, sort: "rating" as const }
                : next
            resetToFirstPage()
            dispatch({ type: "SET_FILTERS", filters: safe })
          }}
          categories={categories}
          favorites={favorites}
          userLat={lat}
          userLng={lng}
          hasGeo={lat != null && lng != null}
          onQuote={handleQuote}
          onBook={handleBook}
          onView={handleView}
          hasPrevPage={hasPrevPage}
          hasNextPage={hasNextPage}
          currentPage={pagina}
          totalPages={totalPages}
          filterUserKey={filterUserKey}
          onPrevPage={goPrevPage}
          onNextPage={() => goPage(pagina + 1)}
          onPrefetchNext={prefetchNextPage}
          onPrefetchPrev={prefetchPrevPage}
          resultsAnchorId={RESULTS_ANCHOR_ID}
          expandedRadius={pagedData?.expandedRadius}
        />

        {/* 5. HowItWorks — process explanation */}
        <LazySection>
          <HowItWorks />
        </LazySection>

        {/* 5b. QuickQuoteCalculator — instant price estimate */}
        <LazySection>
          <QuickQuoteCalculator />
        </LazySection>

        {/* 6. PartnersTrust — H6/H9: press logos, trust signals */}
        <LazySection>
          <PartnersTrust />
        </LazySection>

        {/* 7. Testimonials — social proof from real users */}
        <LazySection>
          <Testimonials />
        </LazySection>

        {/* 8. WhySeverinno — value proposition */}
        <LazySection>
          <WhySeverinno />
        </LazySection>

        {/* 9. ProviderSpotlight — featured provider */}
        <LazySection>
          <ProviderSpotlight />
        </LazySection>

        {/* 10. FAQ — common questions */}
        <LazySection>
          <FAQ />
        </LazySection>

        {/* 11. CtaBanner — final conversion CTA */}
        <LazySection>
          <CtaBanner />
        </LazySection>
      </main>

      <Footer />

      {/* Floating UI — compare bar + back-to-top + AI chat */}
      <Suspense fallback={null}>
        <CompareBar />
      </Suspense>
      <Suspense fallback={null}>
        <BackToTop />
      </Suspense>
      <Suspense fallback={null}>
        <AIChatWidget />
      </Suspense>

      {/* Compare modal — portal-mounted by Radix */}
      <Suspense fallback={null}>
        <CompareModal />
      </Suspense>

      {/* Cookie consent banner — LGPD compliance */}
      <Suspense fallback={null}>
        <CookieConsent />
      </Suspense>
    </div>
  )
}
