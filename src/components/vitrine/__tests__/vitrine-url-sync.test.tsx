/**
 * Tests for Vitrine — URL ↔ estado (buscas compartilháveis + paginação real).
 *
 * Coverage:
 *   ✅ Deep-link: ?q=…&nota=… hidrata filtros antes do primeiro fetch
 *   ✅ ?pagina=N&cursor=…: seek DIRETO com a âncora do link (1 request)
 *   ✅ ?pagina=N sem âncora: WALK keyset encadeado (null → B → C)
 *   ✅ Dataset acaba antes do alvo: walk aborta e normaliza a URL
 *   ✅ ?pagina= inválida: cai na página 1 sem walk
 *   ✅ Espelho: filtro muda → página reseta (pagina sai da URL), cursor sai
 *   ✅ pushState/goPage + popstate: back/forward rehidratam da URL
 *   ✅ sort=distancia sem geo cai para rating; com geo mantém
 *   ✅ lat/lng nunca na URL (privacidade)
 *   ✅ SSR-safe: render default sem lançar
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { encodeProviderCursor } from "@/lib/keyset"

// ---------------------------------------------------------------------------
// Hoisted state
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  fetchProviders: vi.fn(),
  fetchCategories: vi.fn(),
  fetchFavorites: vi.fn(),
  useGeoStore: vi.fn(),
  useUIStore: vi.fn(),
  useAuthStore: vi.fn(),
  useQuery: vi.fn(),
  /** Fila de respostas por cursor (keyset): null → página 1/2 do walk etc. */
  responsesByCursor: new Map<string | null, any[]>(),
  /** Chamadas de prefetchQuery (opts) para asserção — pode repetir a mesma
   *  chave em re-renders (cache quente ⇒ sem request); asserções usam Set. */
  prefetchCalls: [] as any[],
  /** Cliente estável: o TanStack real devolve a MESMA instância a cada
   *  render (context) — instabilidade aqui faria applyUrl/startWalk mudarem
   *  de identidade e o effect de hidratação dispararia em loop. */
  queryClient: {
    // Estado do cache para a instrumentação de navegação ("warm" = havia
    // dados para a chave no clique — a pergunta que getQueryState responde
    // no TanStack real).
    getQueryState: (key: any) =>
      firedKeys.has(JSON.stringify(key)) ? { dataUpdatedAt: 1 } : undefined,
    fetchQuery: (opts: any) => Promise.resolve(opts.queryFn()),
    // Fiel ao TanStack: registra a chave como disparada (um useQuery montado
    // depois encontra o cache e NÃO refaz o request), roda a queryFn 1x por
    // chave e engole erros (prefetch é fire-and-forget).
    prefetchQuery: (opts: any) => {
      h.prefetchCalls.push(opts)
      const key = JSON.stringify(opts.queryKey)
      if (firedKeys.has(key)) return Promise.resolve(null)
      firedKeys.add(key)
      return Promise.resolve(opts.queryFn()).catch(() => null)
    },
  },
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: any) => h.useQuery(opts),
  useQueryClient: () => h.queryClient,
  keepPreviousData: Symbol("keepPreviousData"),
}))

vi.mock("@/store", () => ({
  useAuthStore: (sel?: any) => h.useAuthStore(sel),
  useGeoStore: (sel?: any) => h.useGeoStore(sel),
  useUIStore: (sel?: any) => h.useUIStore(sel),
}))

vi.mock("@/lib/api", () => ({
  fetchProviders: (...a: any[]) => h.fetchProviders(...a),
  fetchCategories: (...a: any[]) => h.fetchCategories(...a),
  fetchFavorites: (...a: any[]) => h.fetchFavorites(...a),
}))

