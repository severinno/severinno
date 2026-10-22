import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

import { AdminCommandHub, ADMIN_COMMAND_OPTIONS } from "../admin-command-hub"

const mockTriggerHaptic = vi.fn()
vi.mock("@/lib/haptics", () => ({
  triggerHaptic: (...args: unknown[]) => mockTriggerHaptic(...args),
}))

describe("AdminCommandHub", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders all command cards with title and badge", () => {
    const onNavigate = vi.fn()
    render(<AdminCommandHub onNavigate={onNavigate} />)

    expect(
      screen.getByRole("region", { name: "Central de operações e acesso rápido" }),
    ).toBeInTheDocument()

    for (const opt of ADMIN_COMMAND_OPTIONS) {
      expect(screen.getByText(opt.title)).toBeInTheDocument()
      expect(screen.getByText(opt.badge)).toBeInTheDocument()
    }
  })

  it("triggers onNavigate and haptic when a command card is clicked", () => {
    const onNavigate = vi.fn()
    render(<AdminCommandHub onNavigate={onNavigate} />)

    const opCard = screen.getByText("Torre de Controle Operacional").closest("button")
    expect(opCard).toBeInTheDocument()
    fireEvent.click(opCard!)

    expect(mockTriggerHaptic).toHaveBeenCalledWith("selection")
    expect(onNavigate).toHaveBeenCalledWith("admin.operations")
  })

  it("has no axe violations", async () => {
    const onNavigate = vi.fn()
    const { container } = render(<AdminCommandHub onNavigate={onNavigate} />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
