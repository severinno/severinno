import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@/__tests__/test-utils"
import { ProblemSolverWizard } from "../problem-solver-wizard"
import { LiveSocialProofToast } from "../live-social-proof-toast"

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

describe("Vitrine CRO Batch 3 (Problem Solver Wizard & Live Social Proof Toast)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  describe("ProblemSolverWizard (Feature: Resolva em 3 Cliques)", () => {
    it("renders headline with regional city name and problem cards", () => {
      const onSelect = vi.fn()
      render(<ProblemSolverWizard onSelectProblem={onSelect} />)

      expect(
        screen.getByText(/Qual é o seu problema hoje em Governador Valadares\?/i),
      ).toBeDefined()
      expect(screen.getByText("Chuveiro Queimou")).toBeDefined()
      expect(screen.getByText("Vazamento ou Cano Furado")).toBeDefined()
      expect(screen.getByText("Trancado Fora / Fechadura Travada")).toBeDefined()
    })

    it("opens diagnosis dialog when problem is clicked and triggers selection callback", () => {
      const onSelect = vi.fn()
      render(<ProblemSolverWizard onSelectProblem={onSelect} />)

      const chuveiroBtn = screen.getByText("Chuveiro Queimou").closest("button")
      expect(chuveiroBtn).toBeDefined()
      fireEvent.click(chuveiroBtn!)

      // Modal is open
      expect(screen.getByText("Preço Estimado: R$ 70 a R$ 130")).toBeDefined()
      expect(screen.getByText("Troca de resistência e conector")).toBeDefined()

      // Click "Ver Prestadores Próximos"
      const actionBtn = screen.getByText("Ver Prestadores Próximos")
      fireEvent.click(actionBtn)

      expect(onSelect).toHaveBeenCalledWith("Chuveiro Elétrico")
    })
  })

  describe("LiveSocialProofToast (Feature: Toasts de Atividade em Tempo Real)", () => {
    it("renders toast after initial delay and allows manual dismiss", () => {
      vi.useFakeTimers()

      render(<LiveSocialProofToast />)

      // Fast-forward initial appearance timer
      act(() => {
        vi.advanceTimersByTime(4500)
      })

      expect(screen.getByText("Mariana S.")).toBeDefined()
      expect(screen.getByText("Eletricista Residencial")).toBeDefined()

      // Click close button
      const closeBtn = screen.getByLabelText("Dispensar notificação de atividade")
      fireEvent.click(closeBtn)

      expect(screen.queryByText("Mariana S.")).toBeNull()

      vi.useRealTimers()
    })
  })
})
