import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

import { GlobalCommandPalette, CommandPaletteTrigger } from "../global-command-palette"

const mockTriggerHaptic = vi.fn()
vi.mock("@/lib/haptics", () => ({
  triggerHaptic: (...args: unknown[]) => mockTriggerHaptic(...args),
}))

describe("GlobalCommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders trigger button and fires callback on click", () => {
    const onClick = vi.fn()
    render(<CommandPaletteTrigger onClick={onClick} />)

    const btn = screen.getByRole("button", {
      name: /Abrir busca e paleta de comandos/i,
    })
    expect(btn).toBeInTheDocument()

    fireEvent.click(btn)
    expect(mockTriggerHaptic).toHaveBeenCalledWith("selection")
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("renders admin options when role is ADMIN and open is true", () => {
    const onNavigate = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <GlobalCommandPalette
        open={true}
        onOpenChange={onOpenChange}
        role="ADMIN"
        onNavigate={onNavigate}
      />,
    )

    expect(screen.getByText("Torre de Controle Operacional (Live GV)")).toBeInTheDocument()
    expect(screen.getByText("Verificações & Aprovação KYC")).toBeInTheDocument()
    expect(screen.getByText("Custódia & Repasses PIX")).toBeInTheDocument()
  })

  it("renders client options when role is CLIENT", () => {
    const onNavigate = vi.fn()
    const onOpenChange = vi.fn()
    const onOpenQuote = vi.fn()

    render(
      <GlobalCommandPalette
        open={true}
        onOpenChange={onOpenChange}
        role="CLIENT"
        onNavigate={onNavigate}
        onOpenQuote={onOpenQuote}
      />,
    )

    expect(screen.getByText("Buscar Prestadores com Radar Geográfico")).toBeInTheDocument()
    expect(screen.getByText("Pedir Orçamento Expresso Grátis")).toBeInTheDocument()
  })

  it("renders provider options when role is PROVIDER", () => {
    const onNavigate = vi.fn()
    const onOpenChange = vi.fn()
    const onOpenMeiReport = vi.fn()

    render(
      <GlobalCommandPalette
        open={true}
        onOpenChange={onOpenChange}
        role="PROVIDER"
        onNavigate={onNavigate}
        onOpenMeiReport={onOpenMeiReport}
      />,
    )

    expect(screen.getByText("Minha Agenda & Calendário de Atendimentos")).toBeInTheDocument()
    expect(screen.getByText("Exportar Demonstrativo MEI & DRE Contábil")).toBeInTheDocument()
  })

  it("has no axe violations", async () => {
    const { container } = render(
      <GlobalCommandPalette
        open={true}
        onOpenChange={vi.fn()}
        role="CLIENT"
        onNavigate={vi.fn()}
      />,
    )
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
