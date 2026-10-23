import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

import { SpotlightOnboardingTour } from "../spotlight-onboarding-tour"

const mockTriggerHaptic = vi.fn()
vi.mock("@/lib/haptics", () => ({
  triggerHaptic: (...args: unknown[]) => mockTriggerHaptic(...args),
}))

const mockPlayCoinSound = vi.fn()
vi.mock("@/lib/sounds", () => ({
  playCoinSound: (...args: unknown[]) => mockPlayCoinSound(...args),
}))

describe("SpotlightOnboardingTour", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it("renders step 1 when opened", () => {
    render(<SpotlightOnboardingTour open={true} onClose={vi.fn()} role="CLIENT" />)

    expect(screen.getByText("Central de Comando & Acesso Rápido")).toBeInTheDocument()
    expect(screen.getByText("Tudo ao alcance de 1 clique")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Próximo/i })).toBeInTheDocument()
  })

  it("advances steps on 'Próximo' click", () => {
    render(<SpotlightOnboardingTour open={true} onClose={vi.fn()} role="CLIENT" />)

    const nextBtn = screen.getByRole("button", { name: /Próximo/i })
    fireEvent.click(nextBtn)

    expect(screen.getByText("Cobertura & Inteligência Regional GV")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Próximo/i }))
    expect(screen.getByText("Custódia Escrow & Garantia de 90 Dias")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Concluir/i })).toBeInTheDocument()
  })

  it("closes and persists to localStorage on Concluir", () => {
    const onClose = vi.fn()
    render(<SpotlightOnboardingTour open={true} onClose={onClose} role="CLIENT" />)

    // Step 1 -> Step 2
    fireEvent.click(screen.getByRole("button", { name: /Próximo/i }))
    // Step 2 -> Step 3
    fireEvent.click(screen.getByRole("button", { name: /Próximo/i }))
    // Step 3 -> Concluir
    fireEvent.click(screen.getByRole("button", { name: /Concluir/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem("sev_tour_seen_client")).toBe("true")
  })

  it("has no axe violations", async () => {
    const { container } = render(
      <SpotlightOnboardingTour open={true} onClose={vi.fn()} role="CLIENT" />,
    )
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
