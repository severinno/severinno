import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { HomeHealthScoreQuiz } from "../home-health-score-quiz"

describe("HomeHealthScoreQuiz Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders quiz header and first question (Elétrica & Segurança)", () => {
    render(<HomeHealthScoreQuiz />)

    expect(screen.getByText("Qual é o Score de Segurança da Sua Residência?")).toBeInTheDocument()
    expect(screen.getByText("Etapa 1 de 4")).toBeInTheDocument()
    expect(
      screen.getByText("Qual o estado da instalação elétrica e disjuntores da sua casa?"),
    ).toBeInTheDocument()

    // 3 options for step 1
    expect(
      screen.getByText("Quadro novo com disjuntores DIN e fiação revisada"),
    ).toBeInTheDocument()
    expect(
      screen.getByText("Mais de 4 anos sem revisão, mas raramente desarma"),
    ).toBeInTheDocument()
    expect(
      screen.getByText("Disjuntor chia/aquece ou chuveiro queima com frequência"),
    ).toBeInTheDocument()
  })

  it("progresses through all 4 questions and displays high score results", () => {
    const onSchedule = vi.fn()
    render(<HomeHealthScoreQuiz onScheduleCheckup={onSchedule} />)

    // Step 1: select optimal (25 pts)
    fireEvent.click(
      screen.getByRole("button", {
        name: /quadro novo com disjuntores din e fiação revisada/i,
      }),
    )

    // Step 2: Hidráulica
    expect(screen.getByText("Etapa 2 de 4")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", {
        name: /limpeza de caixa e inspeção nos últimos 6 meses/i,
      }),
    )

    // Step 3: Ar
    expect(screen.getByText("Etapa 3 de 4")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", {
        name: /higienização profunda nos últimos 4 meses/i,
      }),
    )

    // Step 4: Estrutura
    expect(screen.getByText("Etapa 4 de 4")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", {
        name: /tudo regulado, fechaduras suaves e paredes sem mofo/i,
      }),
    )

    // Result screen with 100/100
    expect(screen.getByText("Diagnóstico Concluído")).toBeInTheDocument()
    expect(screen.getByText("100")).toBeInTheDocument()
    expect(screen.getByText("Casa Blindada & Protegida")).toBeInTheDocument()

    // Click CTA
    const scheduleBtn = screen.getByRole("button", {
      name: /agendar check-up preventivo da casa/i,
    })
    fireEvent.click(scheduleBtn)
    expect(onSchedule).toHaveBeenCalledWith("Check-up da Casa")
  })

  it("identifies critical risk points and allows reset", () => {
    const onSchedule = vi.fn()
    render(<HomeHealthScoreQuiz onScheduleCheckup={onSchedule} />)

    // Step 1: select risk (0 pts)
    fireEvent.click(
      screen.getByRole("button", {
        name: /disjuntor chia\/aquece ou chuveiro queima com frequência/i,
      }),
    )

    // Step 2: select optimal (25 pts)
    fireEvent.click(
      screen.getByRole("button", {
        name: /limpeza de caixa e inspeção nos últimos 6 meses/i,
      }),
    )

    // Step 3: select risk (0 pts)
    fireEvent.click(
      screen.getByRole("button", {
        name: /nunca fiz limpeza profunda \/ pinga água ou tem cheiro de mofo/i,
      }),
    )

    // Step 4: select optimal (25 pts)
    fireEvent.click(
      screen.getByRole("button", {
        name: /tudo regulado, fechaduras suaves e paredes sem mofo/i,
      }),
    )

    // Score = 50 (Risco Alto)
    expect(screen.getByText("50")).toBeInTheDocument()
    expect(screen.getByText("Alerta Vermelho de Prejuízo")).toBeInTheDocument()

    // Critical tags: Elétrica & Segurança, Climatização & Ar-Condicionado
    expect(screen.getByText("Elétrica & Segurança")).toBeInTheDocument()
    expect(screen.getByText("Climatização & Ar-Condicionado")).toBeInTheDocument()

    // Click reset button
    const resetBtn = screen.getByLabelText("Refazer Diagnóstico")
    fireEvent.click(resetBtn)

    // Returns to step 1
    expect(screen.getByText("Etapa 1 de 4")).toBeInTheDocument()
  })

  it("handles WhatsApp share with report data", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)
    render(<HomeHealthScoreQuiz />)

    // Quick complete
    fireEvent.click(
      screen.getByRole("button", {
        name: /quadro novo com disjuntores din e fiação revisada/i,
      }),
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: /limpeza de caixa e inspeção nos últimos 6 meses/i,
      }),
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: /higienização profunda nos últimos 4 meses/i,
      }),
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: /tudo regulado, fechaduras suaves e paredes sem mofo/i,
      }),
    )

    const whatsappBtn = screen.getByRole("button", { name: /salvar laudo no whatsapp/i })
    fireEvent.click(whatsappBtn)

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("wa.me/5533999999999"),
      "_blank",
      "noopener,noreferrer",
    )
    openSpy.mockRestore()
  })
})
