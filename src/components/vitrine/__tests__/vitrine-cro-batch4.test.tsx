import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { HowItWorksModal } from "../how-it-works-modal"
import { TrustPaymentPills, type TrustPillId } from "../trust-payment-pills"
import { PredictiveSearchDropdown } from "../predictive-search-dropdown"

vi.mock("@/hooks/use-regional-context", () => ({
  useRegionalContext: () => ({
    context: {
      city: "Governador Valadares",
      state: "MG",
      macroRegion: "sudeste",
      timezone: "America/Sao_Paulo",
      solarPeriod: "morning",
      localTimeString: "10:30",
      weather: "mild",
      weatherBadge: "🌤️ Clima Agradável",
      heroHeadline: "Encontre os melhores",
      heroHighlight: "Profissionais verificados",
      heroSubtext: "Perto de você",
      neighborhoods: ["Centro", "Ilha dos Araújos", "Grã-Duquesa"],
      tone: {
        region: "sudeste",
        greetingPrefix: "Olá!",
        headlineSuffix: "sem dor de cabeça",
        trustStatement: "Segurança total",
        emergencyBadge: "🚨 Plantão Rápido",
        colloquialTerms: ["uai"],
      },
      priorityServiceChips: [],
      platformEvents: {
        activeProvidersNearby: 42,
        bookingsLast24h: 15,
        topTrendingServiceName: "Ar-Condicionado",
        demandSpike: true,
        recentSocialProofNotice: "15 agendamentos hoje",
      },
    },
    isLoading: false,
    isWeatherAdapted: true,
  }),
}))

describe("Vitrine CRO Batch 4 (How It Works Modal, Trust & Payment Pills, Predictive Search)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("HowItWorksModal (Feature #5: Como Funciona em 40 Segundos)", () => {
    it("renders modal when open and advances through the 4 steps", () => {
      const onOpenChange = vi.fn()
      const onExplore = vi.fn()

      const { rerender } = render(
        <HowItWorksModal open={true} onOpenChange={onOpenChange} onExploreServices={onExplore} />,
      )

      expect(
        screen.getByText(/Como a Severinno protege você em Governador Valadares/i),
      ).toBeDefined()
      expect(screen.getByText("Passo 01")).toBeDefined()
      expect(screen.getByText("Escolha o Serviço ou Profissional")).toBeDefined()

      // Click "Próximo Passo"
      const nextBtn = screen.getByText("Próximo Passo")
      fireEvent.click(nextBtn)

      expect(screen.getByText("Atendimento Pontual na Sua Casa")).toBeDefined()

      // Close modal
      const closeBtn = screen.getByLabelText("Fechar guia de como funciona")
      fireEvent.click(closeBtn)
      expect(onOpenChange).toHaveBeenCalledWith(false)

      // When open=false, does not render
      rerender(<HowItWorksModal open={false} onOpenChange={onOpenChange} />)
      expect(screen.queryByText(/Como a Severinno protege você/i)).toBeNull()
    })
  })

  describe("TrustPaymentPills (Feature #4: Filtros de Pagamento e Confiabilidade)", () => {
    it("renders payment and trust pills and triggers toggle/clear callbacks", () => {
      const onToggle = vi.fn()
      const onClear = vi.fn()
      const activePills: TrustPillId[] = ["parcela12x"]

      render(
        <TrustPaymentPills
          activePills={activePills}
          onTogglePill={onToggle}
          onClearPills={onClear}
        />,
      )

      expect(screen.getByText("Parcela em até 12x")).toBeDefined()
      expect(screen.getByText("Pix com 5% OFF")).toBeDefined()
      expect(screen.getByText("Emite Nota Fiscal (MEI/PJ)")).toBeDefined()

      // Click "Pix com 5% OFF" button
      const pixBtn = screen.getByText("Pix com 5% OFF").closest("button")
      expect(pixBtn).toBeDefined()
      fireEvent.click(pixBtn!)
      expect(onToggle).toHaveBeenCalledWith("pix_desconto")

      // Click clear button
      const clearBtn = screen.getByText(/Limpar \(1\)/i)
      fireEvent.click(clearBtn)
      expect(onClear).toHaveBeenCalledTimes(1)
    })
  })

  describe("PredictiveSearchDropdown (Feature #6: Autocomplete Preditivo)", () => {
    it("renders popular services and filtered neighborhoods when open", () => {
      const onSelect = vi.fn()
      const onClose = vi.fn()

      const { rerender } = render(
        <PredictiveSearchDropdown query="" isOpen={true} onSelect={onSelect} onClose={onClose} />,
      )

      expect(screen.getByText("Serviços Mais Procurados")).toBeDefined()
      expect(screen.getByText("Buscar por Bairro")).toBeDefined()
      expect(screen.getByText("Ilha dos Araújos")).toBeDefined()

      // Click on a suggestion
      const serviceBtn = screen.getByText("Eletricista Residencial").closest("button")
      expect(serviceBtn).toBeDefined()
      fireEvent.click(serviceBtn!)
      expect(onSelect).toHaveBeenCalledWith("Eletricista Residencial")

      // When open=false, does not render
      rerender(
        <PredictiveSearchDropdown query="" isOpen={false} onSelect={onSelect} onClose={onClose} />,
      )
      expect(screen.queryByText("Serviços Mais Procurados")).toBeNull()
    })
  })
})
