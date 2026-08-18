/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen } from "@/__tests__/test-utils"

import { SearchPage } from "../search-page"

// SearchPage é uma rota real implementada (src/app/busca/search-page.tsx).
// O ProviderCard é mockado para isolar a página de busca dos detalhes de
// renderização do card — o mock renderiza o shape real de ProviderCard
// (name/services/category) para as asserções de texto.

const { mockUseSearchParams, mockUseQuery } = vi.hoisted(() => ({
  mockUseSearchParams: vi.fn().mockReturnValue(new URLSearchParams("")),
  mockUseQuery: vi.fn().mockReturnValue({ data: undefined, isLoading: false }),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => mockUseSearchParams(),
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: mockUseQuery,
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ items: [], q: "" }),
}))

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    h1: ({ children, ...p }: any) => <h1 {...p}>{children}</h1>,
    p: ({ children, ...p }: any) => <p {...p}>{children}</p>,
    span: ({ children, ...p }: any) => <span {...p}>{children}</span>,
    section: ({ children, ...p }: any) => <section {...p}>{children}</section>,
    a: ({ children, ...p }: any) => <a {...p}>{children}</a>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/components/vitrine/provider-card", () => ({
  // O componente faz `import ProviderCard, { ProviderCardSkeleton }` — o mock
  // precisa do export DEFAULT (o erro "No default export is defined" vinha da
  // falta dele). Renderiza o shape real de ProviderCard para as asserções.
  default: ({ provider }: any) => (
    <div data-testid="mock-provider-card">
      <h3>{provider.name}</h3>
      {provider.services?.map((s: any) => (
        <div key={s.id}>
          <p>{s.title}</p>
          <p>a partir de R$ {Number(s.basePrice).toFixed(2).replace(".", ",")}</p>
          <p>{s.category?.name}</p>
        </div>
      ))}
    </div>
  ),
  ProviderCardSkeleton: () => <div data-testid="skeleton">Carregando…</div>,
}))

afterEach(cleanup)

describe("SearchPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSearchParams.mockReturnValue(new URLSearchParams(""))
    // First call (categories) returns empty array; subsequent calls (search) return undefined
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      if (opts.queryKey?.[0] === "search-categories") {
        return { data: [], isLoading: false }
      }
      return { data: undefined, isLoading: false }
    })
  })

  it("renders the search page hero title", () => {
    render(<SearchPage />)
    expect(screen.getByText("O que você precisa?")).toBeDefined()
  })

  it("shows prompt when no query is provided", () => {
    render(<SearchPage />)
    expect(
      screen.getByText(
        "Digite o que você está procurando acima para encontrar os melhores profissionais perto de você.",
      ),
    ).toBeDefined()
  })

  it("shows loading state when query is provided and loading", () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams("q=teste"))
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      if (opts.queryKey?.[0] === "search-categories") {
        return { data: [], isLoading: false }
      }
      return { data: undefined, isLoading: true }
    })
    render(<SearchPage />)
    expect(screen.getByDisplayValue("teste")).toBeDefined()
  })

  it("shows no results message when query returns empty", () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams("q=teste"))
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      if (opts.queryKey?.[0] === "search-categories") {
        return { data: [], isLoading: false }
      }
      return { data: { items: [], q: "teste" }, isLoading: false }
    })
    render(<SearchPage />)
    expect(screen.getByText("Nenhum resultado encontrado")).toBeDefined()
  })

  it("shows results when data is returned", () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams("q=encanador"))
    const mockResult = {
      id: "1",
      name: "João Encanador",
      avatarUrl: null,
      coverUrl: null,
      bio: null,
      rating: 4.5,
      reviewCount: 10,
      verified: true,
      city: "São Paulo",
      state: "SP",
      services: [
        {
          id: "s1",
          title: "Encanador Experiente",
          basePrice: 150,
          unit: "UNIDADE",
          category: { id: "cat-1", name: "Encanamento", slug: "encanamento" },
        },
      ],
    }
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      if (opts.queryKey?.[0] === "search-categories") {
        return { data: [], isLoading: false }
      }
      return { data: { items: [mockResult], q: "encanador" }, isLoading: false }
    })
    render(<SearchPage />)
    expect(screen.getByText("João Encanador")).toBeDefined()
    expect(screen.getByText("Encanador Experiente")).toBeDefined()
    expect(screen.getByText("a partir de R$ 150,00")).toBeDefined()
    expect(screen.getByText("Encanamento")).toBeDefined()
  })
})
