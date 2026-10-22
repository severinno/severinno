import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

import { ProviderCommandHub, PROVIDER_COMMAND_OPTIONS } from "../provider-command-hub"

const mockTriggerHaptic = vi.fn()
vi.mock("@/lib/haptics", () => ({
  triggerHaptic: (...args: unknown[]) => mockTriggerHaptic(...args),
}))

describe("ProviderCommandHub", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders all provider command cards with title and badge", () => {
    const onNavigate = vi.fn()
    const onOpenReputationCard = vi.fn()
    const onOpenPriceEstimator = vi.fn()

    render(
      <ProviderCommandHub
        onNavigate={onNavigate}
        onOpenReputationCard={onOpenReputationCard}
        onOpenPriceEstimator={onOpenPriceEstimator}
      />,
    )

    expect(
      screen.getByRole("region", { name: "Central de operações e produtividade" }),
    ).toBeInTheDocument()

    for (const opt of PROVIDER_COMMAND_OPTIONS) {
      expect(screen.getByText(opt.title)).toBeInTheDocument()
      expect(screen.getByText(opt.badge)).toBeInTheDocument()
    }
  })

  it("triggers navigate when clicking on an agenda or routes card", () => {
    const onNavigate = vi.fn()
    const onOpenReputationCard = vi.fn()
    const onOpenPriceEstimator = vi.fn()

    render(
      <ProviderCommandHub
        onNavigate={onNavigate}
        onOpenReputationCard={onOpenReputationCard}
        onOpenPriceEstimator={onOpenPriceEstimator}
      />,
    )

    const agendaCard = screen.getByText("Agenda & Calendário").closest("button")
    expect(agendaCard).toBeInTheDocument()
    fireEvent.click(agendaCard!)

    expect(mockTriggerHaptic).toHaveBeenCalledWith("selection")
    expect(onNavigate).toHaveBeenCalledWith("provider.agenda")
  })

  it("triggers dialog open callbacks for price estimator and reputation card", () => {
    const onNavigate = vi.fn()
    const onOpenReputationCard = vi.fn()
    const onOpenPriceEstimator = vi.fn()

    render(
      <ProviderCommandHub
        onNavigate={onNavigate}
        onOpenReputationCard={onOpenReputationCard}
        onOpenPriceEstimator={onOpenPriceEstimator}
      />,
    )

    const priceCalcCard = screen.getByText("Calculadora de Preço").closest("button")
    expect(priceCalcCard).toBeInTheDocument()
    fireEvent.click(priceCalcCard!)
    expect(onOpenPriceEstimator).toHaveBeenCalledTimes(1)

    const repCard = screen.getByText("Cartão de Reputação").closest("button")
    expect(repCard).toBeInTheDocument()
    fireEvent.click(repCard!)
    expect(onOpenReputationCard).toHaveBeenCalledTimes(1)
  })

  it("has no axe violations", async () => {
    const onNavigate = vi.fn()
    const onOpenReputationCard = vi.fn()
    const onOpenPriceEstimator = vi.fn()

    const { container } = render(
      <ProviderCommandHub
        onNavigate={onNavigate}
        onOpenReputationCard={onOpenReputationCard}
        onOpenPriceEstimator={onOpenPriceEstimator}
      />,
    )
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
