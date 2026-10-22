import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

import { ClientQuickActionsHub, CLIENT_ACTION_OPTIONS } from "../client-quick-actions-hub"

const mockTriggerHaptic = vi.fn()
vi.mock("@/lib/haptics", () => ({
  triggerHaptic: (...args: unknown[]) => mockTriggerHaptic(...args),
}))

describe("ClientQuickActionsHub", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders all client quick action cards with title and badge", () => {
    const onNavigate = vi.fn()
    const onOpenQuote = vi.fn()
    render(<ClientQuickActionsHub onNavigate={onNavigate} onOpenQuote={onOpenQuote} />)

    expect(
      screen.getByRole("region", { name: "Central de serviços e ações rápidas" }),
    ).toBeInTheDocument()

    for (const action of CLIENT_ACTION_OPTIONS) {
      expect(screen.getByText(action.title)).toBeInTheDocument()
      expect(screen.getByText(action.badge)).toBeInTheDocument()
    }
  })

  it("navigates to providers when search map card is clicked", () => {
    const onNavigate = vi.fn()
    const onOpenQuote = vi.fn()
    render(<ClientQuickActionsHub onNavigate={onNavigate} onOpenQuote={onOpenQuote} />)

    const searchCard = screen.getByText("Buscar Prestadores no Mapa").closest("button")
    expect(searchCard).toBeInTheDocument()
    fireEvent.click(searchCard!)

    expect(mockTriggerHaptic).toHaveBeenCalledWith("selection")
    expect(onNavigate).toHaveBeenCalledWith("client.providers")
  })

  it("calls onOpenQuote when express quote card is clicked", () => {
    const onNavigate = vi.fn()
    const onOpenQuote = vi.fn()
    render(<ClientQuickActionsHub onNavigate={onNavigate} onOpenQuote={onOpenQuote} />)

    const quoteCard = screen.getByText("Pedir Orçamento Rápido").closest("button")
    expect(quoteCard).toBeInTheDocument()
    fireEvent.click(quoteCard!)

    expect(mockTriggerHaptic).toHaveBeenCalledWith("selection")
    expect(onOpenQuote).toHaveBeenCalledTimes(1)
  })

  it("has no axe violations", async () => {
    const onNavigate = vi.fn()
    const onOpenQuote = vi.fn()
    const { container } = render(
      <ClientQuickActionsHub onNavigate={onNavigate} onOpenQuote={onOpenQuote} />,
    )
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
