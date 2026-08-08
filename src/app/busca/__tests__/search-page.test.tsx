import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import { SearchPage } from "../search-page"

// SearchPage tests are sketched out but the component hasn't been
// implemented yet. The stub in search-page.tsx returns null, so
// these tests are temporarily skipped with a placeholder assertion.
// Remove this outer describe when the real component exists.

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

vi.mock("@/components/vitrine/provider-card", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/vitrine/provider-card")>()
  // provider-card exports ProviderCard as DEFAULT — the previous mock only
  // provided a named `ProviderCard`, which search-page never imports (so it
  // resolved to undefined and rendering crashed). Spread the real module and
  // override only the pieces this page uses.
  return {
    ...actual,
    default: () => null,
    ProviderCardSkeleton: () => <div data-testid="skeleton">Carregando…</div>,
  }
})

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
    // ProviderCard is stubbed to null (see vi.mock above), so assert the
    // page-level results UI that SearchPage itself renders: the result
    // counter and the results header line.
    // The h2 renders `{total} <span>resultado encontrado</span>` — match the
    // span's own text (singular form proves exactly 1 result).
    expect(screen.getByText("resultado encontrado")).toBeDefined()
    expect(screen.getByText(/Resultados para .*encanador/)).toBeDefined()
  })
})
