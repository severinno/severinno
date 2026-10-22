import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

import { NotificationsDrawer } from "../notifications-drawer"
import type { NotificationItem } from "../shell/types"

const mockTriggerHaptic = vi.fn()
vi.mock("@/lib/haptics", () => ({
  triggerHaptic: (...args: unknown[]) => mockTriggerHaptic(...args),
}))

const mockPlayCoinSound = vi.fn()
vi.mock("@/lib/sounds", () => ({
  playCoinSound: (...args: unknown[]) => mockPlayCoinSound(...args),
}))

const sampleItems: NotificationItem[] = [
  {
    id: "notif-1",
    title: "Pagamento Confirmado",
    body: "Seu pagamento de R$ 150,00 foi confirmado.",
    type: "PAYMENT_CONFIRMED",
    read: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: "notif-2",
    title: "Prestador a caminho",
    body: "O prestador iniciou o deslocamento.",
    type: "BOOKING_ACCEPTED",
    read: true,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
]

describe("NotificationsDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders notification items and unread badge when open", () => {
    render(
      <NotificationsDrawer
        open={true}
        onOpenChange={vi.fn()}
        items={sampleItems}
        unreadCount={1}
        isLoading={false}
        onMarkRead={vi.fn()}
        onMarkAllRead={vi.fn()}
        markingAll={false}
        onNavigate={vi.fn()}
      />,
    )

    expect(screen.getByText("Pagamento Confirmado")).toBeInTheDocument()
    expect(screen.getByText("Prestador a caminho")).toBeInTheDocument()
    expect(screen.getByText("1 nova")).toBeInTheDocument()
  })

  it("filters items by unread tab", () => {
    render(
      <NotificationsDrawer
        open={true}
        onOpenChange={vi.fn()}
        items={sampleItems}
        unreadCount={1}
        isLoading={false}
        onMarkRead={vi.fn()}
        onMarkAllRead={vi.fn()}
        markingAll={false}
        onNavigate={vi.fn()}
      />,
    )

    const unreadTab = screen.getByRole("button", { name: /Não lidas \(1\)/i })
    fireEvent.click(unreadTab)

    expect(screen.getByText("Pagamento Confirmado")).toBeInTheDocument()
    expect(screen.queryByText("Prestador a caminho")).not.toBeInTheDocument()
  })

  it("calls onMarkAllRead on clicking 'Marcar todas como lidas'", () => {
    const onMarkAllRead = vi.fn()
    render(
      <NotificationsDrawer
        open={true}
        onOpenChange={vi.fn()}
        items={sampleItems}
        unreadCount={1}
        isLoading={false}
        onMarkRead={vi.fn()}
        onMarkAllRead={onMarkAllRead}
        markingAll={false}
        onNavigate={vi.fn()}
      />,
    )

    const markAllBtn = screen.getByRole("button", {
      name: /Marcar todas como lidas/i,
    })
    fireEvent.click(markAllBtn)

    expect(onMarkAllRead).toHaveBeenCalledWith(["notif-1"])
    expect(mockPlayCoinSound).toHaveBeenCalled()
  })

  it("has no axe violations", async () => {
    const { container } = render(
      <NotificationsDrawer
        open={true}
        onOpenChange={vi.fn()}
        items={sampleItems}
        unreadCount={1}
        isLoading={false}
        onMarkRead={vi.fn()}
        onMarkAllRead={vi.fn()}
        markingAll={false}
        onNavigate={vi.fn()}
      />,
    )
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
