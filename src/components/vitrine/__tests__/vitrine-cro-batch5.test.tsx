import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { NeighborhoodSelectorBar } from "../neighborhood-selector-bar"
import { FloatingRecentDock } from "../floating-recent-dock"
import ProviderCard from "../provider-card"
import type { ProviderCard as ProviderCardType } from "@/lib/api"

vi.mock("@/hooks/use-regional-context", () => ({
  useRegionalContext: () => ({
    context: {
      city: "Governador Valadares",
      state: "MG",
      neighborhoods: ["Centro", "Ilha dos Araújos", "Grã-Duquesa", "Vila Bretas", "São Pedro"],
    },
    isLoading: false,
    isWeatherAdapted: true,
  }),
}))

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

const mockRecentlyViewedStore = vi.hoisted(() => ({
  items: [] as ProviderCardType[],
  clear: vi.fn(),
  addView: vi.fn(),
}))

vi.mock("@/store/recently-viewed", () => ({
  useRecentlyViewedStore: Object.assign(
    (selector: (s: any) => unknown) => selector(mockRecentlyViewedStore),
    { getState: () => mockRecentlyViewedStore },
  ),
}))

const mockUIStore = vi.hoisted(() => ({
  openBooking: vi.fn(),
  openProvider: vi.fn(),
  openAuth: vi.fn(),
}))

vi.mock("@/store/ui", () => ({
  useUIStore: Object.assign((selector: (s: any) => unknown) => selector(mockUIStore), {
    getState: () => mockUIStore,
  }),
}))

const mockCompareStore = vi.hoisted(() => ({
  ids: [] as string[],
  toggle: vi.fn(),
}))

vi.mock("@/store/compare", () => ({
  useCompareStore: Object.assign((selector: (s: any) => unknown) => selector(mockCompareStore), {
    getState: () => mockCompareStore,
  }),
  MAX_COMPARE: 4,
}))

describe("Vitrine CRO Batch 5 (Seletor de Bairros, Mini-Dock Flutuante, Próximas Vagas no Card)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRecentlyViewedStore.items = []
  })

  describe("NeighborhoodSelectorBar (Feature #2: Seletor Rápido de Bairro com Métricas Hiperlocais)", () => {
    it("renders default neighborhood and allows selecting another neighborhood", () => {
      const onSelectNeighborhood = vi.fn()
      const onSearchService = vi.fn()

      render(
        <NeighborhoodSelectorBar
          selectedNeighborhood="Centro"
          onSelectNeighborhood={onSelectNeighborhood}
          onSearchService={onSearchService}
        />,
      )

      expect(screen.getByTestId("neighborhood-selector-bar")).toBeInTheDocument()
      expect(screen.getByText("Centro", { selector: "button" })).toBeInTheDocument()
      expect(screen.getByText("Ilha dos Araújos", { selector: "button" })).toBeInTheDocument()

      // Select Ilha dos Araújos
      fireEvent.click(screen.getByText("Ilha dos Araújos", { selector: "button" }))
      expect(onSelectNeighborhood).toHaveBeenCalledWith("Ilha dos Araújos")

      // Check metrics update
      expect(screen.getByText(/19 profissionais/i)).toBeInTheDocument()
      expect(screen.getByText(/99.8% aprovado/i)).toBeInTheDocument()
    })

    it("clicking a top service in the neighborhood triggers onSearchService", () => {
      const onSearchService = vi.fn()

      render(
        <NeighborhoodSelectorBar
          selectedNeighborhood="Ilha dos Araújos"
          onSearchService={onSearchService}
        />,
      )

      const serviceBtn = screen.getByRole("button", { name: /Ar-Condicionado & Clima/i })
      fireEvent.click(serviceBtn)

      expect(onSearchService).toHaveBeenCalledWith("Ar-Condicionado & Clima", "Ilha dos Araújos")
    })
  })

  describe("FloatingRecentDock (Feature #3: Mini-Dock Flutuante de Vistos Recentemente)", () => {
    it("returns null when no providers have been viewed yet", () => {
      mockRecentlyViewedStore.items = []
      const { container } = render(<FloatingRecentDock />)
      expect(container.firstChild).toBeNull()
    })

    it("renders minimized pill when providers are present and expands on click", () => {
      mockRecentlyViewedStore.items = [
        {
          id: "prov-1",
          name: "Carlos Eletricista",
          rating: 4.9,
          reviewCount: 38,
          verified: true,
          services: [{ id: "s1", title: "Instalação Elétrica", basePrice: 120, unit: "UNIDADE" }],
        } as unknown as ProviderCardType,
      ]

      render(<FloatingRecentDock />)

      // Minimized pill is visible
      expect(screen.getByTestId("floating-recent-dock")).toBeInTheDocument()
      expect(screen.getByText(/1 visto/i)).toBeInTheDocument()

      // Click to expand
      fireEvent.click(screen.getByLabelText(/abrir prestadores vistos recentemente/i))

      // Now expanded panel with provider details and Agendar button
      expect(screen.getByText("Carlos Eletricista")).toBeInTheDocument()
      const btnAgendar = screen.getByRole("button", { name: /agendar/i })
      expect(btnAgendar).toBeInTheDocument()

      fireEvent.click(btnAgendar)
      expect(mockUIStore.openBooking).toHaveBeenCalledWith({
        providerId: "prov-1",
        serviceId: "s1",
      })
    })

    it("calls clear() when clicking Limpar", () => {
      mockRecentlyViewedStore.items = [
        {
          id: "prov-1",
          name: "Carlos Eletricista",
          rating: 4.9,
          reviewCount: 38,
          verified: true,
          services: [],
        } as unknown as ProviderCardType,
      ]

      render(<FloatingRecentDock />)
      fireEvent.click(screen.getByLabelText(/abrir prestadores vistos recentemente/i))

      const btnLimpar = screen.getByRole("button", { name: /limpar/i })
      fireEvent.click(btnLimpar)
      expect(mockRecentlyViewedStore.clear).toHaveBeenCalled()
    })
  })

  describe("ProviderCard (Feature #5: Preview de Próximas Vagas)", () => {
    it("renders next available slot pills and triggers onBook when clicked", () => {
      const onBook = vi.fn()
      const mockProvider: ProviderCardType = {
        id: "prov-abc",
        name: "Marcos Pintor",
        rating: 4.8,
        reviewCount: 15,
        verified: true,
        services: [
          { id: "srv-1", title: "Pintura Residencial", basePrice: 250, unit: "METRO_QUADRADO" },
        ],
      }

      render(<ProviderCard provider={mockProvider} onBook={onBook} />)

      // Check slot row is rendered
      expect(screen.getByTestId("provider-card-slots")).toBeInTheDocument()
      expect(screen.getByText(/Vagas:/i)).toBeInTheDocument()

      // Click a slot pill
      const slotButton = screen.getAllByTitle(/Agendar com Marcos Pintor/i)[0]
      fireEvent.click(slotButton)

      expect(onBook).toHaveBeenCalledWith("prov-abc", "srv-1")
    })
  })
})
