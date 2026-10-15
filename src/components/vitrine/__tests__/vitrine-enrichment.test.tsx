import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import CategoryGridSection from "../category-grid-section"
import EscrowGuaranteeBanner from "../escrow-guarantee-banner"
import TrendingServices from "../trending-services"
import TopProvidersShowcase from "../top-providers-showcase"
import NeighborhoodPriceSimulator from "../neighborhood-price-simulator"
import LiveAvailabilityTicker from "../live-availability-ticker"
import ProviderStoriesStrip from "../provider-stories-strip"
import type { Category } from "@/lib/api"

const mockUseQuery = vi.hoisted(() => vi.fn())

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: any) => mockUseQuery(opts),
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
  DialogTitle: ({ children }: any) => <h2 data-testid="dialog-title">{children}</h2>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}))

const mockCategories: Category[] = [
  {
    id: "cat-1",
    name: "Reforma e Construção",
    slug: "reforma-e-construcao",
    level: 0,
    children: [],
  },
  {
    id: "cat-2",
    name: "Reparos e Instalações",
    slug: "reparos-e-instalacoes",
    level: 0,
    children: [],
  },
  { id: "cat-3", name: "Limpeza e Casa", slug: "limpeza-e-casa", level: 0, children: [] },
  { id: "cat-4", name: "Emergência 24h", slug: "emergencia-24h", level: 0, children: [] },
]

