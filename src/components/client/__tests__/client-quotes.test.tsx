/**
 * Tests for ClientQuotes — in-panel quote request management for clients.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import { formatTransparentQuoteNote } from "@/lib/materials-breakdown"

// ---- Hoisted shared mocks --------------------------------------------------
const { mockNavigate, mockOpenProvider, mockOpenQuote, mockOpenBooking } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockOpenProvider: vi.fn(),
  mockOpenQuote: vi.fn(),
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
        openQuote: ReturnType<typeof vi.fn>
        openBooking: ReturnType<typeof vi.fn>
      }) => unknown,
    ) => {
      const state = {
        openProvider: mockOpenProvider,
        openQuote: mockOpenQuote,
        openBooking: mockOpenBooking,
      }
      return selector ? selector(state) : state
    },
  ),
}))

const mockQuotes = [
  {
    id: "quote-1",
    status: "RESPONDED",
    address: "Avenida Paulista, 1000",
    cep: "01310-100",
    createdAt: "2026-10-18T08:00:00.000Z",
    expiresAt: "2026-10-25T18:00:00.000Z",
    provider: {
      id: "prov-1",
      name: "Carlos Encanador",
      avatarUrl: "/avatars/carlos.jpg",
    },
    items: [
      {
        id: "item-1",
        serviceId: "srv-1",
        description: "Troca de sifão e desentupimento",
        quantity: 1,
        unit: "UNIDADE",
        price: 180,
        providerNote: formatTransparentQuoteNote(
          {
            laborCost: 130,
            materialsCost: 50,
            payer: "CLIENT",
            materials: [
              {
                id: "mat-1",
                name: "Sifão cromado",
                quantity: 1,
                unit: "UN",
                estimatedPrice: 50,
              },
            ],
          },
          "Serviço com garantia.",
        ),
        status: "QUOTED",
        service: {
          id: "srv-1",
          title: "Desentupimento e Troca de Sifão",
        },
        provider: {
          id: "prov-1",
          name: "Carlos Encanador",
          avatarUrl: "/avatars/carlos.jpg",
        },
      },
    ],
  },
  {
    id: "quote-2",
    status: "APPROVED",
    address: "Rua Augusta, 500",
    cep: "01305-000",
    createdAt: "2026-10-17T14:30:00.000Z",
    expiresAt: "2026-10-24T18:00:00.000Z",
    provider: {
      id: "prov-2",
      name: "Mariana Santos",
      avatarUrl: null,
    },
    items: [
      {
        id: "item-2",
        serviceId: "srv-2",
        description: "Instalação de torneira monocomando",
        quantity: 1,
        unit: "UNIDADE",
        price: 120,
        providerNote: "Material fornecido pelo cliente.",
        status: "ACCEPTED",
        service: {
          id: "srv-2",
          title: "Instalação Hidráulica",
        },
        provider: {
          id: "prov-2",
          name: "Mariana Santos",
          avatarUrl: null,
        },
      },
    ],
  },
  {
    id: "quote-3",
    status: "PENDING",
    address: "Alameda Santos, 200",
    cep: "01418-000",
    createdAt: "2026-10-18T09:15:00.000Z",
    expiresAt: "2026-10-20T18:00:00.000Z",
    provider: {
      id: "prov-3",
      name: "Roberto Eletricista",
      avatarUrl: null,
    },
    items: [
      {
        id: "item-3",
        serviceId: "srv-3",
        description: "Revisão do quadro elétrico",
        quantity: 1,
        unit: "HORA",
        price: null,
        providerNote: null,
        status: "PENDING",
        service: {
          id: "srv-3",
          title: "Revisão Elétrica",
        },
        provider: {
          id: "prov-3",
          name: "Roberto Eletricista",
          avatarUrl: null,
        },
      },
    ],
  },
]

let currentApiQuotes = [...mockQuotes]

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn((url: string, params?: { page?: number }) => {
    if (url === "/api/quotes") {
      if (params?.page && params.page > 1) {
        return Promise.resolve({
          items: [],
          total: currentApiQuotes.length,
          page: params.page,
          limit: 50,
        })
      }
      return Promise.resolve({
        items: currentApiQuotes,
        total: currentApiQuotes.length,
        page: 1,
        limit: 50,
      })
    }
    return Promise.resolve({})
  }),
  apiPatch: vi.fn((url: string, body: Record<string, unknown>) => {
    return Promise.resolve({ success: true, url, body })
  }),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

// Mock TransparentQuoteModal to verify breakdown trigger
vi.mock("@/components/shared/transparent-quote-modal", () => ({
  TransparentQuoteModal: ({
    open,
    onOpenChange,
    serviceTitle,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    serviceTitle?: string
  }) =>
    open ? (
      <div data-testid="mock-transparent-modal">
        <span>Transparent Modal: {serviceTitle}</span>
        <button onClick={() => onOpenChange(false)}>Fechar</button>
      </div>
    ) : null,
}))

// Mock QuoteTimeline
vi.mock("@/components/shared/flow-timeline", () => ({
  QuoteTimeline: ({ status }: { status: string }) => (
    <div data-testid="mock-quote-timeline">Timeline Status: {status}</div>
  ),
}))

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ClientQuotes } from "../client-quotes"

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
  currentApiQuotes = [...mockQuotes]
})

afterEach(cleanup)

describe("ClientQuotes — rendering and structure", () => {
  it("renders hero banner with title, badges and action buttons", async () => {
    renderWithClient(<ClientQuotes />)
    expect(screen.getByText("Orçamentos")).toBeDefined()
    expect(screen.getByText("Cotações Inteligentes & Orçamento Transparente")).toBeDefined()
    expect(
      screen.getByText("Acompanhe as cotações que você solicitou e aprove a melhor oferta."),
    ).toBeDefined()

    const newQuoteBtn = screen.getByRole("button", { name: /Pedir orçamento/i })
    const searchProvidersBtn = screen.getByRole("button", { name: /Buscar prestadores/i })

    expect(newQuoteBtn).toBeDefined()
    expect(searchProvidersBtn).toBeDefined()

    fireEvent.click(newQuoteBtn)
    expect(mockOpenQuote).toHaveBeenCalledTimes(1)

    fireEvent.click(searchProvidersBtn)
    expect(mockNavigate).toHaveBeenCalledWith("client.providers")
  })

  it("renders status tabs with accurate counters", async () => {
    renderWithClient(<ClientQuotes />)
    await waitFor(() => {
      expect(screen.getByText("Todos")).toBeDefined()
      expect(screen.getByText("Pendentes")).toBeDefined()
      expect(screen.getByText("Respondidos")).toBeDefined()
      expect(screen.getByText("Aprovados")).toBeDefined()
    })
  })

  it("renders quote cards with provider details, round avatars and prices", async () => {
    renderWithClient(<ClientQuotes />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
      expect(screen.getByText("Mariana Santos")).toBeDefined()
      expect(screen.getByText("Roberto Eletricista")).toBeDefined()
    })

    // Responded quote shows formatted price R$ 180,00
    expect(screen.getByText(/180,00/)).toBeDefined()
    // Approved quote shows R$ 120,00
    expect(screen.getByText(/120,00/)).toBeDefined()
    // Pending quote shows "Aguardando preços"
    expect(screen.getByText("Aguardando preços")).toBeDefined()
  })

  it("filters quotes when typing in search input", async () => {
    renderWithClient(<ClientQuotes />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
      expect(screen.getByText("Mariana Santos")).toBeDefined()
    })

    const searchInput = screen.getByPlaceholderText("Filtrar por prestador ou serviço...")
    fireEvent.change(searchInput, { target: { value: "Mariana" } })

    await waitFor(() => {
      expect(screen.getByText("Mariana Santos")).toBeDefined()
      expect(screen.queryByText("Carlos Encanador")).toBeNull()
      expect(screen.queryByText("Roberto Eletricista")).toBeNull()
    })
  })

  it("filters quotes by status tab", async () => {
    renderWithClient(<ClientQuotes />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })

    const pendingTab = screen.getByRole("button", { name: /Pendentes/i })
    fireEvent.click(pendingTab)

    await waitFor(() => {
      expect(screen.getByText("Roberto Eletricista")).toBeDefined()
      expect(screen.queryByText("Carlos Encanador")).toBeNull()
      expect(screen.queryByText("Mariana Santos")).toBeNull()
    })
  })

  it("opens provider profile modal when clicking provider card or name", async () => {
    renderWithClient(<ClientQuotes />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })

    const providerButton = screen.getByRole("button", { name: /Ver perfil de Carlos Encanador/i })
    fireEvent.click(providerButton)
    expect(mockOpenProvider).toHaveBeenCalledWith("prov-1")
  })

  it("navigates to in-platform client.messages without external WhatsApp links", async () => {
    renderWithClient(<ClientQuotes />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })

    const chatButtons = screen.getAllByTitle("Enviar mensagem na plataforma")
    expect(chatButtons.length).toBeGreaterThan(0)
    fireEvent.click(chatButtons[0])

    expect(mockNavigate).toHaveBeenCalledWith("client.messages", {
      with: "prov-3",
      peerId: "prov-3",
      providerId: "prov-3",
    })
  })

  it("approves quote and allows scheduling service", async () => {
    renderWithClient(<ClientQuotes />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })

    const approveButton = screen.getByRole("button", { name: /Aprovar orçamento/i })
    expect(approveButton).toBeDefined()
    fireEvent.click(approveButton)

    await waitFor(() => {
      expect(mockOpenBooking).toHaveBeenCalledWith({
        providerId: "prov-1",
        serviceId: "srv-1",
      })
    })
  })

  it("renders 'Agendar Atendimento' button on APPROVED quote", async () => {
    renderWithClient(<ClientQuotes />)
    await waitFor(() => {
      expect(screen.getByText("Mariana Santos")).toBeDefined()
    })

    const scheduleButton = screen.getByRole("button", { name: /Agendar Atendimento/i })
    expect(scheduleButton).toBeDefined()
    fireEvent.click(scheduleButton)

    expect(mockOpenBooking).toHaveBeenCalledWith({
      providerId: "prov-2",
      serviceId: "srv-2",
    })
  })

  it("shows transparent breakdown modal when clicking 'Ver Mão de Obra vs Materiais'", async () => {
    renderWithClient(<ClientQuotes />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })

    // Filter to Carlos Encanador to target his quote directly
    const searchInput = screen.getByPlaceholderText("Filtrar por prestador ou serviço...")
    fireEvent.change(searchInput, { target: { value: "Carlos" } })

    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
      expect(screen.queryByText("Roberto Eletricista")).toBeNull()
    })

    // Expand items collapsible for Carlos' quote
    const expandBtn = screen.getByRole("button", { name: /Ver 1 item detalhado/i })
    fireEvent.click(expandBtn)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ver Mão de Obra vs Materiais/i })).toBeDefined()
    })

    const breakdownBtn = screen.getByRole("button", { name: /Ver Mão de Obra vs Materiais/i })
    fireEvent.click(breakdownBtn)

    await waitFor(() => {
      expect(screen.getByTestId("mock-transparent-modal")).toBeDefined()
      expect(screen.getByText("Transparent Modal: Desentupimento e Troca de Sifão")).toBeDefined()
    })
  })

  it("renders 3-step value guide empty state when no quotes exist", async () => {
    currentApiQuotes = []
    renderWithClient(<ClientQuotes />)

    await waitFor(() => {
      expect(screen.getByText("Você ainda não tem orçamentos")).toBeDefined()
      expect(screen.getByText("Descreva o que precisa")).toBeDefined()
      expect(screen.getByText("Proposta Transparente")).toBeDefined()
      expect(screen.getByText("Garantia & Escrow")).toBeDefined()
    })

    const emptyPedirBtns = screen.getAllByRole("button", { name: /Pedir orçamento/i })
    expect(emptyPedirBtns.length).toBeGreaterThan(0)
    fireEvent.click(emptyPedirBtns[emptyPedirBtns.length - 1])
    expect(mockOpenQuote).toHaveBeenCalledTimes(1)
  })

  it("renders ultra-compact Bento StatCards", async () => {
    renderWithClient(<ClientQuotes />)

    await waitFor(() => {
      expect(screen.getByText("Aguardando Decisão")).toBeDefined()
      expect(screen.getByText("Em Análise")).toBeDefined()
      expect(screen.getByText("Aprovados / Total")).toBeDefined()
    })
  })

  it("allows toggling between list view and grid view", async () => {
    renderWithClient(<ClientQuotes />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Visualização em Grade" })).toBeDefined()
    })

    const gridBtn = screen.getByRole("button", { name: "Visualização em Grade" })
    const listBtn = screen.getByRole("button", { name: "Visualização em Lista" })

    expect(listBtn).toHaveAttribute("aria-pressed", "true")
    expect(gridBtn).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(gridBtn)
    expect(gridBtn).toHaveAttribute("aria-pressed", "true")
    expect(listBtn).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(listBtn)
    expect(listBtn).toHaveAttribute("aria-pressed", "true")
    expect(gridBtn).toHaveAttribute("aria-pressed", "false")
  })

  it("clears search filter when clicking X button", async () => {
    renderWithClient(<ClientQuotes />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/filtrar por prestador ou serviço/i)).toBeDefined()
    })

    const searchInput = screen.getByPlaceholderText(/filtrar por prestador ou serviço/i)
    fireEvent.change(searchInput, { target: { value: "Carlos" } })
    expect(searchInput).toHaveValue("Carlos")

    const clearBtn = screen.getByRole("button", { name: /limpar busca/i })
    fireEvent.click(clearBtn)
    expect(searchInput).toHaveValue("")
  })
})

describe("ClientQuotes — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderWithClient(<ClientQuotes />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