// Children pesados/fora do escopo — stubs (lazy + seções below-the-fold).
vi.mock("../topbar", () => ({ default: () => <div data-testid="topbar" /> }))
vi.mock("../hero", () => ({ default: () => <div data-testid="hero" /> }))
vi.mock("../category-showcase", () => ({ default: () => <div data-testid="cats" /> }))
vi.mock("../vitrine-results", () => ({
  default: (p: any) => (
    <div data-testid="results">
      <button
        type="button"
        data-testid="chg-filters"
        onClick={() => p.onFiltersChange?.({ ...p.filters, verifiedOnly: true })}
      />
      <button type="button" data-testid="go-next" onClick={() => p.onNextPage?.()} />
      <button
        type="button"
        data-testid="hover-next"
        onClick={() => p.onPrefetchNext?.()}
        onPointerEnter={() => p.onPrefetchNext?.()}
      />
      <button
        type="button"
        data-testid="hover-prev"
        onClick={() => p.onPrefetchPrev?.()}
        onPointerEnter={() => p.onPrefetchPrev?.()}
      />
      <button
        type="button"
        data-testid="go-prev"
        disabled={!p.hasPrevPage}
        onClick={() => p.onPrevPage?.()}
      />
    </div>
  ),
}))
vi.mock("../../shared/footer", () => ({ default: () => <div /> }))
vi.mock("../recently-viewed", () => ({ RecentlyViewed: () => <div /> }))
vi.mock("../nearby-providers", () => ({ default: () => <div /> }))
vi.mock("../provider-spotlight-geo", () => ({ default: () => <div /> }))
vi.mock("../compare-bar", () => ({ default: () => <div /> }))
vi.mock("../back-to-top", () => ({ default: () => <div /> }))
vi.mock("../compare-modal", () => ({ default: () => <div /> }))
vi.mock("../../shared/ai-chat-widget", () => ({ default: () => <div /> }))
vi.mock("../../shared/cookie-consent", () => ({ default: () => <div /> }))
vi.mock("../how-it-works", () => ({ default: () => <div /> }))
vi.mock("../quick-quote-calculator", () => ({ default: () => <div /> }))
vi.mock("../partners-trust", () => ({ default: () => <div /> }))
vi.mock("../testimonials", () => ({ default: () => <div /> }))
vi.mock("../faq", () => ({ default: () => <div /> }))
vi.mock("../why-severinno", () => ({ default: () => <div /> }))
vi.mock("../provider-spotlight", () => ({ default: () => <div /> }))
vi.mock("../cta-banner", () => ({ default: () => <div /> }))

import { render, screen, act, cleanup } from "@/__tests__/test-utils"
import Vitrine from "../vitrine"

// jsdom não tem IntersectionObserver — LazySection instancia um no mount.
beforeAll(() => {
  if (typeof (globalThis as any).IntersectionObserver === "undefined") {
    ;(globalThis as any).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
  }
})

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const CURSOR_B = encodeProviderCursor({ s: "rating", r: 4.0, f: 1, id: "usr_b" })
const CURSOR_C = encodeProviderCursor({ s: "rating", r: 3.5, f: 1, id: "usr_c" })

function page(items: number, nextCursor: string | null, hasMore = nextCursor != null) {
  return {
    items: Array.from({ length: items }, (_, i) => ({ id: `p${items}-${i}`, name: `P ${i}` })),
    total: 415,
    hasMore,
    nextCursor,
    expandedRadius: null,
  }
}

/** Páginas por número — o mock do useQuery devolve pages[n] para ?pagina=n. */
let pages: Record<number, ReturnType<typeof page>> = {}

// queryKeys já disparadas (o TanStack real não refaz fetch da mesma chave).
const firedKeys = new Set<string>()

function setPages(map: Record<number, ReturnType<typeof page>>) {
  pages = map
}

function setGeo(geo: { lat: number; lng: number } | null) {
  const state = geo
    ? { lat: geo.lat, lng: geo.lng, city: "GV" }
    : { lat: null, lng: null, city: null }
  h.useGeoStore.mockImplementation((sel?: any) => (sel ? sel(state) : state))
}

