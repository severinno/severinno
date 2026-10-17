import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

// ---- Hoisted shared mocks --------------------------------------------------
const { mockNavigate, mockOpenQuote, mockOpenBooking, mockOpenProvider } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockOpenQuote: vi.fn(),
  mockOpenBooking: vi.fn(),
  mockOpenProvider: vi.fn(),
}))

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn(
    (selector?: (s: { user: { id: string; name: string; role: string } | null }) => unknown) => {
      const state = { user: { id: "user-client-1", name: "Severino Teste", role: "CLIENT" } }
      return selector ? selector(state) : state
    },
  ),
}))

vi.mock("@/store/view", () => ({
  useViewStore: vi.fn(
    (
      selector?: (s: {
        navigate: ReturnType<typeof vi.fn>
        params: Record<string, unknown>
      }) => unknown,
    ) => {
      const state = { navigate: mockNavigate, params: {} }
      return selector ? selector(state) : state
    },
  ),
}))

vi.mock("@/store/ui", () => ({
  useUIStore: vi.fn(
    (
      selector?: (s: {
        openQuote: ReturnType<typeof vi.fn>
        openBooking: ReturnType<typeof vi.fn>
        openProvider: ReturnType<typeof vi.fn>
      }) => unknown,
    ) => {
      const state = {
        openQuote: mockOpenQuote,
        openBooking: mockOpenBooking,
        openProvider: mockOpenProvider,
      }
      return selector ? selector(state) : state
    },
  ),
}))

vi.mock("@/store/geo", () => ({
  useGeoStore: vi.fn(
    (
      selector?: (s: {
        lat: number
        lng: number
        district: string
        city: string
        status: string
        setFromGPS: ReturnType<typeof vi.fn>
      }) => unknown,
    ) => {
      const state = {
        lat: -18.854,
        lng: -41.954,
        district: "Ilha dos Araújos",
        city: "Governador Valadares",
        status: "ready",
        setFromGPS: vi.fn().mockResolvedValue(undefined),
      }
      return selector ? selector(state) : state
    },
  ),
}))

const mockProvidersData = {
  items: [
    {
      id: "prov-1",
      name: "Carlos Eletricista",
      avatarUrl: "/avatars/carlos.jpg",
      bio: "Instalações elétricas residenciais e comerciais com padrão CEMIG.",
      rating: 4.9,
      reviewCount: 38,
      verified: true,
      city: "Governador Valadares",
      district: "Centro",
      distanceKm: 1.2,
      services: [
        {
          id: "srv-1",
          title: "Instalação de Chuveiro",
          basePrice: 120,
          unit: "FIXED" as const,
        },
        {
          id: "srv-2",
          title: "Troca de Disjuntor",
          basePrice: 90,
          unit: "FIXED" as const,
        },
      ],
    },
    {
      id: "prov-2",
      name: "Mariana Pintora",
      avatarUrl: null,
      bio: "Pintura decorativa e restauração de fachadas.",
      rating: 4.8,
      reviewCount: 22,
      verified: true,
      city: "Governador Valadares",
      district: "Ilha dos Araújos",
      distanceKm: 0.5,
      services: [
        {
          id: "srv-3",
          title: "Pintura de Cômodo",
          basePrice: 350,
          unit: "FIXED" as const,
        },
      ],
    },
  ],
  total: 2,
  limit: 40,
  nextCursor: null,
  hasMore: false,
}

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn((url: string) => {
    if (url.includes("/api/categories")) {
      return Promise.resolve([
        { id: "cat-1", name: "Eletricista", slug: "eletricista" },
        { id: "cat-2", name: "Pintor", slug: "pintor" },
        { id: "cat-3", name: "Ar-Condicionado", slug: "ar-condicionado" },
      ])
    }
    return Promise.resolve({})
  }),
  fetchProviders: vi.fn().mockImplementation(() => Promise.resolve(mockProvidersData)),
  fetchFavorites: vi.fn().mockResolvedValue([]),
  toggleFavorite: vi.fn().mockResolvedValue({ favorited: true }),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ClientProviderSearch } from "../client-provider-search"

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe("ClientProviderSearch — rendering and basic structure", () => {
  it("renders page header and location context for Governador Valadares", async () => {
    renderWithClient(<ClientProviderSearch />)
    expect(screen.getByText("Buscar Prestadores")).toBeDefined()
    expect(
      screen.getByText(
        "Encontre profissionais avaliados e verificados próximos a você em Governador Valadares.",
      ),
    ).toBeDefined()
    expect(screen.getByText(/Ilha dos Araújos, Governador Valadares/)).toBeDefined()
  })

  it("renders search bar with input and placeholder", () => {
    renderWithClient(<ClientProviderSearch />)
    const searchInput = screen.getByPlaceholderText(
      "Buscar por eletricista, pintor, encanador, ar-condicionado ou nome...",
    )
    expect(searchInput).toBeDefined()
  })

  it("renders radius pills and sorting controls", () => {
    renderWithClient(<ClientProviderSearch />)
    expect(screen.getByText("5 km")).toBeDefined()
    expect(screen.getByText("10 km")).toBeDefined()
    expect(screen.getByText("25 km")).toBeDefined()
    expect(screen.getByText("50 km")).toBeDefined()
    expect(screen.getByText("Todos")).toBeDefined()
    expect(screen.getByText("Distância")).toBeDefined()
    expect(screen.getByText("Avaliação")).toBeDefined()
  })

  it("renders verified-only and min rating filter pills", () => {
    renderWithClient(<ClientProviderSearch />)
    expect(screen.getByText("Verificados")).toBeDefined()
    expect(screen.getByText("4.5+")).toBeDefined()
  })
})