describe("Vitrine High-Converting Components", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("CategoryGridSection", () => {
    it("renders the 7 official macro-pillars with local counts and tags", () => {
      const onSelect = vi.fn()
      const onEmergency = vi.fn()

      render(
        <CategoryGridSection
          categories={mockCategories}
          activeId={null}
          onSelect={onSelect}
          onEmergencyClick={onEmergency}
        />,
      )

      expect(screen.getByText("O que você precisa resolver hoje?")).toBeDefined()
      expect(screen.getByText("Emergência 24h")).toBeDefined()
      expect(screen.getByText("Reparos & Instalações")).toBeDefined()
      expect(screen.getByText("Limpeza & Cuidados")).toBeDefined()

      // Click on Reparos & Instalações
      const reparosCard = screen.getByText("Reparos & Instalações").closest("div")
      reparosCard?.click()
      expect(onSelect).toHaveBeenCalledWith("cat-2")

      // Click on Emergência 24h triggers emergency handler
      const sosCard = screen.getByText("Emergência 24h").closest("div")
      sosCard?.click()
      expect(onEmergency).toHaveBeenCalled()
    })
  })

  describe("EscrowGuaranteeBanner", () => {
    it("renders Escrow steps and Zero Risco trust signals", () => {
      render(<EscrowGuaranteeBanner />)

      expect(screen.getByText(/Garantia de Custódia Blindada Severinno/i)).toBeDefined()
      expect(screen.getByText(/Pagamento Seguro/i)).toBeDefined()
      expect(screen.getByText(/Serviço Executado/i)).toBeDefined()
      expect(screen.getByText(/Aprovação & Liberação/i)).toBeDefined()
    })
  })

  describe("TrendingServices", () => {
    it("renders trending services list with transparent prices and action buttons", () => {
      mockUseQuery.mockReturnValue({
        isLoading: false,
        data: {
          trendingServices: [
            {
              id: "srv-1",
              title: "Técnico de Ar Condicionado",
              categoryName: "Reparos e Instalações",
              basePrice: "150",
              unit: "serviço",
              providerId: "prov-1",
              providerName: "Diego Lima",
              providerRating: 5.0,
              providerReviews: 12,
              providerDistrict: "Centro",
              bookingCount: 18,
              badge: "🔥 Mais Pedido da Semana",
              estimatedMinutes: 25,
            },
          ],
        },
      })

      const onQuote = vi.fn()
      const onBook = vi.fn()
      const onView = vi.fn()

      render(<TrendingServices onQuote={onQuote} onBook={onBook} onViewProvider={onView} />)

      expect(screen.getByText("Serviços Mais Contratados da Cidade")).toBeDefined()
      expect(screen.getByText("Técnico de Ar Condicionado")).toBeDefined()
      expect(screen.getByText("R$ 150")).toBeDefined()
      expect(screen.getByText("Diego Lima")).toBeDefined()

      // Click on Contratar
      const hireBtn = screen.getByText("Contratar Serviço")
      hireBtn.click()
      expect(onBook).toHaveBeenCalledWith("prov-1", "srv-1")
    })
  })

  describe("TopProvidersShowcase", () => {
    it("renders top verified providers with background checks and star ratings", () => {
      mockUseQuery.mockReturnValue({
        isLoading: false,
        data: {
          featuredProviders: [
            {
              id: "prov-1",
              name: "Camila Estofados",
              avatarUrl: null,
              city: "Governador Valadares",
              district: "Ilha dos Araújos",
              avgRating: 5.0,
              reviewCount: 39,
              verified: true,
              topServiceTitle: "Higienização de Sofá",
              topServicePrice: "180",
              completedBookingsCount: 42,
            },
          ],
        },
      })

      const onView = vi.fn()
      const onQuote = vi.fn()

      render(<TopProvidersShowcase onViewProvider={onView} onQuote={onQuote} />)

      expect(screen.getByText("Prestadores Mais Requisitados da Cidade")).toBeDefined()
      expect(screen.getByText("Camila Estofados")).toBeDefined()
      expect(screen.getByText("Ilha dos Araújos, GV")).toBeDefined()
      expect(screen.getByText("Higienização de Sofá")).toBeDefined()

      const viewBtn = screen.getByText("Ver Perfil & Avaliações")
      viewBtn.click()
      expect(onView).toHaveBeenCalledWith("prov-1")
    })
  })

  describe("NeighborhoodPriceSimulator", () => {
    it("renders GV price simulator and handles quote trigger with selected neighborhood", () => {
      const onQuote = vi.fn()
      render(<NeighborhoodPriceSimulator onQuote={onQuote} />)

      expect(screen.getByText("Simulador de Preço Médio em Governador Valadares")).toBeDefined()
      expect(screen.getByText("Descubra quanto custa seu conserto no seu bairro:")).toBeDefined()
      expect(screen.getByText(/Garantia Severinno/i)).toBeDefined()

      const quoteBtn = screen.getByText(/Ver Profissionais Disponíveis em Centro/i)
      quoteBtn.click()
      expect(onQuote).toHaveBeenCalledWith("Técnico de Ar-Condicionado", "Centro")
    })
  })

  describe("LiveAvailabilityTicker", () => {
    it("renders live ticker bar and triggers action callback", () => {
      const onAction = vi.fn()
      render(<LiveAvailabilityTicker onActionClick={onAction} />)

      expect(screen.getByText(/Agenda Ao Vivo em/i)).toBeDefined()
      const actionBtn = screen.getByText("Chamar Agora")
      actionBtn.click()
      expect(onAction).toHaveBeenCalled()
    })
  })

  describe("ProviderStoriesStrip", () => {
    it("renders provider story bubbles and opens interactive story modal", () => {
      const onQuote = vi.fn()
      render(<ProviderStoriesStrip onQuoteProvider={onQuote} />)

      expect(screen.getByText(/Serviços Entregues em GV/i)).toBeDefined()
      expect(screen.getByText("Camila")).toBeDefined()

      // Click on Camila story bubble
      const storyBubble = screen.getByText("Camila").closest("button")
      expect(storyBubble).not.toBeNull()
      fireEvent.click(storyBubble!)

      expect(screen.getByText("Higienização Profunda de Sofá Retrátil")).toBeDefined()
      expect(screen.getByText("Transformação Real")).toBeDefined()
    })
  })
})