beforeEach(() => {
  vi.clearAllMocks()
  firedKeys.clear()
  h.responsesByCursor.clear()
  h.prefetchCalls.length = 0
  setGeo(null)
  setPages({ 1: page(9, CURSOR_B) })

  h.useAuthStore.mockImplementation((sel?: any) =>
    sel ? sel({ status: "unauthenticated" }) : { status: "unauthenticated" },
  )
  h.useUIStore.mockImplementation((sel?: any) =>
    sel
      ? sel({ openQuote: vi.fn(), openBooking: vi.fn(), openProvider: vi.fn() })
      : { openQuote: vi.fn(), openBooking: vi.fn(), openProvider: vi.fn() },
  )

  h.fetchCategories.mockResolvedValue([])
  h.fetchFavorites.mockResolvedValue([])
  // Keyset: resposta consumida da fila do cursor pedido (default: fim).
  h.fetchProviders.mockImplementation((q: any) => {
    const queue = h.responsesByCursor.get(q?.cursor ?? null)
    const resp = queue && queue.length ? queue.shift() : page(9, null, false)
    return Promise.resolve(resp)
  })

  // useQuery: a query paginada é identificada por queryKey[0] === "providers".
  // Fiel ao TanStack real: respeita `enabled` (não dispara pré-hidratação) e
  // dispara queryFn UMA vez por queryKey (refetch só em chave nova).
  h.useQuery.mockImplementation((opts: any) => {
    if (opts.queryKey?.[0] !== "providers") {
      return { data: [], isLoading: false, isFetching: false, error: null }
    }
    if (opts.enabled === false) {
      return { data: undefined, error: null, isLoading: true, isFetching: false }
    }
    const pagina = opts.queryKey[2] as number
    const key = JSON.stringify(opts.queryKey)
    const data = pages[pagina]
    if (data && !firedKeys.has(key)) {
      firedKeys.add(key)
      void opts.queryFn()
    }
    return {
      data,
      error: null,
      isLoading: !data,
      isFetching: !data,
      // Contrato do keepPreviousData: o effect de prefetch lê esta flag e
      // NÃO pré-busca enquanto os dados exibidos são da página anterior.
      isPlaceholderData: false,
    }
  })
})

