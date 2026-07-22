import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { SearchPage } from "../search-page"

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
  ProviderCard: () => null,
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
      screen.getByText("Digite o que você está procurando acima para encontrar os melhores profissionais perto de você."),
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
      title: "Encanador Experiente",
      description: null,
      basePrice: 150,
      unit: "UNIT",
      categoryId: "cat-1",
      category: { id: "cat-1", name: "Encanamento", slug: "encanamento" },
      provider: {
        id: "p1",
        name: "João Encanador",
        avatarUrl: null,
        city: "São Paulo",
        state: "SP",
        verified: true,
        rating: 4.5,
      },
      rank: 1,
    }
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      if (opts.queryKey?.[0] === "search-categories") {
        return { data: [], isLoading: false }
      }
      return { data: { items: [mockResult], q: "encanador" }, isLoading: false }
    })
    render(<SearchPage />)
    expect(screen.getByText("Encanador Experiente")).toBeDefined()
    expect(screen.getByText("João Encanador")).toBeDefined()
    expect(screen.getByText("a partir de R$ 150,00")).toBeDefined()
    expect(screen.getByText("Encanamento")).toBeDefined()
  })
})
