import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { NeighborhoodPriceSimulator } from "../neighborhood-price-simulator"
import { TopProvidersShowcase } from "../top-providers-showcase"
import BeforeAfterShowcase from "../before-after-showcase"
import { EscrowGuaranteeBanner } from "../escrow-guarantee-banner"
import { EscrowShieldModal } from "../escrow-shield-modal"

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

const mockCompareStore = vi.hoisted(() => ({
  ids: [] as string[],
  setIds: vi.fn(),
  openCompare: vi.fn(),
}))

vi.mock("@/store/compare", () => ({
  useCompareStore: Object.assign((selector: (s: any) => unknown) => selector(mockCompareStore), {
    getState: () => mockCompareStore,
  }),
  MAX_COMPARE: 4,
}))

const mockUIStore = vi.hoisted(() => ({
  openQuote: vi.fn(),
  openBooking: vi.fn(),
}))

vi.mock("@/store/ui", () => ({
  useUIStore: Object.assign((selector: (s: any) => unknown) => selector(mockUIStore), {
    getState: () => mockUIStore,
  }),
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "vitrine-highlights") {
      return {
        data: {
          featuredProviders: [
            {
              id: "prov-1",
              name: "Carlos Eletricista",
              avgRating: 4.95,
              reviewCount: 42,
              primaryService: "Elétrica Residencial",
              badges: ["Verificado"],
            },
            {
              id: "prov-2",
              name: "Marcos Encanador",
              avgRating: 4.9,
              reviewCount: 31,
              primaryService: "Hidráulica",
              badges: ["Verificado"],
            },
            {
              id: "prov-3",
              name: "Ana Diarista",
              avgRating: 5.0,
              reviewCount: 56,
              primaryService: "Faxina",
              badges: ["Verificado"],
            },
          ],
        },
        isLoading: false,
      }
    }
    return { data: null, isLoading: false }
  },
}))

describe("Vitrine CRO Batch 6 Enhancements", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("Feature 1: NeighborhoodPriceSimulator with Benchmark", () => {
    it("renders benchmark distribution bar and updates prices on scope change", () => {
      const onQuote = vi.fn()
      render(<NeighborhoodPriceSimulator onQuote={onQuote} />)

      // Initial service is Ar-Condicionado (min 130, max 190, scope simple = multiplier 1.0)
      expect(
        screen.getByText(/Simulador de Preço Médio em Governador Valadares/i),
      ).toBeInTheDocument()
      expect(screen.getByText(/Média GV/i)).toBeInTheDocument()
      expect(screen.getByText("R$ 130 — 190")).toBeInTheDocument()

      // Click "Padrão" scope (multiplier 1.35)
      const btnStandard = screen.getByRole("button", { name: /padrão/i })
      fireEvent.click(btnStandard)

      // Expected new prices: 130 * 1.35 = 176, 190 * 1.35 = 257
      expect(screen.getByText("R$ 176 — 257")).toBeInTheDocument()

      // Click "Completo" scope (multiplier 1.8)
      const btnComplete = screen.getByRole("button", { name: /completo/i })
      fireEvent.click(btnComplete)
      expect(screen.getByText("R$ 234 — 342")).toBeInTheDocument()
    })

    it("switches service when clicking quick category pills", () => {
      const onQuote = vi.fn()
      render(<NeighborhoodPriceSimulator onQuote={onQuote} />)

      // Click Eletricista pill
      const eletricistaPill = screen.getByRole("button", { name: "Eletricista Residencial" })
      fireEvent.click(eletricistaPill)

      // Eletricista min 60 max 130 at simple scope
      expect(screen.getByText("R$ 60 — 130")).toBeInTheDocument()
    })
  })

  describe("Feature 2: TopProvidersShowcase Quick Compare", () => {
    it("renders 'Comparar os Melhores Lado a Lado' button and triggers compareStore", () => {
      render(<TopProvidersShowcase onViewProvider={vi.fn()} onQuote={vi.fn()} />)

      const compareBtn = screen.getByRole("button", { name: /comparar os melhores lado a lado/i })
      expect(compareBtn).toBeInTheDocument()

      fireEvent.click(compareBtn)

      expect(mockCompareStore.setIds).toHaveBeenCalledWith(["prov-1", "prov-2", "prov-3"])
      expect(mockCompareStore.openCompare).toHaveBeenCalledTimes(1)
    })
  })

  describe("Feature 3: BeforeAfterShowcase with Rich Transformations", () => {
    it("renders 5 categories and switches active transformation item", () => {
      render(<BeforeAfterShowcase />)

      expect(screen.getByText("Transformações Reais: Antes & Depois")).toBeInTheDocument()
      expect(screen.getByText("Elétrica & Segurança")).toBeInTheDocument()
      expect(screen.getByText("Higienização de Estofados")).toBeInTheDocument()

      // Switch to Higienização de Estofados
      const sofaBtn = screen.getByRole("button", { name: "Higienização de Estofados" })
      fireEvent.click(sofaBtn)

      expect(
        screen.getByRole("heading", { name: "Restauração & Higienização de Sofá Retrátil" }),
      ).toBeInTheDocument()
      expect(screen.getByText("LimpaSofá Pro GV")).toBeInTheDocument()
      expect(screen.getByText("2 horas")).toBeInTheDocument()
    })

    it("triggers openQuote with formatted description when clicking CTA", () => {
      render(<BeforeAfterShowcase />)

      const ctaBtn = screen.getByRole("button", {
        name: /solicitar orçamento com proteção escrow/i,
      })
      fireEvent.click(ctaBtn)

      expect(mockUIStore.openQuote).toHaveBeenCalledWith({
        initialDescription: expect.stringContaining(
          "Reforma do Quadro de Distribuição & Disjuntores",
        ),
      })
    })
  })

  describe("Feature 5: EscrowGuaranteeBanner & EscrowShieldModal", () => {
    it("renders learn more button in EscrowGuaranteeBanner and triggers callback", () => {
      const onLearnMore = vi.fn()
      render(<EscrowGuaranteeBanner onLearnMore={onLearnMore} />)

      const btn = screen.getByRole("button", { name: /entenda a proteção anti-golpe/i })
      expect(btn).toBeInTheDocument()

      fireEvent.click(btn)
      expect(onLearnMore).toHaveBeenCalledTimes(1)
    })

    it("renders EscrowShieldModal with comparison matrix and steps", () => {
      const onOpenChange = vi.fn()
      const onExplore = vi.fn()

      render(
        <EscrowShieldModal
          open={true}
          onOpenChange={onOpenChange}
          onExploreProviders={onExplore}
        />,
      )

      expect(
        screen.getByText("Central de Garantia Blindada & Anti-Golpe Severinno"),
      ).toBeInTheDocument()
      expect(screen.getByText(/Contratação Informal/i)).toBeInTheDocument()
      expect(screen.getByText(/Severinno Garantia Blindada/i)).toBeInTheDocument()
      expect(screen.getByText("Você Reserva Seguro")).toBeInTheDocument()

      const ctaBtn = screen.getByRole("button", { name: /contratar com garantia blindada/i })
      fireEvent.click(ctaBtn)

      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(onExplore).toHaveBeenCalledTimes(1)
    })
  })
})