async function renderVitrine() {
  await act(async () => {
    render(<Vitrine />)
    // Rodadas de microtasks: hidratação → fetch → efeito de nextCursor →
    // walker (quando ativo). 6 rodadas cobrem o walk do teto dos testes.
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

/** Args de todos os fetchProviders disparados, na ordem. */
function fetchCalls(): any[] {
  return h.fetchProviders.mock.calls.map((c) => c[0])
}

// ===========================================================================
// Deep-link de filtros
// ===========================================================================

describe("Vitrine — deep-link de filtros", () => {
  it("hydrates filters from ?q and passes them to the first request", async () => {
    window.history.replaceState(null, "", "/?q=encanador&nota=4")
    await renderVitrine()

    const calls = fetchCalls()
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0]).toMatchObject({ q: "encanador", minRating: 4 })
    expect(calls[0].cursor).toBeNull()
  })

  it("sort=distancia without geo falls back to rating (UI contract)", async () => {
    window.history.replaceState(null, "", "/?ordenar=distancia")
    await renderVitrine()

    expect(fetchCalls()[0].sort).toBe("rating")
  })

  it("sort=distancia with geo keeps distance and raio", async () => {
    setGeo({ lat: -19.76, lng: -42.15 })
    window.history.replaceState(null, "", "/?ordenar=distancia&raio=8")
    await renderVitrine()

    expect(fetchCalls()[0]).toMatchObject({ sort: "distance", radius: 8 })
  })

  it("clean URL → default state, page 1, URL untouched", async () => {
    window.history.replaceState(null, "", "/")
    await renderVitrine()

    expect(fetchCalls()[0]).toMatchObject({ sort: "rating", radius: 15, cursor: null })
    expect(window.location.pathname + window.location.search).toBe("/")
  })

  it("mirror does not wipe a dirty URL that already matches state", async () => {
    window.history.replaceState(null, "", "/?q=encanador")
    await renderVitrine()
    expect(window.location.search).toBe("?q=encanador")
  })
})

// ===========================================================================
// ?pagina=N — seek direto e walk
// ===========================================================================

describe("Vitrine — ?pagina=N (navegação real com keyset)", () => {
  it("pagina=2 com cursor do link: seek DIRETO com a âncora (+ prefetch da p3)", async () => {
    setPages({ 2: page(9, CURSOR_C) })
    window.history.replaceState(null, "", `/ ?pagina=2&cursor=${CURSOR_B}`.replace(" ", ""))
    await renderVitrine()

    const calls = fetchCalls()
    // [p2 seek com a âncora do link, prefetch da p3 com a âncora C semeada
    // pela resposta da p2]
    expect(calls.map((c) => c.cursor)).toEqual([CURSOR_B, CURSOR_C])
    expect(window.location.search).toContain("pagina=2")
  })

  it("pagina=3 SEM cursor: walk keyset encadeado (p1 → p2 → pousa p3)", async () => {
    const measureSpy = vi.spyOn(performance, "measure")
    try {
      setPages({
        1: page(9, CURSOR_B),
        2: page(9, CURSOR_C),
        3: page(9, null),
      })
      // fila por cursor: null alimenta p1 (componente) e p1 do walk; B alimenta p2
      h.responsesByCursor.set(null, [page(9, CURSOR_B), page(9, CURSOR_B)])
      h.responsesByCursor.set(CURSOR_B, [page(9, CURSOR_C)])
      window.history.replaceState(null, "", "/?pagina=3")
      await renderVitrine()

      const cursors = fetchCalls().map((c) => c.cursor)
      // Sequência REAL: o walk (rotina async em microtasks) completa o
      // encadeamento antes do flush do re-render — o HYDRATE_URL + setPagina(3)
      // coalescem num único commit e o componente NUNCA monta a p1 (o TanStack
      // real deduplica da mesma forma: fetchQuery popula o cache do useQuery).
      // [null=p1-walk, B=p2-walk com a âncora da p1, C=p3-componente com a
      // âncora C semeada pelo walk]. A fila de null tem duas páginas: a segunda
      // só seria consumida se o commit NÃO coalescesse (regressão de flush).
      expect(cursors).toEqual([null, CURSOR_B, CURSOR_C])
      expect(window.location.search).toContain("pagina=3")

      // Pouso do deep-link medido (User Timing): walked=true — o pouso veio de
      // um walk interno, do relógio da hidratação da URL ao dado assentado.
      const deeplinkMeasure = (measureSpy.mock.calls as unknown as [string, any][]).find(
        (c) => c[0] === "vitrine:deeplink:render",
      )
      expect(deeplinkMeasure?.[1].detail).toMatchObject({
        target: 3,
        kind: "deeplink",
        walked: true,
      })
    } finally {
      measureSpy.mockRestore()
    }
  })

  it("dataset acaba antes do alvo: walk aborta e normaliza a URL", async () => {
    setPages({
      1: page(9, CURSOR_B),
      2: page(9, null, false), // hasMore=false: não há página 3
    })
    h.responsesByCursor.set(null, [page(9, CURSOR_B), page(9, CURSOR_B)])
    h.responsesByCursor.set(CURSOR_B, [page(9, null, false)])
    window.history.replaceState(null, "", "/?pagina=3")
    await renderVitrine()

    const cursors = fetchCalls().map((c) => c.cursor)
    // Mesma coalescência do walk completo: [null=p1-walk, B=p2-walk (âncora
    // da p1), B=p2-componente com a âncora B — é a página onde pousou].
    expect(cursors).toEqual([null, CURSOR_B, CURSOR_B])
    // O walk normaliza a URL para a última página COM a âncora de cursor dela
    // (o seek da p2 num futuro reload é direto, sem novo walk).
    expect(window.location.search).toContain("pagina=2")
    expect(window.location.search).toContain(`cursor=${CURSOR_B}`)
    expect(window.location.search).not.toContain("pagina=3")
  })

  it("pagina inválida cai na página 1 sem walk", async () => {
    window.history.replaceState(null, "", "/?pagina=abc")
    await renderVitrine()

    // [p1 (null), prefetch da p2 com a âncora B semeada pela resposta da p1]
    expect(fetchCalls().map((c) => c.cursor)).toEqual([null, CURSOR_B])
    expect(window.location.search).not.toContain("pagina")
  })

  it("Próxima usa pushState (navegação real) e a âncora semeada", async () => {
    setPages({ 1: page(9, CURSOR_B), 2: page(9, CURSOR_C) })
    // A p1 tem continuação: a queryFn semeia a âncora da p2 com o nextCursor.
    h.responsesByCursor.set(null, [page(9, CURSOR_B)])
    window.history.replaceState(null, "", "/")
    await renderVitrine()

    const btn = screen.getByTestId("go-next")
    await act(async () => {
      btn.click()
      await Promise.resolve()
    })

    expect(window.history.length).toBeGreaterThan(1)
    expect(window.location.search).toContain("pagina=2")
    // O clique monta a p2 e encontra o CACHE QUENTE (prefetch com a âncora
    // semeada pela p1): nenhum request da p2. A 3ª chamada é o prefetch da
    // p3, disparado pela CHEGADA à p2 — sempre uma página à frente.
    expect(fetchCalls().map((c) => c.cursor)).toEqual([null, CURSOR_B, CURSOR_C])
  })

  it("prefetch da p2: dispara com a âncora semeada, não cascateia e semeia a p3", async () => {
    setPages({ 1: page(9, CURSOR_B), 2: page(9, CURSOR_C), 3: page(9, null) })
    h.responsesByCursor.set(null, [page(9, CURSOR_B)])
    h.responsesByCursor.set(CURSOR_B, [page(9, CURSOR_C)])
    window.history.replaceState(null, "", "/")
    await renderVitrine()

    // Página 1 chegou com hasMore: prefetch da p2 com a âncora B — e APENAS
    // ele (a resposta do prefetch tem hasMore=true e NÃO dispara p3: o
    // efeito só observa a query montada). Chaves distintas: re-renders podem
    // re-executar o effect, mas cache quente não refaz request.
    const prefetchedPages = [...new Set(h.prefetchCalls.map((o: any) => o.queryKey[2]))]
    expect(prefetchedPages).toEqual([2])
    expect(fetchCalls().map((c) => c.cursor)).toEqual([null, CURSOR_B])

    // Clique em Próxima: cache quente, nenhum request novo.
    await act(async () => {
      screen.getByTestId("go-next").click()
      await Promise.resolve()
    })
    expect(
      fetchCalls()
        .slice(0, 2)
        .map((c) => c.cursor),
    ).toEqual([null, CURSOR_B])

    // Segundo clique: a âncora da p3 foi semeada pela QUERYFN DO PREFETCH
    // (a queryFn do useQuery da p2 nunca rodou — cache hit). Sem esse seed,
    // a URL sairia sem cursor e a p3 seekaria com null (conteúdo errado).
    await act(async () => {
      screen.getByTestId("go-next").click()
      await Promise.resolve()
    })
    expect(window.location.search).toContain("pagina=3")
    expect(window.location.search).toContain(`cursor=${CURSOR_C}`)
    // p3 foi prefetched na chegada à p2; o clique em si não busca nada.
    expect(fetchCalls().map((c) => c.cursor)).toEqual([null, CURSOR_B, CURSOR_C])
  })

  it("hover em Próxima re-prefetch N+1 com a âncora correta (cache quente: nenhum request novo)", async () => {
    setPages({ 2: page(9, CURSOR_C) })
    window.history.replaceState(null, "", `/?pagina=2&cursor=${CURSOR_B}`)
    await renderVitrine()

    // [p2 seek com a âncora do link, load-prefetch da p3 com a âncora C]
    expect(fetchCalls().map((c) => c.cursor)).toEqual([CURSOR_B, CURSOR_C])
    const prefetchesBefore = h.prefetchCalls.length

    // Hover/focus/touch no botão real chamam onPrefetchNext (o stub dispara
    // o prop via click/pointerEnter). Com cache QUENTE o prefetch é no-op —
    // a queryFn não roda 2x (firedKeys espelha o TanStack): nenhum request
    // novo sai do hover em si.
    await act(async () => {
      screen.getByTestId("hover-next").click()
      await Promise.resolve()
    })
    expect(h.prefetchCalls.length).toBe(prefetchesBefore + 1)

    // O prefetch do hover carrega a MESMA chave/âncora: executar a queryFn
    // dele prova o cursor (o fetch abaixo é deste assert, não do hover).
    const hoverPrefetch = h.prefetchCalls[h.prefetchCalls.length - 1]
    expect(hoverPrefetch.queryKey[2]).toBe(3)
    const antes = fetchCalls().length
    await act(async () => {
      await hoverPrefetch.queryFn()
    })
    expect(fetchCalls()[antes].cursor).toBe(CURSOR_C)
    expect(fetchCalls().length).toBe(antes + 1)
  })

  it("hover em Anterior: pré-busca N-1 com a âncora em memória (e p1 com null)", async () => {
    setPages({ 1: page(9, CURSOR_B), 2: page(9, CURSOR_C), 3: page(9, null) })
    h.responsesByCursor.set(null, [page(9, CURSOR_B)])
    h.responsesByCursor.set(CURSOR_B, [page(9, CURSOR_C)])
    window.history.replaceState(null, "", "/")
    await renderVitrine()

    // Em p1 não há página anterior: hover não pré-busca nada.
    const antes = h.prefetchCalls.length
    await act(async () => {
      screen.getByTestId("hover-prev").click()
      await Promise.resolve()
    })
    expect(h.prefetchCalls.length).toBe(antes)

    // p1 → p2 → p3 (navegação real; âncoras 2=B e 3=C ficam em memória)
    await act(async () => {
      screen.getByTestId("go-next").click()
      await Promise.resolve()
    })
    await act(async () => {
      screen.getByTestId("go-next").click()
      await Promise.resolve()
    })
    expect(window.location.search).toContain("pagina=3")

    // Hover em Anterior: pré-busca da p2 com a âncora B (em memória desde a
    // visita à p1). Cache quente ⇒ o hover em si não faz request; executar a
    // queryFn do prefetch aqui prova o cursor (o fetch é deste assert).
    const before = h.prefetchCalls.length
    await act(async () => {
      screen.getByTestId("hover-prev").click()
      await Promise.resolve()
    })
    expect(h.prefetchCalls.length).toBe(before + 1)
    const hoverPrev = h.prefetchCalls[h.prefetchCalls.length - 1]
    expect(hoverPrev.queryKey[2]).toBe(2)
    const antes2 = fetchCalls().length
    await act(async () => {
      await hoverPrev.queryFn()
    })
    expect(fetchCalls()[antes2].cursor).toBe(CURSOR_B)
    expect(fetchCalls().length).toBe(antes2 + 1)
  })

  it("hover em Anterior SEM âncora de N-1 (deep-link direto): NÃO pré-busca", async () => {
    // Deep-link p3 COM cursor do link: seek direto (sem walk) — a âncora da
    // p2 não existe em memória (a p2 nunca foi visitada).
    setPages({ 3: page(9, CURSOR_C) })
    h.responsesByCursor.set(CURSOR_B, [page(9, CURSOR_C)])
    window.history.replaceState(null, "", `/?pagina=3&cursor=${CURSOR_B}`)
    await renderVitrine()

    // [p3 seek com a âncora do link, load-prefetch da p4 com a âncora C]
    expect(fetchCalls().map((c) => c.cursor)).toEqual([CURSOR_B, CURSOR_C])
    const before = h.prefetchCalls.length

    await act(async () => {
      screen.getByTestId("hover-prev").click()
      await Promise.resolve()
    })
    // Guarda anti-corrupção: sem âncora de p2, o hover NÃO pré-busca — seekar
    // p2 com cursor null traria o conteúdo da p1 rotulado como p2.
    expect(h.prefetchCalls.length).toBe(before)
    expect(fetchCalls().length).toBe(2)
  })

  it("Anterior após deep-link com cursor SEM âncora de N-1: walk reverso p1→p2", async () => {
    // Deep-link p3 com cursor do link: seek direto — a âncora da p2 não
    // existe (a p2 nunca foi visitada). O clique em Anterior NÃO seeka p2
    // com null (traria o conteúdo da p1 rotulado como p2): dispara o MESMO
    // walk do deep-link sem cursor e pousa na p2 com a âncora semeada.
    setPages({ 2: page(9, CURSOR_C), 3: page(9, CURSOR_C) })
    h.responsesByCursor.set(CURSOR_B, [page(9, CURSOR_C), page(9, CURSOR_C)])
    h.responsesByCursor.set(null, [page(9, CURSOR_B)])
    window.history.replaceState(null, "", `/?pagina=3&cursor=${CURSOR_B}`)
    await renderVitrine()

    // [p3 seek com a âncora do link, load-prefetch da p4 com a âncora C]
    expect(fetchCalls().map((c) => c.cursor)).toEqual([CURSOR_B, CURSOR_C])

    const measureSpy = vi.spyOn(performance, "measure")
    try {
      await act(async () => {
        screen.getByTestId("go-prev").click()
        for (let i = 0; i < 8; i++) await Promise.resolve()
      })

      const cursors = fetchCalls().map((c) => c.cursor)
      // [B seek p3, C prefetch p4, null p1 do walk, B remontagem da p2 pousada
      // com a âncora semeada pelo walk — o fetchQuery do walk semeia âncoras;
      // o TanStack real servia do cache, o mock refaz o fetch com a MESMA
      // âncora: conteúdo idêntico de qualquer forma]
      expect(cursors).toEqual([CURSOR_B, CURSOR_C, null, CURSOR_B])
      expect(window.location.search).toContain("pagina=2")
      expect(window.location.search).toContain(`cursor=${CURSOR_B}`)
      // O walk reverso fechou sua medida própria (User Timing).
      const walkMeasure = (measureSpy.mock.calls as unknown as [string, any][]).find(
        (c) => c[0] === "vitrine:walk:render",
      )
      expect(walkMeasure?.[1].detail).toMatchObject({ target: 2, kind: "walk-anterior" })

      // Retorno Próxima: sai do cache SEM pré-busca extra no walk — o pouso em
      // p2 já dispara o prefetch de N (com a âncora fresca) e a p3 de origem
      // está no cache desde o seek do deep-link; o hover cobre o vencido. Um
      // prefetch de N DURANTE o walk seria um 3º gatilho redundante.
      await act(async () => {
        screen.getByTestId("go-next").click()
        await Promise.resolve()
      })
      expect(fetchCalls().map((c) => c.cursor)).toEqual([CURSOR_B, CURSOR_C, null, CURSOR_B])
      expect(window.location.search).toContain("pagina=3")
    } finally {
      measureSpy.mockRestore()
    }
  })

  it("Anterior além do teto do walk (deep-link fundo sem âncora de N-1): botão desabilita", async () => {
    setPages({ 40: page(9, CURSOR_C) })
    h.responsesByCursor.set(CURSOR_B, [page(9, CURSOR_C)])
    window.history.replaceState(null, "", `/?pagina=40&cursor=${CURSOR_B}`)
    await renderVitrine()

    // [p40 seek com a âncora do link, load-prefetch da p41 com a âncora C]
    expect(fetchCalls().map((c) => c.cursor)).toEqual([CURSOR_B, CURSOR_C])

    // prev = 39 > MAX_WALK_TARGET (31) e sem âncora: o botão NEM habilita —
    // nada de seek com null nem de walk que não alcança o alvo.
    expect((screen.getByTestId("go-prev") as HTMLButtonElement).disabled).toBe(true)
    // O hover também se abstém (guarda do prefetch — hover não custa N fetches).
    const before = h.prefetchCalls.length
    await act(async () => {
      screen.getByTestId("hover-prev").click()
      await Promise.resolve()
    })
    expect(h.prefetchCalls.length).toBe(before)
  })

  it("instrumentação User Timing: pouso do deep-link por seek direto é medido", async () => {
    const measureSpy = vi.spyOn(performance, "measure")
    try {
      setPages({ 2: page(9, CURSOR_C) })
      window.history.replaceState(null, "", `/?pagina=2&cursor=${CURSOR_B}`)
      await renderVitrine()

      // Primeira carga ?pagina=N&cursor=X: seek direto, walked=false — do
      // relógio da hidratação da URL ao dado assentado. (warm depende da
      // ordem cache↔hidratação: o mock popula o cache no 1º render, antes
      // da microtask do applyUrl.)
      const deeplink = (measureSpy.mock.calls as unknown as [string, any][]).find(
        (c) => c[0] === "vitrine:deeplink:render",
      )
      expect(deeplink?.[1].detail).toMatchObject({
        target: 2,
        kind: "deeplink",
        walked: false,
      })
      // Nenhuma medida de clique antes de qualquer clique.
      expect(measureSpy.mock.calls.some((c) => c[0] === "vitrine:pagina:render")).toBe(false)
    } finally {
      measureSpy.mockRestore()
    }
  })

  it("instrumentação User Timing: clique em Próxima registra a medida de render", async () => {
    setPages({ 1: page(9, CURSOR_B), 2: page(9, CURSOR_C) })
    h.responsesByCursor.set(null, [page(9, CURSOR_B)])
    window.history.replaceState(null, "", "/")
    await renderVitrine()

    const measureSpy = vi.spyOn(performance, "measure")
    try {
      await act(async () => {
        screen.getByTestId("go-next").click()
        await Promise.resolve()
      })
      expect(measureSpy).toHaveBeenCalledTimes(1)
      const [name, opts] = measureSpy.mock.calls[0] as [string, any]
      expect(name).toBe("vitrine:pagina:render")
      // Cache quente (a p2 foi pré-buscada na chegada da p1) ⇒ warm=true;
      // a medida cobre do clique ao assentamento dos dados da página alvo.
      expect(opts.detail).toMatchObject({ target: 2, direction: "proxima", warm: true })
      expect(opts.end).toBeGreaterThanOrEqual(opts.start)
    } finally {
      measureSpy.mockRestore()
    }
  })

  it("popstate volta para a página 1 (back do browser rehidrata da URL)", async () => {
    window.history.replaceState(null, "", "/")
    await renderVitrine()

    await act(async () => {
      screen.getByTestId("go-next").click()
      await Promise.resolve()
    })
    expect(window.location.search).toContain("pagina=2")

    // Simula o back: URL regressa ao estado anterior e o browser emite popstate.
    window.history.replaceState(null, "", "/")
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"))
      for (let i = 0; i < 4; i++) await Promise.resolve()
    })

    expect(window.location.search).not.toContain("pagina")
    // O back rehidrata a p1 do CACHE (já está nele): nenhum request novo.
    expect(fetchCalls()).toHaveLength(2)
  })
})

