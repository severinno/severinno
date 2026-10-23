import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { EmergencySosBanner } from "../emergency-sos-banner"
import { WhatsappAudioQuoteCard } from "../whatsapp-audio-quote-card"
import { NeighborhoodFeedShowcase } from "../neighborhood-feed-showcase"
import { TrustComparisonTable } from "../trust-comparison-table"
import { ProximityRadarTicker } from "../proximity-radar-ticker"

// Mock useRegionalContext to return predictable test data
vi.mock("@/hooks/use-regional-context", () => ({
  useRegionalContext: () => ({
    context: {
      city: "Governador Valadares",
      state: "MG",
      macroRegion: "sudeste",
      timezone: "America/Sao_Paulo",
      solarPeriod: "night_emergency",
      localTimeString: "21:30",
      weather: "heatwave",
      weatherBadge: "☀️ Calor Intenso na Sua Região",
      heroHeadline: "Altas temperaturas hoje?",
      heroHighlight: "Técnicos de ar e refrigeração prontos para atender.",
      heroSubtext: "Atendimento no seu bairro.",
      neighborhoods: ["Centro", "Ilha dos Araújos", "Grã-Duquesa", "São Pedro", "Vila Isa"],
      tone: {
        region: "sudeste",
        greetingPrefix: "O que você precisa resolver hoje?",
        headlineSuffix: "perto de você, sem enrolação.",
        trustStatement: "Preço justo, serviço bem feito e pagamento seguro.",
        emergencyBadge: "🚨 Plantão Rápido na Sua Cidade",
        colloquialTerms: ["uai", "sô"],
      },
      priorityServiceChips: [],
      platformEvents: {
        activeProvidersNearby: 38,
        bookingsLast24h: 12,
        topTrendingServiceName: "Técnico de Ar",
        demandSpike: true,
        recentSocialProofNotice: "12 serviços agendados recentemente em Governador Valadares",
      },
    },
    isLoading: false,
    isWeatherAdapted: true,
  }),
}))

describe("Vitrine CRO & Persuasion Enhancements (#2, #3, #4, #5, #6)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("EmergencySosBanner (Feature #2: Plantão Noturno & SOS)", () => {
    it("renders night-mode emergency alert with city name and action buttons", () => {
      const onTrigger = vi.fn()
      render(<EmergencySosBanner onTriggerSos={onTrigger} />)

      expect(screen.getByText(/Plantão Noturno Ativo 24h/i)).toBeDefined()
      expect(screen.getAllByText(/Governador Valadares/i).length).toBeGreaterThan(0)
      expect(screen.getByText("Curto / Luz")).toBeDefined()
      expect(screen.getByText("Vazamento")).toBeDefined()
      expect(screen.getByText("Chaveiro")).toBeDefined()

      // Click primary SOS button
      const mainSosBtn = screen.getByText("Pedir Socorro Agora")
      fireEvent.click(mainSosBtn)
      expect(onTrigger).toHaveBeenCalled()

      // Click specific emergency category
      const eletricaBtn = screen.getByText("Curto / Luz")
      fireEvent.click(eletricaBtn)
      expect(onTrigger).toHaveBeenCalledWith("eletrica")
    })
  })

  describe("WhatsappAudioQuoteCard (Feature #3: Orçamento por Áudio)", () => {
    it("renders voice quote CTA with direct WhatsApp link pre-filled for detected city", () => {
      render(<WhatsappAudioQuoteCard />)

      expect(screen.getByText(/Prefere explicar o problema mandando um áudio\?/i)).toBeDefined()
      expect(screen.getByText(/Mandar Áudio no WhatsApp/i)).toBeDefined()

      const link = screen.getByText(/Mandar Áudio no WhatsApp/i).closest("a")
      expect(link).toBeDefined()
      expect(link?.getAttribute("href")).toContain("wa.me")
      expect(link?.getAttribute("href")).toContain("Governador%20Valadares")
    })
  })

  describe("NeighborhoodFeedShowcase (Feature #4: Feed de Serviços no Bairro)", () => {
    it("renders completed jobs feed and allows filtering by neighborhood", () => {
      const onQuote = vi.fn()
      render(<NeighborhoodFeedShowcase onQuoteService={onQuote} />)

      expect(
        screen.getByText(/Serviços Concluídos Recentemente em Governador Valadares/i),
      ).toBeDefined()
      expect(screen.getByText("Todos os Bairros")).toBeDefined()
      expect(screen.getAllByText("Ilha dos Araújos").length).toBeGreaterThan(0)

      // Click filter pill button specifically
      const ilhaBtn = screen.getByRole("button", { name: /Ilha dos Araújos/i })
      fireEvent.click(ilhaBtn)

      // Click "Pedir Orçamento Igual"
      const quoteBtns = screen.getAllByText("Pedir Orçamento Igual")
      expect(quoteBtns.length).toBeGreaterThan(0)
      fireEvent.click(quoteBtns[0])
      expect(onQuote).toHaveBeenCalled()
    })
  })

  describe("TrustComparisonTable (Feature #5: Boca a Boca vs Severinno)", () => {
    it("renders comparison criteria and trust anchors", () => {
      const onCta = vi.fn()
      render(<TrustComparisonTable onCtaClick={onCta} />)

      expect(
        screen.getByText(/Contratar no “Boca a Boca” vs. Severinno com Proteção Total/i),
      ).toBeDefined()
      expect(screen.getByText("Pagamento & Sinal")).toBeDefined()
      expect(screen.getByText("Se o Serviço Ficar Ruim")).toBeDefined()
      expect(screen.getByText("Segurança de Quem Entra na Casa")).toBeDefined()

      const ctaBtn = screen.getByText("Contratar com Proteção Total")
      fireEvent.click(ctaBtn)
      expect(onCta).toHaveBeenCalled()
    })
  })

  describe("ProximityRadarTicker (Feature #6: Radar de Proximidade < 15 min)", () => {
    it("renders radar pulse, active provider count and live ETA mini-cards", () => {
      const onExplore = vi.fn()
      render(<ProximityRadarTicker onExploreNearby={onExplore} />)

      expect(screen.getByText(/Radar GPS Ao Vivo/i)).toBeDefined()
      expect(screen.getByText(/38 profissionais verificados com rota ativa/i)).toBeDefined()

      const exploreBtn = screen.getByText("Ver Técnicos Mais Próximos")
      fireEvent.click(exploreBtn)
      expect(onExplore).toHaveBeenCalled()
    })
  })
})
