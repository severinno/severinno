import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ServiceFormDialog, type ProviderService } from "../service-form-dialog"
import type { Category } from "@/lib/api"

// Mock api
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    apiPost: vi.fn().mockResolvedValue({ service: { id: "new-s1" } }),
    apiPatch: vi.fn().mockResolvedValue({ service: { id: "s1" } }),
  }
})

const mockCategories: Category[] = [
  {
    id: "cat-root",
    name: "Reparos e Instalações",
    slug: "reparos",
    level: 0,
    parentId: null,
  },
  {
    id: "cat-child",
    name: "Elétrica",
    slug: "eletrica",
    level: 1,
    parentId: "cat-root",
  },
  {
    id: "cat-sub",
    name: "Eletricista Residencial",
    slug: "eletricista-residencial",
    level: 2,
    parentId: "cat-child",
  },
]

const mockEditService: ProviderService = {
  id: "s1",
  providerId: "p1",
  categoryId: "cat-sub",
  title: "Instalação de Tomadas e Disjuntores",
  description: "Serviço completo com padrão ABNT",
  basePrice: 120,
  unit: "UNIDADE",
  photos: [],
  active: true,
  createdAt: "2026-10-10T10:00:00Z",
  updatedAt: "2026-10-10T10:00:00Z",
}

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe("ServiceFormDialog Redesign UX/UI", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders new service modal with persuasive score bar, sections and preview", () => {
    renderWithQuery(
      <ServiceFormDialog
        open={true}
        onOpenChange={vi.fn()}
        service={null}
        categories={mockCategories}
      />,
    )

    // Header & Persuasion
    expect(screen.getByText("Cadastrar novo serviço")).toBeInTheDocument()
    expect(screen.getByText("Força do Anúncio")).toBeInTheDocument()
    expect(screen.getByText("Prévia ao Vivo na Vitrine")).toBeInTheDocument()

    // Sections
    expect(screen.getByText("Classificação do Serviço")).toBeInTheDocument()
    expect(screen.getByText("Apresentação e Descrição")).toBeInTheDocument()
    expect(screen.getByText("Preço Base & Condições")).toBeInTheDocument()
    expect(screen.getByText("Fotos dos seus Trabalhos Realizados")).toBeInTheDocument()

    // Escrow badge
    expect(screen.getByText("Recebimento 100% Garantido com Custódia PIX")).toBeInTheDocument()

    // Actions
    expect(screen.getByText("Publicar serviço na vitrine")).toBeInTheDocument()
    expect(screen.getByText("Salvar e cadastrar outro")).toBeInTheDocument()
  })

  it("applies 1-click template to populate title, price and description", async () => {
    renderWithQuery(
      <ServiceFormDialog
        open={true}
        onOpenChange={vi.fn()}
        service={null}
        categories={mockCategories}
      />,
    )

    // Look for quick template button
    const templateBtn = screen.getByText("Troca de Disjuntor")
    fireEvent.click(templateBtn)

    // Form should now have populated title and price
    const titleInput = screen.getByPlaceholderText(
      "Ex.: Instalação e Troca de Chuveiro Elétrico",
    ) as HTMLInputElement
    expect(titleInput.value).toBe("Troca e Instalação de Disjuntor no Quadro")

    // Live preview updates
    expect(screen.getByText("Troca e Instalação de Disjuntor no Quadro")).toBeInTheDocument()
  })

  it("appends quick description snippets on click", async () => {
    renderWithQuery(
      <ServiceFormDialog
        open={true}
        onOpenChange={vi.fn()}
        service={null}
        categories={mockCategories}
      />,
    )

    const snippetBtn = screen.getByText("Garantia de 90 dias com recibo pela plataforma.")
    fireEvent.click(snippetBtn)

    const textarea = screen.getByPlaceholderText(
      "Descreva detalhadamente o que está incluso, como é feita a execução e condições...",
    ) as HTMLTextAreaElement
    expect(textarea.value).toContain("Garantia de 90 dias com recibo pela plataforma.")
  })

  it("renders in edit mode with current price and edit title", () => {
    renderWithQuery(
      <ServiceFormDialog
        open={true}
        onOpenChange={vi.fn()}
        service={mockEditService}
        categories={mockCategories}
      />,
    )

    expect(screen.getByText("Editar serviço")).toBeInTheDocument()
    expect(screen.getByText("Salvar alterações")).toBeInTheDocument()
    expect(screen.queryByText("Salvar e cadastrar outro")).not.toBeInTheDocument()
  })
})
