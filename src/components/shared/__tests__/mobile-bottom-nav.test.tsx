import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import { MobileBottomNav } from "@/components/shared/mobile-bottom-nav"
import * as haptics from "@/lib/haptics"

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}))

describe("MobileBottomNav", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders correctly for CLIENT role with zero axe violations", async () => {
    const onNavigate = vi.fn()
    const { container } = render(
      <MobileBottomNav
        role="CLIENT"
        currentView="client.dashboard"
        onNavigate={onNavigate}
        unreadCount={0}
      />,
    )

    expect(screen.getByText("Início")).toBeDefined()
    expect(screen.getByText("Buscar")).toBeDefined()
    expect(screen.getByText("Reservas")).toBeDefined()
    expect(screen.getByText("Mensagens")).toBeDefined()
    expect(screen.getByText("Perfil")).toBeDefined()

    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("renders correctly for PROVIDER role", async () => {
    const onNavigate = vi.fn()
    render(
      <MobileBottomNav
        role="PROVIDER"
        currentView="provider.dashboard"
        onNavigate={onNavigate}
        unreadCount={0}
      />,
    )

    expect(screen.getByText("Painel")).toBeDefined()
    expect(screen.getByText("Agenda")).toBeDefined()
    expect(screen.getByText("Chamados")).toBeDefined()
    expect(screen.getByText("Mensagens")).toBeDefined()
    expect(screen.getByText("Carteira")).toBeDefined()
  })

  it("renders correctly for ADMIN role", async () => {
    const onNavigate = vi.fn()
    render(
      <MobileBottomNav
        role="ADMIN"
        currentView="admin.dashboard"
        onNavigate={onNavigate}
        unreadCount={0}
      />,
    )

    expect(screen.getByText("Painel")).toBeDefined()
    expect(screen.getByText("Usuários")).toBeDefined()
    expect(screen.getByText("Operações")).toBeDefined()
    expect(screen.getByText("Serviços")).toBeDefined()
    expect(screen.getByText("Finanças")).toBeDefined()
  })

  it("triggers onNavigate and haptic feedback on click", () => {
    const onNavigate = vi.fn()
    render(
      <MobileBottomNav
        role="CLIENT"
        currentView="client.dashboard"
        onNavigate={onNavigate}
        unreadCount={0}
      />,
    )

    const reservasBtn = screen.getByRole("button", { name: "Reservas" })
    fireEvent.click(reservasBtn)

    expect(onNavigate).toHaveBeenCalledWith("client.bookings")
    expect(haptics.triggerHaptic).toHaveBeenCalledWith("selection")
  })

  it("renders unread badge when count > 0", () => {
    render(
      <MobileBottomNav
        role="CLIENT"
        currentView="client.dashboard"
        onNavigate={vi.fn()}
        unreadCount={3}
      />,
    )

    expect(screen.getByTestId("bottom-nav-badge")).toBeDefined()
    expect(screen.getByText("3")).toBeDefined()
  })

  it("renders '9+' badge when count > 9", () => {
    render(
      <MobileBottomNav
        role="CLIENT"
        currentView="client.dashboard"
        onNavigate={vi.fn()}
        unreadCount={15}
      />,
    )

    expect(screen.getByText("9+")).toBeDefined()
  })

  it("marks active button with aria-current='page' and indicator dot", () => {
    render(
      <MobileBottomNav
        role="CLIENT"
        currentView="client.dashboard"
        onNavigate={vi.fn()}
        unreadCount={0}
      />,
    )

    const inicioBtn = screen.getByRole("button", { name: "Início" })
    expect(inicioBtn.getAttribute("aria-current")).toBe("page")
    expect(screen.getByTestId("bottom-nav-active-dot")).toBeDefined()
  })
})
