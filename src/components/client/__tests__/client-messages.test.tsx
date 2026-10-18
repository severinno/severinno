/**
 * Tests for ClientMessages — client messaging panel with anti-fraud shield.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// ---- Hoisted shared mocks --------------------------------------------------
const { mockNavigate, mockParams } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockParams: { providerId: undefined as string | undefined },
}))

vi.mock("@/store/view", () => ({
  useViewStore: vi.fn(
    (
      selector?: (s: {
        navigate: ReturnType<typeof vi.fn>
        params: Record<string, unknown>
      }) => unknown,
    ) => {
      const state = { navigate: mockNavigate, params: mockParams }
      return selector ? selector(state) : state
    },
  ),
}))

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: { id: "client-1", name: "João Cliente", role: "CLIENT" },
      status: "authenticated",
    }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@/hooks/use-realtime", () => ({
  useRealtime: () => ({
    isConnected: true,
    on: vi.fn(() => vi.fn()),
    join: vi.fn(),
    emit: vi.fn(),
  }),
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue([]),
  apiPost: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/format", () => ({
  formatRelative: vi.fn(() => "há 1 dia"),
  formatBRL: vi.fn((val: number | string) => `R$ ${Number(val).toFixed(2).replace(".", ",")}`),
}))

import { ClientMessages } from "../client-messages"

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

describe("ClientMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParams.providerId = undefined
  })

  afterEach(() => {
    cleanup()
  })

  it("renders Hero banner, title and quick navigation buttons", async () => {
    renderWithClient(<ClientMessages />)

    expect(screen.getByText("Blindagem & Comunicação Segura")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Mensagens" })).toBeInTheDocument()

    const agendamentosBtn = screen.getByRole("button", { name: /Meus agendamentos/i })
    fireEvent.click(agendamentosBtn)
    expect(mockNavigate).toHaveBeenCalledWith("client.bookings")

    const providersBtn = screen.getByRole("button", { name: /Buscar prestadores/i })
    fireEvent.click(providersBtn)
    expect(mockNavigate).toHaveBeenCalledWith("client.providers")
  })

  it("renders Anti-Fraud & Escrow Security Notice warning against external WhatsApp/phone leaks", async () => {
    renderWithClient(<ClientMessages />)

    expect(screen.getByText("Proteção de Custódia & Garantia Legal de 90 Dias")).toBeInTheDocument()
    expect(
      screen.getByText(
        /Nunca realize pagamentos por fora da plataforma nem migre a conversa para WhatsApp/i,
      ),
    ).toBeInTheDocument()
  })

  it("renders embedded MessagesView with conversations and empty thread state", async () => {
    renderWithClient(<ClientMessages />)

    expect(screen.getByText("Conversas com prestadores")).toBeInTheDocument()
    expect(
      screen.getByText(/Tire dúvidas, aprove propostas com Custódia Segura PIX/i),
    ).toBeInTheDocument()
  })

  it("passes accessibility checks with 0 axe violations", async () => {
    const { container } = renderWithClient(<ClientMessages />)

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Mensagens" })).toBeInTheDocument()
    })

    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
