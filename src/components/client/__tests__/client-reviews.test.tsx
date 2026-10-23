/**
 * Tests for ClientReviews — in-panel reviews and reputation management for clients.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

// ---- Hoisted shared mocks --------------------------------------------------
const { mockNavigate, mockOpenProvider, mockOpenBooking } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockOpenProvider: vi.fn(),
  mockOpenBooking: vi.fn(),
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
      }) => unknown,
    ) => {
      const state = {
        openProvider: mockOpenProvider,
        openBooking: mockOpenBooking,
      }
      return selector ? selector(state) : state
    },
  ),
}))

const mockBookings = [
  {
    id: "booking-unreviewed-1",
    status: "COMPLETED",
    scheduledAt: "2026-10-17T15:00:00.000Z",
    amount: 180,
    service: {
      id: "srv-1",
      title: "Conserto de Caixa Acoplada",
    },
    provider: {
      id: "prov-1",
      name: "Carlos Encanador",
      avatarUrl: "/avatars/carlos.jpg",
    },
    reviews: [],
  },
  {
    id: "booking-reviewed-2",
    status: "COMPLETED",
    scheduledAt: "2026-10-10T10:30:00.000Z",
    amount: 120,
    service: {
      id: "srv-2",
      title: "Instalação de Chuveiro Elétrico",
    },
    provider: {
      id: "prov-2",
      name: "Mariana Santos",
      avatarUrl: null,
    },
    reviews: [
      {
        id: "rev-1",
        rating: 5,
        comment: "Excelente profissional! Chegou no horário e resolveu o problema rápido.",
        providerReply: "Muito obrigado pela confiança, Mariana!",
        providerReplyAt: "2026-10-10T14:00:00.000Z",
        createdAt: "2026-10-10T12:00:00.000Z",
      },
    ],
  },
]

let currentApiBookings = [...mockBookings]

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn((url: string) => {
    if (url === "/api/bookings") {
      return Promise.resolve({
        items: currentApiBookings,
        total: currentApiBookings.length,
        page: 1,
        limit: 50,
      })
    }
    return Promise.resolve({})
  }),
}))

// Mock ReviewDialog to verify open and close
vi.mock("@/components/client/review-dialog", () => ({
  ReviewDialog: ({
    open,
    onOpenChange,
    booking,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    booking: { id: string } | null
  }) =>
    open ? (
      <div data-testid="mock-review-dialog">
        <span>Modal Avaliar: {booking?.id}</span>
        <button onClick={() => onOpenChange(false)}>Fechar Modal</button>
      </div>
    ) : null,
}))

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ClientReviews } from "../client-reviews"

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
  currentApiBookings = [...mockBookings]
})

afterEach(cleanup)

describe("ClientReviews — rendering and structure", () => {
  it("renders hero banner with title, badges and quick actions", async () => {
    renderWithClient(<ClientReviews />)
    expect(screen.getByText("Avaliações")).toBeDefined()
    expect(screen.getByText("Ciclo de Confiança & Reputação")).toBeDefined()
    expect(
      screen.getByText(
        "Reconheça profissionais qualificados e ajude outros moradores a contratarem com segurança em Governador Valadares.",
      ),
    ).toBeDefined()

    const agendamentosBtn = screen.getByRole("button", { name: /Ver agendamentos/i })
    const buscarBtn = screen.getByRole("button", { name: /Buscar prestadores/i })

    expect(agendamentosBtn).toBeDefined()
    expect(buscarBtn).toBeDefined()

    fireEvent.click(agendamentosBtn)
    expect(mockNavigate).toHaveBeenCalledWith("client.bookings")

    fireEvent.click(buscarBtn)
    expect(mockNavigate).toHaveBeenCalledWith("client.providers")
  })

  it("renders metrics snapshot correctly (pending, submitted, average)", async () => {
    renderWithClient(<ClientReviews />)

    await waitFor(() => {
      expect(screen.getByText("5.0 ★")).toBeDefined()
    })

    expect(screen.getByText("Aguardando Avaliação")).toBeDefined()
    expect(screen.getByText("Avaliações Enviadas")).toBeDefined()
    expect(screen.getByText("Nota Média Concedida")).toBeDefined()
  })

  it("renders pending review card by default with 'Avaliar agora' action", async () => {
    renderWithClient(<ClientReviews />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
      expect(screen.getByText("Conserto de Caixa Acoplada")).toBeDefined()
      expect(screen.getByText("Aguardando sua avaliação")).toBeDefined()
    })

    const reviewNowBtn = screen.getByRole("button", { name: /Avaliar agora/i })
    expect(reviewNowBtn).toBeDefined()

    fireEvent.click(reviewNowBtn)
    expect(screen.getByTestId("mock-review-dialog")).toBeDefined()
    expect(screen.getByText("Modal Avaliar: booking-unreviewed-1")).toBeDefined()
  })

  it("triggers rebook and platform messages from pending card", async () => {
    renderWithClient(<ClientReviews />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })

    const rebookBtn = screen.getByRole("button", { name: /Contratar novamente/i })
    fireEvent.click(rebookBtn)
    expect(mockOpenBooking).toHaveBeenCalledWith({
      providerId: "prov-1",
      serviceId: "srv-1",
    })

    const messageBtn = screen.getByRole("button", { name: /Enviar mensagem na plataforma/i })
    fireEvent.click(messageBtn)
    expect(mockNavigate).toHaveBeenCalledWith("client.messages", {
      with: "prov-1",
      peerId: "prov-1",
      providerId: "prov-1",
    })
  })

  it("switches to 'Avaliações enviadas' tab and displays submitted review with provider reply", async () => {
    renderWithClient(<ClientReviews />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })

    const submittedTab = screen.getByRole("button", { name: /Avaliações enviadas/i })
    fireEvent.click(submittedTab)

    await waitFor(() => {
      expect(screen.getByText("Mariana Santos")).toBeDefined()
      expect(screen.getByText("Instalação de Chuveiro Elétrico")).toBeDefined()
      expect(
        screen.getByText(/Excelente profissional! Chegou no horário e resolveu o problema rápido/i),
      ).toBeDefined()
      expect(screen.getByText(/Muito obrigado pela confiança, Mariana!/i)).toBeDefined()
    })
  })

  it("filters items when typing in search input", async () => {
    renderWithClient(<ClientReviews />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })

    const searchInput = screen.getByPlaceholderText("Filtrar por prestador ou serviço...")
    fireEvent.change(searchInput, { target: { value: "Chuveiro" } })

    // "Chuveiro" is submitted, so in PENDING tab it shows empty
    await waitFor(() => {
      expect(screen.queryByText("Carlos Encanador")).toBeNull()
    })
  })

  it("opens provider profile modal when clicking provider avatar or name", async () => {
    renderWithClient(<ClientReviews />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })

    const providerBtn = screen.getByRole("button", { name: /Ver perfil de Carlos Encanador/i })
    fireEvent.click(providerBtn)
    expect(mockOpenProvider).toHaveBeenCalledWith("prov-1")
  })

  it("renders persuasive empty state when there are no bookings at all", async () => {
    currentApiBookings = []
    renderWithClient(<ClientReviews />)

    const allTab = screen.getByRole("button", { name: /Todos os atendimentos/i })
    fireEvent.click(allTab)

    await waitFor(() => {
      expect(screen.getByText("Você ainda não possui atendimentos concluídos")).toBeDefined()
      expect(screen.getByText("1")).toBeDefined()
      expect(screen.getByText("Contrate com Escrow")).toBeDefined()
      expect(screen.getByText("Receba com Qualidade")).toBeDefined()
      expect(screen.getByText("Avalie em 30s")).toBeDefined()
    })
  })

  it("toggles between List and Grid view modes with appropriate aria-pressed attributes", async () => {
    renderWithClient(<ClientReviews />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })

    const listBtn = screen.getByRole("button", { name: /Visualização em Lista/i })
    const gridBtn = screen.getByRole("button", { name: /Visualização em Grade/i })

    // Defaults to List mode
    expect(listBtn.getAttribute("aria-pressed")).toBe("true")
    expect(gridBtn.getAttribute("aria-pressed")).toBe("false")

    // Switch to Grid mode
    fireEvent.click(gridBtn)
    expect(gridBtn.getAttribute("aria-pressed")).toBe("true")
    expect(listBtn.getAttribute("aria-pressed")).toBe("false")

    // Switch back to List mode
    fireEvent.click(listBtn)
    expect(listBtn.getAttribute("aria-pressed")).toBe("true")
    expect(gridBtn.getAttribute("aria-pressed")).toBe("false")
  })

  it("clears search input when clicking the clear 'X' button", async () => {
    renderWithClient(<ClientReviews />)

    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })

    const searchInput = screen.getByPlaceholderText(
      "Filtrar por prestador ou serviço...",
    ) as HTMLInputElement
    fireEvent.change(searchInput, { target: { value: "Carlos" } })
    expect(searchInput.value).toBe("Carlos")

    const clearBtn = screen.getByRole("button", { name: /Limpar busca/i })
    fireEvent.click(clearBtn)
    expect(searchInput.value).toBe("")
  })
})

describe("ClientReviews — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderWithClient(<ClientReviews />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
