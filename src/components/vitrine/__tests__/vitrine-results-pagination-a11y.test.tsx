/**
 * vitrine-results-pagination-a11y.test.tsx
 *
 * Contrato de acessibilidade da troca de página da vitrine:
 *
 *   1. Ao TROCAR de página (definida → definida), o heading dos resultados
 *      ("N prestadores encontrados") recebe o foco programático (tabIndex=-1 —
 *      nunca na ordem de tab) com preventScroll, e a região viva assertiva
 *      anuncia "Página N de M — K prestadores".
 *   2. A CHEGADA assíncrona do primeiro valor de página (undefined → N) é
 *      carregamento, não navegação: NENHUM foco, NENHUM anúncio — o pouso por
 *      deep-link ?pagina=N não rouba foco nem anuncia a primeira pintura.
 *   3. Navegar para a MESMA página (definida → igual) não repete anúncio nem
 *      foco (o double-invoke de effect em dev não engana o ref).
 *   4. A região viva é SEMPRE ESTÁVEL no DOM (sempre montada enquanto a
 *      paginação existe; trocar o nó re-registra a região e engole o anúncio).
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import * as React from "react"
import { render, screen, cleanup } from "@/__tests__/test-utils"

// ── Mocks (padrão das suítes vizinhas: ícones + filhos fora do escopo) ──────
// Lista explícita: as importações do componente + as dos `ui/*` (XIcon do Sheet).
vi.mock("lucide-react", () => ({
  List: () => <span data-testid="icon" />,
  MapIcon: () => <span data-testid="icon" />,
  MapPin: () => <span data-testid="icon" />,
  SlidersHorizontal: () => <span data-testid="icon" />,
  SearchX: () => <span data-testid="icon" />,
  X: () => <span data-testid="icon" />,
  XIcon: () => <span data-testid="icon" />,
  Loader2: () => <span data-testid="icon" />,
}))
vi.mock("next/dynamic", () => ({
  default: () => () => <div data-testid="map-stub" />,
}))
vi.mock("../provider-card", () => ({
  default: ({ provider }: { provider: { id: string; name: string } }) => (
    <div data-provider-id={provider.id}>{provider.name}</div>
  ),
  ProviderCardSkeleton: () => <div data-testid="card-skeleton" />,
}))
vi.mock("../filters", () => ({
  default: () => <div data-testid="filters-stub" />,
  DEFAULT_FILTERS: {
    q: "",
    categoryId: null,
    radius: 15,
    sort: "rating",
    verifiedOnly: false,
    minRating: 0,
  },
}))

import VitrineResults from "../vitrine-results"
import type { ProviderCard as ProviderCardType } from "@/lib/api"
import { DEFAULT_FILTERS } from "../filters"

// ── Fixtures ────────────────────────────────────────────────────────────────
const provider = (i: number): ProviderCardType => ({
  id: `p${i}`,
  name: `Prestador ${i}`,
  rating: 4.5,
  reviewCount: 10,
  verified: true,
  services: [],
})
const base = {
  total: 415,
  isLoading: false,
  isFetching: false,
  error: null,
  filters: { ...DEFAULT_FILTERS },
  onFiltersChange: () => {},
  categories: [],
  favorites: new Set<string>(),
  userLat: null,
  userLng: null,
  hasGeo: false,
  onQuote: () => {},
  onBook: () => {},
  onView: () => {},
  onPrefetchNext: () => {},
  onPrefetchPrev: () => {},
  resultsAnchorId: "resultados",
}

const ui = (over: Record<string, unknown> = {}) => (
  <VitrineResults
    {...base}
    providers={[1, 2, 3].map(provider)}
    hasPrevPage={false}
    hasNextPage={true}
    currentPage={undefined}
    totalPages={47}
    filterUserKey="q||15|rating|0|0"
    {...over}
  />
)

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
})

// ── Contrato ────────────────────────────────────────────────────────────────
describe("acessibilidade da troca de resultados (VitrineResults)", () => {
  const ANUNCIO = 'p[role="alert"].sr-only'
  const HEADING = () => screen.getByRole("heading", { name: /prestadores encontrados/i })

  it("TROCA de página: foco no heading + anúncio quando os dados assentam", () => {
    const { rerender } = render(ui({ currentPage: undefined, hasNextPage: true, isLoading: false }))
    // Captura o NÓ do heading com dados (durante o carregamento ele mostra o
    // Skeleton e fica SEM nome acessível — mas a identidade do elemento
    // persiste entre rerenders, que é justamente o que o foco usa).
    const heading = HEADING()
    expect(heading).not.toHaveFocus()
    expect(document.querySelector(ANUNCIO)).toHaveTextContent("") // região ociosa

    // undefined → 2: chegada do primeiro valor — carregamento, sem anúncio.
    rerender(ui({ currentPage: 2, hasNextPage: true, isLoading: true }))
    expect(heading).not.toHaveFocus()
    expect(document.querySelector(ANUNCIO)).toHaveTextContent("")

    // 2 → 3 com fetch EM CURSO: gatilho registrado, NADA anuncia ainda.
    rerender(ui({ currentPage: 3, hasNextPage: true, isLoading: true }))
    expect(heading).not.toHaveFocus()
    expect(document.querySelector(ANUNCIO)).toHaveTextContent("")

    // Dados assentam (isLoading false): foco + anúncio UMA vez.
    rerender(ui({ currentPage: 3, hasNextPage: true, isLoading: false }))
    expect(heading).toHaveFocus()
    expect(document.querySelector(ANUNCIO)).toHaveTextContent("Página 3 de 47 — 3 prestadores")
  })

  it("TROCA de busca/filtro (filterUserKey muda): anuncia re-renderização, não página", () => {
    const { rerender } = render(
      ui({
        currentPage: 4,
        hasPrevPage: true,
        hasNextPage: true,
        filterUserKey: "q||15|rating|0|0",
      }),
    )
    const heading = HEADING() // nó capturado com dados; sobrevive aos rerenders
    // O pouso na p4 por deep-link é carregamento: gatilho nenhum registrado.
    expect(document.querySelector(ANUNCIO)).toHaveTextContent("")

    // Usuário digita/busca: composição muda (2 prestadores no novo dataset) e
    // a query entra em carregamento.
    rerender(
      ui({
        currentPage: 1,
        hasPrevPage: false,
        providers: [1, 2].map(provider),
        isLoading: true,
        filterUserKey: "eletricista||15|rating|0|0",
      }),
    )
    expect(heading).not.toHaveFocus()
    expect(document.querySelector(ANUNCIO)).toHaveTextContent("")

    // Dados assentam: o anúncio é da COMPOSIÇÃO (não "Página 1").
    rerender(
      ui({
        currentPage: 1,
        hasPrevPage: false,
        providers: [1, 2].map(provider),
        isLoading: false,
        filterUserKey: "eletricista||15|rating|0|0",
      }),
    )
    expect(heading).toHaveFocus()
    expect(document.querySelector(ANUNCIO)).toHaveTextContent(
      "Resultados atualizados — 2 prestadores encontrados",
    )
  })

  it("tranco do slider (composição IGUAL entre renders) não anuncia", () => {
    const { rerender } = render(
      ui({
        currentPage: 1,
        hasPrevPage: true,
        hasNextPage: true,
        filterUserKey: "q|cat1|30|rating|0|0",
      }),
    )
    rerender(
      ui({
        currentPage: 1,
        hasPrevPage: true,
        hasNextPage: true,
        filterUserKey: "q|cat1|30|rating|0|0",
      }),
    )
    expect(document.querySelector(ANUNCIO)).toHaveTextContent("")
    expect(HEADING()).not.toHaveFocus()
  })

  it("MESMA página (definida → igual) não repete foco nem anúncio", () => {
    const { rerender } = render(ui({ currentPage: undefined, hasNextPage: true }))
    rerender(ui({ currentPage: 2, hasNextPage: true, isLoading: false }))
    const antes = document.querySelector(ANUNCIO)?.textContent

    const focusCalls: Element[] = []
    const spy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      focusCalls.push(this)
      Object.getPrototypeOf(HTMLElement.prototype).focus.call(this, options)
    })
    try {
      rerender(ui({ currentPage: 2, hasNextPage: true, isLoading: false }))
    } finally {
      spy.mockRestore()
    }
    expect(focusCalls).toEqual([])
    expect(document.querySelector(ANUNCIO)?.textContent).toBe(antes)
  })

  it("a região viva é SEMPRE estável no DOM — mesmo quando a paginação some", () => {
    const { rerender } = render(ui({ currentPage: 5, hasPrevPage: true, hasNextPage: true }))
    const regiao = document.querySelector(ANUNCIO)
    expect(regiao?.getAttribute("aria-live")).toBe("assertive")
    expect(regiao?.getAttribute("aria-atomic")).toBe("true")

    // Troca de filtro esvazia o dataset: sem Anterior nem Próxima — a região
    // de anúncio NÃO pode morrer junto com o nav.
    rerender(ui({ currentPage: 1, hasPrevPage: false, hasNextPage: false }))
    expect(document.querySelector(ANUNCIO)).toBe(regiao) // MESMO nó
    // O contador educado da paginação (role="status") some junto com o nav.
    expect(screen.queryByRole("status")).toBeNull()
  })
})
