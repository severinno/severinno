import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AdminDisputes } from "../admin-disputes"

const mockApiGet = vi.hoisted(() => vi.fn())
const mockApiPost = vi.hoisted(() => vi.fn())

vi.mock("@/lib/api", () => ({
  apiGet: mockApiGet,
  apiPost: mockApiPost,
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}))

const { MockIcon } = vi.hoisted(() => {
  const Icon = (props: any) => <span data-testid="mock-icon" {...props} />
  return { MockIcon: Icon }
})

vi.mock("lucide-react", () => ({
  Scale: MockIcon,
  AlertTriangle: MockIcon,
  CheckCircle2: MockIcon,
  Clock: MockIcon,
  Sparkles: MockIcon,
  Loader2: MockIcon,
  DollarSign: MockIcon,
  User: MockIcon,
  HardHat: MockIcon,
  ArrowRight: MockIcon,
  ShieldCheck: MockIcon,
  Send: MockIcon,
  HelpCircle: MockIcon,
  FileText: MockIcon,
  X: MockIcon,
  XIcon: MockIcon,
}))

describe("AdminDisputes Component", () => {
  const mockDisputeData = {
    items: [
      {
        id: "disp-123",
        bookingId: "book-abc",
        reason: "Prestador não compareceu ao local",
        status: "OPEN",
        resolution: null,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        openDays: 1,
        booking: {
          id: "book-abc",
          amount: 350,
          status: "IN_PROGRESS",
          paymentStatus: "HELD",
          scheduledAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          client: { id: "c-1", name: "Maria Silva", email: "maria@test.com" },
          provider: { id: "p-1", name: "João Pintor", email: "joao@test.com" },
          service: { id: "s-1", title: "Pintura de Fachada" },
        },
      },
    ],
    meta: {
      total: 1,
      open: 1,
      totalAmountInDispute: 350,
    },
  }

  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    mockApiGet.mockResolvedValue(mockDisputeData)
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <AdminDisputes />
      </QueryClientProvider>,
    )

  it("renderiza cabeçalho, KPIs e lista de disputas", async () => {
    renderComponent()

    expect(await screen.findByText("Mediação & Disputas de Escrow")).toBeDefined()
    expect(await screen.findByText("Pintura de Fachada")).toBeDefined()
    expect(screen.getByText(/Prestador não compareceu ao local/)).toBeDefined()
    expect(screen.getByText("Maria Silva")).toBeDefined()
    expect(screen.getByText("João Pintor")).toBeDefined()
  })

  it("abre modal de arbitragem ao clicar no botão", async () => {
    renderComponent()

    const arbitrarBtn = await screen.findByRole("button", { name: /arbitrar decisão/i })
    fireEvent.click(arbitrarBtn)

    expect(await screen.findByText("Arbitragem de Disputa & Custódia")).toBeDefined()
    expect(screen.getByText("100% Cliente")).toBeDefined()
    expect(screen.getByText("100% Prestador")).toBeDefined()
    expect(screen.getByText("Divisão Parcial")).toBeDefined()
  })

  it("consulta mediação por IA e preenche o formulário de arbitragem", async () => {
    mockApiPost.mockResolvedValueOnce({
      success: true,
      data: {
        verdict: "SPLIT",
        refundPercentage: 60,
        reasoning: "Recomendação baseada em fotos incompletas",
        suggestedActions: ["Dividir valor"],
        riskLevel: "LOW",
        source: "ai",
      },
    })

    renderComponent()

    const aiBtn = await screen.findByRole("button", { name: /sugerir com ia/i })
    fireEvent.click(aiBtn)

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        "/api/admin/disputes/mediate",
        expect.objectContaining({
          bookingId: "book-abc",
          clientComplaint: "Prestador não compareceu ao local",
        }),
      )
    })

    expect(await screen.findByText("Arbitragem de Disputa & Custódia")).toBeDefined()
    expect(
      await screen.findByDisplayValue("Recomendação baseada em fotos incompletas"),
    ).toBeDefined()
  })
})