// ===========================================================================
// Espelho: estado → URL
// ===========================================================================

describe("Vitrine — espelho de URL", () => {
  it("filtro muda: página reseta e ?pagina sai da URL", async () => {
    // Deep-link página 4 COM âncora válida (seek direto, sem walk).
    window.history.replaceState(
      null,
      "",
      `/ ?q=jardineiro&pagina=4&cursor=${CURSOR_B}`.replace(" ", ""),
    )
    setPages({ 4: page(9, null) })
    await renderVitrine()
    expect(window.location.search).toContain("pagina=4")

    await act(async () => {
      screen.getByTestId("chg-filters").click()
      for (let i = 0; i < 3; i++) await Promise.resolve()
    })

    expect(window.location.search).toBe("?q=jardineiro&verificados=1")
    expect(window.location.search).not.toContain("pagina")
    expect(window.location.search).not.toContain("cursor")
  })

  it("nunca escreve lat/lng na URL (privacidade)", async () => {
    setGeo({ lat: -19.76, lng: -42.15 })
    window.history.replaceState(null, "", "/?q=encanador")
    await renderVitrine()

    await act(async () => {
      screen.getByTestId("chg-filters").click()
      for (let i = 0; i < 3; i++) await Promise.resolve()
    })

    expect(window.location.search).not.toContain("lat=")
    expect(window.location.search).not.toContain("lng=")
  })
})

// ===========================================================================
// SSR-safety
// ===========================================================================

describe("Vitrine — SSR-safe", () => {
  it("renders the default shell without throwing", async () => {
    window.history.replaceState(null, "", "/")
    await renderVitrine()
    expect(screen.getByTestId("topbar")).toBeTruthy()
    expect(screen.getByTestId("results")).toBeTruthy()
    cleanup()
  })
})
