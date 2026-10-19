/**
 * Tests for ClientBookings — in-panel booking management for clients.
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
    id: "booking-1",
    status: "CANCELLED",
    scheduledAt: "2026-10-18T09:00:00.000Z",
    amount: 114,
    quantity: 1,
    unit: "UNIDADE",
    paymentMethod: "PIX",
    paymentStatus: "PENDING",
    address: "Avenida Paulista, 1000",
    cep: "01310-100",
    service: {
      id: "srv-1",
      title: "Desentupimento de ralo e pia",
      basePrice: 114,
      unit: "UNIDADE",
    },
    provider: {
      id: "prov-1",
      name: "Carlos Encanador",
      avatarUrl: "/avatars/carlos.jpg",
    },
    reviews: [],
  },
  {
    id: "booking-2",
    status: "COMPLETED",
    scheduledAt: "2026-09-26T19:48:00.000Z",
    amount: 120,
    quantity: 1,
    unit: "UNIDADE",
    paymentMethod: "PIX",
    paymentStatus: "PAID",
    address: "Avenida Paulista, 1000",
    cep: "01310-100",
    service: {
      id: "srv-2",
      title: "Conserto de Torneira",
      basePrice: 120,
      unit: "UNIDADE",
    },
    provider: {
      id: "prov-2",
      name: "Mariana Santos",
      avatarUrl: null,
    },
    reviews: [],
  },
]

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn((url: string, params?: { page?: number }) => {
    if (url === "/api/bookings") {
      if (params?.page && params.page > 1) {
        return Promise.resolve({
          items: [],
          total: 2,
          page: params.page,
          limit: 50,
        })
      }
      return Promise.resolve({
        items: mockBookings,
        total: 2,
        page: 1,
        limit: 50,
      })
    }
    return Promise.resolve({})
  }),
  apiPatch: vi.fn().mockResolvedValue({}),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

// Mock modals to keep unit test isolated
vi.mock("@/components/client/review-dialog", () => ({
  ReviewDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="mock-review-dialog">Review Dialog</div> : null,
}))

vi.mock("@/components/shared/pix-checkout", () => ({
  PixCheckout: () => <div data-testid="mock-pix-checkout">PIX Checkout</div>,
}))

vi.mock("@/components/shared/live-tracking", () => ({
  LiveTracking: () => <div data-testid="mock-live-tracking">Live Tracking</div>,
}))

vi.mock("@/components/shared/receipt-modal", () => ({
  ReceiptModal: () => <div data-testid="mock-receipt-modal">Receipt Modal</div>,
}))

vi.mock("@/components/shared/service-delivery-report-modal", () => ({
  ServiceDeliveryReportModal: () => <div data-testid="mock-report-modal">Report Modal</div>,
}))

vi.mock("@/components/shared/care-plan-modal", () => ({
  CarePlanModal: () => <div data-testid="mock-care-plan-modal">Care Plan Modal</div>,
}))

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ClientBookings } from "../client-bookings"

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

describe("ClientBookings — rendering and structure", () => {
  it("renders hero banner with title and quick search action", async () => {
    renderWithClient(<ClientBookings />)
    expect(screen.getByText("Agendamentos")).toBeDefined()
    expect(
      screen.getByText(
        "Acompanhe e gerencie seus serviços agendados com proteção de pagamento Severinno.",
      ),
    ).toBeDefined()
    expect(screen.getByText("Buscar prestadores")).toBeDefined()
  })

  it("renders status segmented control tabs with correct counts", async () => {
    renderWithClient(<ClientBookings />)
    await waitFor(() => {
      expect(screen.getByText("Todos")).toBeDefined()
      expect(screen.getByText("Concluídos")).toBeDefined()
      expect(screen.getByText("Cancelados")).toBeDefined()
    })
  })

  it("renders booking cards with provider name, formatted prices and dates", async () => {
    renderWithClient(<ClientBookings />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
      expect(screen.getByText("Mariana Santos")).toBeDefined()
      expect(screen.getByText("Desentupimento de ralo e pia")).toBeDefined()
      expect(screen.getByText("Conserto de Torneira")).toBeDefined()
    })
  })

  it("does not render empty parentheses '()' in service titles", async () => {
    renderWithClient(<ClientBookings />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })
    // Ensure "()" is not rendered anywhere in the cards
    expect(screen.queryByText("()")).toBeNull()
  })

  it("never renders 'Pagar PIX' button on a CANCELLED booking", async () => {
    renderWithClient(<ClientBookings />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })
    // For booking-1 (CANCELLED), Pagar PIX must not exist
    const payPixButtons = screen.queryAllByRole("button", { name: /Pagar PIX/i })
    expect(payPixButtons).toHaveLength(0)
  })

  it("renders 'Contratar Novamente' on cancelled booking and opens booking modal", async () => {
    renderWithClient(<ClientBookings />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })
    const rebookButton = screen.getByRole("button", { name: "Contratar Novamente" })
    expect(rebookButton).toBeDefined()
    fireEvent.click(rebookButton)
    expect(mockOpenBooking).toHaveBeenCalledWith({ providerId: "prov-1", serviceId: "srv-1" })
  })

  it("renders 'Avaliar' on completed booking without reviews and opens ReviewDialog", async () => {
    renderWithClient(<ClientBookings />)
    await waitFor(() => {
      expect(screen.getByText("Mariana Santos")).toBeDefined()
    })
    const reviewButton = screen.getByRole("button", { name: "Avaliar" })
    expect(reviewButton).toBeDefined()
    fireEvent.click(reviewButton)
    expect(screen.getByTestId("mock-review-dialog")).toBeDefined()
  })

  it("navigates to client.messages without external WhatsApp links when clicking message icon", async () => {
    renderWithClient(<ClientBookings />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })
    const messageButtons = screen.getAllByTitle("Enviar mensagem na plataforma")
    expect(messageButtons.length).toBeGreaterThan(0)
    fireEvent.click(messageButtons[0])
    expect(mockNavigate).toHaveBeenCalledWith("client.messages", {
      with: "prov-1",
      peerId: "prov-1",
      providerId: "prov-1",
    })
  })

  it("filters bookings when typing in search input", async () => {
    renderWithClient(<ClientBookings />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
      expect(screen.getByText("Mariana Santos")).toBeDefined()
    })

    const searchInput = screen.getByPlaceholderText("Filtrar por prestador ou serviço...")
    fireEvent.change(searchInput, { target: { value: "Mariana" } })

    await waitFor(() => {
      expect(screen.getByText("Mariana Santos")).toBeDefined()
      expect(screen.queryByText("Carlos Encanador")).toBeNull()
    })
  })

  it("permite alternar entre visualização em lista e em grade", async () => {
    renderWithClient(<ClientBookings />)
    await waitFor(() => {
      expect(screen.getByText("Carlos Encanador")).toBeDefined()
    })

    const gridBtn = screen.getByLabelText("Visualização em grade")
    expect(gridBtn).toBeDefined()
    fireEvent.click(gridBtn)

    // In grid view, both providers remain rendered with their actions
    expect(screen.getByText("Carlos Encanador")).toBeDefined()
    expect(screen.getByText("Mariana Santos")).toBeDefined()

    const listBtn = screen.getByLabelText("Visualização em lista")
    expect(listBtn).toBeDefined()
    fireEvent.click(listBtn)

    expect(screen.getByText("Carlos Encanador")).toBeDefined()
  })
})

describe("ClientBookings — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderWithClient(<ClientBookings />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
