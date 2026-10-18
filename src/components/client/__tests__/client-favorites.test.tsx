/**
 * Tests for ClientFavorites — favorite providers panel for clients.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

// ---- Hoisted shared mocks --------------------------------------------------
const {
  mockNavigate,
  mockOpenProvider,
  mockOpenBooking,
  mockOpenQuote,
  mockFetchFavorites,
  mockToggleFavorite,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockOpenProvider: vi.fn(),
  mockOpenBooking: vi.fn(),
  mockOpenQuote: vi.fn(),
  mockFetchFavorites: vi.fn(),
  mockToggleFavorite: vi.fn(),
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
        openProvider: ReturnType<typeof vi.fn>
        openBooking: ReturnType<typeof vi.fn>
        openQuote: ReturnType<typeof vi.fn>
      }) => unknown,
    ) => {
      const state = {
        openProvider: mockOpenProvider,
        openBooking: mockOpenBooking,
        openQuote: mockOpenQuote,
      }
      return selector ? selector(state) : state
    },
  ),
}))

vi.mock("@/lib/api", () => ({
  fetchFavorites: mockFetchFavorites,
  toggleFavorite: mockToggleFavorite,
}))

vi.mock("@/lib/format", () => ({
  formatBRL: vi.fn(
    (v: number) => `R$ ${(v / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
  ),
  formatDate: vi.fn(() => "26/09/2026"),
}))

vi.mock("@/lib/geo-client", () => ({
  formatDistance: vi.fn((km: number) => `${km.toFixed(1)} km`),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// ---- Sample data -----------------------------------------------------------

const mockProviders = [
  {
    id: "prov-1",
    name: "Carlos Silva",
    avatarUrl: "/avatars/carlos.jpg",
    verified: true,
    rating: 4.9,
    reviewCount: 32,
    city: "Governador Valadares",
    distanceKm: 2.4,
    bio: "Eletricista residencial e predial com 10 anos de experiência.",
    services: [
      { id: "s1", title: "Instalação de Tomadas", basePrice: 8000 },
      { id: "s2", title: "Troca de Disjuntor", basePrice: 15000 },
    ],
  },
  {
    id: "prov-2",
    name: "Mariana Santos",
    avatarUrl: null,
    verified: false,
    rating: 4.7,
    reviewCount: 15,
    city: "Governador Valadares",
    distanceKm: 4.1,
    bio: "Pintora profissional especializada em texturas e fino acabamento.",
    services: [{ id: "s3", title: "Pintura Interna", basePrice: 25000 }],
  },
]

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ClientFavorites } from "../client-favorites"

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

// ---- Test suite ------------------------------------------------------------

describe("ClientFavorites", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchFavorites.mockResolvedValue(mockProviders)
    mockToggleFavorite.mockResolvedValue({ favorited: false })
  })

  afterEach(() => {
    cleanup()
  })

  it("renders loading indicator while favorites query is pending", async () => {
    mockFetchFavorites.mockReturnValue(new Promise(() => {}))
    renderWithClient(<ClientFavorites />)

    expect(screen.getByText(/Carregando favoritos/i)).toBeInTheDocument()
  })

  it("renders empty state when client has no saved favorites", async () => {
    mockFetchFavorites.mockResolvedValue([])
    renderWithClient(<ClientFavorites />)

    await waitFor(() => {
      expect(screen.getByText("Você ainda não tem favoritos")).toBeInTheDocument()
    })

    const searchButtons = screen.getAllByRole("button", { name: /Buscar prestadores/i })
    expect(searchButtons.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(searchButtons[searchButtons.length - 1])
    expect(mockNavigate).toHaveBeenCalledWith("client.providers")
  })

  it("renders Hero banner, StatCards and favorites cards when items exist", async () => {
    renderWithClient(<ClientFavorites />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Silva")).toBeInTheDocument()
    })

    // Hero banner
    expect(screen.getByText("Seus Profissionais de Confiança")).toBeInTheDocument()

    // StatCards
    expect(screen.getByText("Prestadores Salvos")).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.getByText("Verificados")).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
    expect(screen.getByText("Nota Média")).toBeInTheDocument()
    expect(screen.getByText("4.8 ★")).toBeInTheDocument()

    // Providers
    expect(screen.getByText("Carlos Silva")).toBeInTheDocument()
    expect(screen.getByText("Mariana Santos")).toBeInTheDocument()
    expect(screen.getByText("Verificado")).toBeInTheDocument()
    expect(screen.getByText("2 serviços")).toBeInTheDocument()
    expect(screen.getByText("1 serviço")).toBeInTheDocument()
    expect(screen.getByText("A partir de R$ 80,00")).toBeInTheDocument()
  })

  it("navigates to provider profile when clicking provider avatar or name", async () => {
    renderWithClient(<ClientFavorites />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Silva")).toBeInTheDocument()
    })

    // Click provider name
    fireEvent.click(screen.getByText("Carlos Silva"))
    expect(mockOpenProvider).toHaveBeenCalledWith("prov-1")

    // Click provider avatar button
    const avatarBtn = screen.getByRole("button", { name: /Ver perfil de Carlos Silva/i })
    fireEvent.click(avatarBtn)
    expect(mockOpenProvider).toHaveBeenCalledWith("prov-1")
  })

  it("routes message button directly to in-platform messages (zero WhatsApp leak)", async () => {
    renderWithClient(<ClientFavorites />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Silva")).toBeInTheDocument()
    })

    const messageButtons = screen.getAllByRole("button", { name: /Mensagem/i })
    fireEvent.click(messageButtons[0])

    expect(mockNavigate).toHaveBeenCalledWith("client.messages", { providerId: "prov-1" })
  })

  it("opens quote modal when clicking Orçamento button", async () => {
    renderWithClient(<ClientFavorites />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Silva")).toBeInTheDocument()
    })

    const quoteButtons = screen.getAllByRole("button", { name: /Orçamento/i })
    fireEvent.click(quoteButtons[0])

    expect(mockOpenQuote).toHaveBeenCalledWith({ providerId: "prov-1" })
  })

  it("opens booking modal when clicking Agendar button", async () => {
    renderWithClient(<ClientFavorites />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Silva")).toBeInTheDocument()
    })

    const bookButtons = screen.getAllByRole("button", { name: /Agendar/i })
    fireEvent.click(bookButtons[0])

    expect(mockOpenBooking).toHaveBeenCalledWith({ providerId: "prov-1", serviceId: undefined })
  })

  it("filters favorites by search text in real time", async () => {
    renderWithClient(<ClientFavorites />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Silva")).toBeInTheDocument()
      expect(screen.getByText("Mariana Santos")).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/Filtrar por nome, serviço ou bairro/i)
    fireEvent.change(searchInput, { target: { value: "Pintura" } })

    expect(screen.queryByText("Carlos Silva")).not.toBeInTheDocument()
    expect(screen.getByText("Mariana Santos")).toBeInTheDocument()
  })

  it("shows empty search state when no favorites match filter and clears search", async () => {
    renderWithClient(<ClientFavorites />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Silva")).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/Filtrar por nome, serviço ou bairro/i)
    fireEvent.change(searchInput, { target: { value: "Inexistente" } })

    expect(screen.getByText("Nenhum favorito encontrado")).toBeInTheDocument()

    const clearButton = screen.getByRole("button", { name: /Limpar filtro/i })
    fireEvent.click(clearButton)

    expect(screen.getByText("Carlos Silva")).toBeInTheDocument()
    expect(screen.getByText("Mariana Santos")).toBeInTheDocument()
  })

  it("handles remove favorite with toggleFavorite mutation", async () => {
    renderWithClient(<ClientFavorites />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Silva")).toBeInTheDocument()
    })

    const removeButtons = screen.getAllByRole("button", { name: /Remover dos favoritos/i })
    fireEvent.click(removeButtons[0])

    await waitFor(() => {
      expect(mockToggleFavorite).toHaveBeenCalledWith("prov-1")
    })
  })

  it("passes accessibility checks with 0 axe violations", async () => {
    const { container } = renderWithClient(<ClientFavorites />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Silva")).toBeInTheDocument()
    })

    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