describe("ClientProviderSearch — provider cards & actions", () => {
  it("displays provider cards with ratings, distance and starting prices", async () => {
    renderWithClient(<ClientProviderSearch />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Eletricista")).toBeDefined()
      expect(screen.getByText("Mariana Pintora")).toBeDefined()
    })

    expect(screen.getByText("Instalação de Chuveiro")).toBeDefined()
    expect(screen.getAllByText(/A partir de/).length).toBeGreaterThan(0)
    expect(screen.getByText(/120/)).toBeDefined()
    expect(screen.getByText("Atende no seu bairro (Ilha dos Araújos)")).toBeDefined()
  })

  it("calls openQuote when clicking 'Orçamento'", async () => {
    renderWithClient(<ClientProviderSearch />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Eletricista")).toBeDefined()
    })

    const quoteButtons = screen.getAllByRole("button", { name: "Orçamento" })
    fireEvent.click(quoteButtons[0])

    expect(mockOpenQuote).toHaveBeenCalledWith({ providerId: "prov-1" })
  })

  it("calls openBooking when clicking 'Agendar'", async () => {
    renderWithClient(<ClientProviderSearch />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Eletricista")).toBeDefined()
    })

    const bookButtons = screen.getAllByRole("button", { name: "Agendar" })
    fireEvent.click(bookButtons[0])

    expect(mockOpenBooking).toHaveBeenCalledWith({ providerId: "prov-1" })
  })

  it("calls openProvider when clicking provider title / card header", async () => {
    renderWithClient(<ClientProviderSearch />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Eletricista")).toBeDefined()
    })

    const providerTitle = screen.getByText("Carlos Eletricista")
    fireEvent.click(providerTitle)

    expect(mockOpenProvider).toHaveBeenCalledWith("prov-1")
  })

  it("calls navigate to client.messages when clicking message icon", async () => {
    renderWithClient(<ClientProviderSearch />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Eletricista")).toBeDefined()
    })

    const messageButtons = screen.getAllByTitle("Enviar mensagem")
    fireEvent.click(messageButtons[0])

    expect(mockNavigate).toHaveBeenCalledWith("client.messages", { providerId: "prov-1" })
  })
})

describe("ClientProviderSearch — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderWithClient(<ClientProviderSearch />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
