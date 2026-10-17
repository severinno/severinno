import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ProviderServices } from "../provider-services"

// Mock store
vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: {
        id: "p1",
        name: "Carlos Eletricista",
        email: "carlos@test.com",
        role: "PROVIDER",
      },
    }
    return selector ? selector(state) : state
  }),
}))

const mockServices = [
  {
    id: "s1",
    providerId: "p1",
    categoryId: "cat-1",
    title: "Instalação de Tomadas e Interruptores",
    description: "Instalação rápida e com padrão NBR",
    basePrice: 120,
    unit: "FIXED",
    photos: ["/images/s1.jpg"],
    active: true,
    createdAt: "2026-10-10T10:00:00Z",
    updatedAt: "2026-10-10T10:00:00Z",
    category: { id: "cat-1", name: "Elétrica", slug: "eletrica" },
  },
  {
    id: "s2",
    providerId: "p1",
    categoryId: "cat-1",
    title: "Troca de Disjuntor no Quadro",
    description: "Substituição de disjuntores antigos por modelo DIN",
    basePrice: 180,
    unit: "HOUR",
    photos: [],
    active: false,
    createdAt: "2026-10-11T10:00:00Z",
    updatedAt: "2026-10-11T10:00:00Z",
    category: { id: "cat-1", name: "Elétrica", slug: "eletrica" },
  },
]

const mockCategories = [{ id: "cat-1", name: "Elétrica", slug: "eletrica" }]

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/api/services") return mockServices
      if (url === "/api/categories") return mockCategories
      return []
    }),
    apiPatch: vi.fn().mockResolvedValue({}),
    apiDelete: vi.fn().mockResolvedValue({}),
    apiPost: vi.fn().mockResolvedValue({}),
  }
})

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe("ProviderServices UX/UI Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders business metrics correctly", async () => {
    renderWithQuery(<ProviderServices />)

    // Wait for services query to load
    await screen.findByText("Instalação de Tomadas e Interruptores")

    // Total de serviços
    expect(screen.getByText("Total de Serviços")).toBeInTheDocument()
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("(1 ativos)")).toBeInTheDocument()

    // Visibilidade Vitrine: 1 de 2 = 50%
    expect(screen.getByText("Visibilidade Vitrine")).toBeInTheDocument()
    expect(screen.getByText("50%")).toBeInTheDocument()

    // Ticket Médio (120 + 180) / 2 = 150
    expect(screen.getByText("Ticket Médio")).toBeInTheDocument()
  })

  it("renders services in grid view and allows toggling to table view", async () => {
    renderWithQuery(<ProviderServices />)

    expect(await screen.findByText("Instalação de Tomadas e Interruptores")).toBeInTheDocument()
    expect(screen.getByText("Troca de Disjuntor no Quadro")).toBeInTheDocument()

    // Find view toggle buttons
    const listBtn = screen.getByLabelText("Visualização em lista")
    fireEvent.click(listBtn)

    // Should render table headers
    expect(screen.getByRole("table")).toBeInTheDocument()
    expect(screen.getByText("Serviço")).toBeInTheDocument()
    expect(screen.getByText("Preço Base")).toBeInTheDocument()
  })

  it("filters services by search query", async () => {
    renderWithQuery(<ProviderServices />)

    await screen.findByText("Instalação de Tomadas e Interruptores")

    const searchInput = screen.getByPlaceholderText("Buscar serviço por título ou descrição...")
    fireEvent.change(searchInput, { target: { value: "Disjuntor" } })

    expect(screen.queryByText("Instalação de Tomadas e Interruptores")).not.toBeInTheDocument()
    expect(screen.getByText("Troca de Disjuntor no Quadro")).toBeInTheDocument()
  })

  it("filters services by status tabs", async () => {
    renderWithQuery(<ProviderServices />)

    await screen.findByText("Instalação de Tomadas e Interruptores")

    // Click on Inativos
    const inativosBtn = screen.getByRole("button", { name: /Inativos/i })
    fireEvent.click(inativosBtn)

    expect(screen.queryByText("Instalação de Tomadas e Interruptores")).not.toBeInTheDocument()
    expect(screen.getByText("Troca de Disjuntor no Quadro")).toBeInTheDocument()
  })
})
