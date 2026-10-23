import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@/__tests__/test-utils"
import { FastBookingFilter } from "../fast-booking-filter"
import { AiVisualSearchModal } from "../ai-visual-search-modal"
import { ServiceCombosSection } from "../service-combos-section"
import { PwaInstallBanner } from "@/components/shared/pwa-install-banner"

vi.mock("@/hooks/use-regional-context", () => ({
  useRegionalContext: () => ({
    context: {
      city: "Governador Valadares",
      state: "MG",
      macroRegion: "sudeste",
      timezone: "America/Sao_Paulo",
      solarPeriod: "morning",
      localTimeString: "10:30",
      weather: "heatwave",
      weatherBadge: "☀️ Calor Intenso",
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

vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_, tag: string) => {
        const Comp = ({ children, ...props }: any) => {
          const Tag = tag as any
          return <Tag {...props}>{children}</Tag>
        }
        return Comp
      },
    },
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

describe("Vitrine CRO Batch 2 (#1, #2, #3, #5)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe("FastBookingFilter (Feature #1: Fast-Booking em 2 Cliques)", () => {
    it("renders booking time slots and handles selection", () => {
      const onSelect = vi.fn()
      render(<FastBookingFilter activeSlot="hoje-tarde" onSelectSlot={onSelect} />)

      expect(screen.getAllByText("Hoje à Tarde").length).toBeGreaterThan(0)
      expect(screen.getByText("Amanhã de Manhã")).toBeDefined()
      expect(screen.getByText("Este Sábado")).toBeDefined()

      // Click "Amanhã de Manhã" button
      const amanhaBtn = screen.getByRole("button", { name: /Amanhã de Manhã/i })
      fireEvent.click(amanhaBtn)
      expect(onSelect).toHaveBeenCalledWith("amanha-manha")
    })
  })

  describe("AiVisualSearchModal (Feature #2: Diagnóstico Visual por Foto com IA)", () => {
    it("renders modal, preset scenarios and triggers analysis", async () => {
      const onSelect = vi.fn()
      render(<AiVisualSearchModal open={true} onOpenChange={vi.fn()} onSelectService={onSelect} />)

      expect(screen.getByText("Diagnóstico Visual com Inteligência Artificial")).toBeDefined()
      expect(screen.getByText(/Vazamento na Tubulação \/ Pia/i)).toBeDefined()
      expect(screen.getByText(/Disjuntor Desarmando/i)).toBeDefined()

      // Click on preset scenario
      const scenarioBtn = screen.getByText(/Vazamento na Tubulação \/ Pia/i)
      fireEvent.click(scenarioBtn)

      // Shows loading
      expect(screen.getByText(/Analisando imagem com visão computacional/i)).toBeDefined()

      // After analysis completes
      await waitFor(
        () => {
          expect(screen.getByText(/Vazamento em Tubulação de PVC/i)).toBeDefined()
        },
        { timeout: 3000 },
      )

      expect(screen.getByText(/Faixa estimada: R\$ 130 - R\$ 220/i)).toBeDefined()
    })
  })

  describe("ServiceCombosSection (Feature #3: Combos & Pacotes com Desconto)", () => {
    it("renders combo packages with discount and handles CTA", () => {
      const onSelectCombo = vi.fn()
      render(<ServiceCombosSection onSelectCombo={onSelectCombo} />)

      expect(
        screen.getByText(/Combos Residenciais Mais Pedidos em Governador Valadares/i),
      ).toBeDefined()
      expect(screen.getByText("Combo Verão Refrescante & Ar Gelando")).toBeDefined()
      expect(screen.getByText("Combo Elétrica Blindada & Casa Segura")).toBeDefined()

      const comboBtns = screen.getAllByText("Contratar Pacote Completo")
      expect(comboBtns.length).toBeGreaterThan(0)
      fireEvent.click(comboBtns[0])
      expect(onSelectCombo).toHaveBeenCalled()
    })
  })

  describe("PwaInstallBanner (Feature #5: Banner Inteligente de Instalação PWA)", () => {
    it("shows banner when beforeinstallprompt event is fired and handles dismissal", async () => {
      render(<PwaInstallBanner />)

      // Trigger synthetic beforeinstallprompt wrapped in act
      const promptEvent = new Event("beforeinstallprompt") as any
      promptEvent.prompt = vi.fn().mockResolvedValue(undefined)
      promptEvent.userChoice = Promise.resolve({ outcome: "accepted" })

      act(() => {
        window.dispatchEvent(promptEvent)
      })

      expect(screen.getByText(/Instalar Severinno no Celular/i)).toBeDefined()
      expect(screen.getByText(/Instalar Agora/i)).toBeDefined()

      // Click "Agora não" to dismiss
      const dismissBtn = screen.getByText("Agora não")
      fireEvent.click(dismissBtn)

      expect(screen.queryByText(/Instalar Agora/i)).toBeNull()
    })
  })
})
