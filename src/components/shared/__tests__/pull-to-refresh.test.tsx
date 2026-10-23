import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import { PullToRefresh } from "../pull-to-refresh"

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}))

describe("PullToRefresh", () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("renderiza o conteúdo filho normalmente", () => {
    render(
      <PullToRefresh onRefresh={vi.fn()}>
        <div>Conteúdo da lista de agendamentos</div>
      </PullToRefresh>,
    )
    expect(screen.getByText("Conteúdo da lista de agendamentos")).toBeDefined()
  })

  it("não possui violações de acessibilidade axe", async () => {
    const { container } = render(
      <PullToRefresh onRefresh={vi.fn()}>
        <div>Conteúdo com acessibilidade</div>
      </PullToRefresh>,
    )
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("executa onRefresh quando o gesto de pull ultrapassa o limiar", async () => {
    const onRefreshMock = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <PullToRefresh onRefresh={onRefreshMock} pullThreshold={50}>
        <div>Lista de agendamentos</div>
      </PullToRefresh>,
    )

    const wrapper = container.firstChild as HTMLElement

    // Simulate touchstart at top
    fireEvent.touchStart(wrapper, {
      touches: [{ clientY: 100 }],
    })

    // Simulate touchmove pulling down 200px (damped: 200 * 0.45 = 90 > 50)
    fireEvent.touchMove(wrapper, {
      touches: [{ clientY: 300 }],
    })

    // Simulate touchend
    fireEvent.touchEnd(wrapper)

    await waitFor(() => {
      expect(onRefreshMock).toHaveBeenCalledTimes(1)
    })
  })
})
