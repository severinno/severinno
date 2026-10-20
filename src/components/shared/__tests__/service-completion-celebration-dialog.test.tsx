import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@/__tests__/test-utils"
import { ServiceCompletionCelebrationDialog } from "../service-completion-celebration-dialog"

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}))

vi.mock("@/lib/sounds", () => ({
  playCoinSound: vi.fn(),
}))

const mockNavigate = vi.fn()
vi.mock("@/store/view", () => ({
  useViewStore: vi.fn((selector) => {
    const state = { navigate: mockNavigate }
    return selector ? selector(state) : state
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("ServiceCompletionCelebrationDialog", () => {
  it("renders when open with all celebratory information", () => {
    render(
      <ServiceCompletionCelebrationDialog
        open={true}
        onOpenChange={vi.fn()}
        bookingTitle="Instalação de Chuveiro"
        amount={150}
        pointsAwarded={10}
        geofenceVerified={true}
        role="PROVIDER"
      />,
    )

    expect(screen.getByText("Atendimento Concluído com Sucesso!")).toBeDefined()
    expect(screen.getByText("Instalação de Chuveiro")).toBeDefined()
    expect(screen.getByText("R$ 150,00")).toBeDefined()
    expect(screen.getByText("Auditado no Local")).toBeDefined()
    expect(screen.getByText("+10 pts")).toBeDefined()
    expect(screen.getByText("Ver Benefícios do Clube")).toBeDefined()
  })

  it("calls onNavigateToRewards when primary button is clicked", () => {
    const onNavigateToRewards = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <ServiceCompletionCelebrationDialog
        open={true}
        onOpenChange={onOpenChange}
        bookingTitle="Troca de Disjuntor"
        amount={200}
        onNavigateToRewards={onNavigateToRewards}
      />,
    )

    const btn = screen.getByText("Ver Benefícios do Clube")
    fireEvent.click(btn)

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onNavigateToRewards).toHaveBeenCalled()
  })

  it("navigates to default rewards view when onNavigateToRewards is not provided", () => {
    const onOpenChange = vi.fn()

    render(
      <ServiceCompletionCelebrationDialog
        open={true}
        onOpenChange={onOpenChange}
        role="PROVIDER"
      />,
    )

    const btn = screen.getByText("Ver Benefícios do Clube")
    fireEvent.click(btn)

    expect(mockNavigate).toHaveBeenCalledWith("provider.rewards")
  })

  it("passes axe accessibility checks with 0 violations", async () => {
    const { axe } = await import("vitest-axe")
    const { container } = render(
      <ServiceCompletionCelebrationDialog
        open={true}
        onOpenChange={vi.fn()}
        bookingTitle="Reparo Hidráulico"
        amount={250}
      />,
    )

    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
