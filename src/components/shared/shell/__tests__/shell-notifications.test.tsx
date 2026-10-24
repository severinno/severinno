import * as React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { NotificationsBell, groupNotificationsByDate } from "../shell-notifications"
import type { NotificationItem } from "../types"

// Mock Radix dropdown-menu to render inline for JSDOM
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Mock dependencies
const mockTriggerHaptic = vi.fn()
const mockPlayCoinSound = vi.fn()

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: (...args: any[]) => mockTriggerHaptic(...args),
}))

vi.mock("@/lib/sounds", () => ({
  playCoinSound: (...args: any[]) => mockPlayCoinSound(...args),
}))

// Relógio congelado: `groupNotificationsByDate` agrupa por dia de calendário e
// as fixtures são relativas a "agora". Com o relógio real, uma execução entre
// 00:00 e 00:59 (ex.: job de CI às 00:41 UTC) joga `agora - 1h` para "Ontem" e
// o grupo "Hoje" fica com 1 item. 12:00 BRT deixa ambos no mesmo dia em
// qualquer fuso.
const NOW = new Date("2026-01-05T15:00:00.000Z")

let mockNotifications: NotificationItem[]

describe("NotificationsBell & Shell Notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(NOW)
    mockNotifications = [
      {
        id: "notif-1",
        title: "Pagamento Confirmado",
        body: "Seu PIX foi confirmado com sucesso.",
        type: "PAYMENT_CONFIRMED",
        read: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "notif-2",
        title: "Prestador Chegou",
        body: "Carlos chegou ao local de atendimento.",
        type: "PROVIDER_ARRIVED",
        read: true,
        createdAt: new Date(NOW.getTime() - 3600000).toISOString(),
      },
    ]
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("groups notifications by date correctly", () => {
    const groups = groupNotificationsByDate(mockNotifications)
    expect(groups.length).toBeGreaterThan(0)
    expect(groups[0].label).toBe("Hoje")
    expect(groups[0].items.length).toBe(2)
  })

  it("renders notification bell with unread badge", () => {
    render(
      <NotificationsBell
        items={mockNotifications}
        unreadCount={1}
        isLoading={false}
        onMarkRead={vi.fn()}
        onMarkAllRead={vi.fn()}
        markingAll={false}
        onNavigate={vi.fn()}
      />,
    )

    const bell = screen.getByLabelText(/Notificações \(1 não lidas\)/i)
    expect(bell).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
  })

  it("filters between 'Todas' and 'Não lidas'", () => {
    render(
      <NotificationsBell
        items={mockNotifications}
        unreadCount={1}
        isLoading={false}
        onMarkRead={vi.fn()}
        onMarkAllRead={vi.fn()}
        markingAll={false}
        onNavigate={vi.fn()}
      />,
    )

    // Initially both items are shown
    expect(screen.getByText("Todas (2)")).toBeInTheDocument()
    expect(screen.getByText("Não lidas (1)")).toBeInTheDocument()
    expect(screen.getByText("Pagamento Confirmado")).toBeInTheDocument()
    expect(screen.getByText("Prestador Chegou")).toBeInTheDocument()

    // Click 'Não lidas'
    const unreadTab = screen.getByText("Não lidas (1)")
    fireEvent.click(unreadTab)
    expect(mockTriggerHaptic).toHaveBeenCalledWith("selection")

    // Now only unread is shown
    expect(screen.getByText("Pagamento Confirmado")).toBeInTheDocument()
    expect(screen.queryByText("Prestador Chegou")).not.toBeInTheDocument()
  })

  it("triggers haptic and coin sound on 'Marcar todas'", () => {
    const onMarkAllRead = vi.fn()
    render(
      <NotificationsBell
        items={mockNotifications}
        unreadCount={1}
        isLoading={false}
        onMarkRead={vi.fn()}
        onMarkAllRead={onMarkAllRead}
        markingAll={false}
        onNavigate={vi.fn()}
      />,
    )

    const markAllBtn = screen.getByRole("button", { name: /Marcar todas/i })
    fireEvent.click(markAllBtn)

    expect(mockTriggerHaptic).toHaveBeenCalledWith("success")
    expect(mockPlayCoinSound).toHaveBeenCalledWith({ vibrate: true })
    expect(onMarkAllRead).toHaveBeenCalledWith(["notif-1"])
  })

  it("triggers haptic on 'Marcar como lida'", () => {
    const onMarkRead = vi.fn()
    render(
      <NotificationsBell
        items={mockNotifications}
        unreadCount={1}
        isLoading={false}
        onMarkRead={onMarkRead}
        onMarkAllRead={vi.fn()}
        markingAll={false}
        onNavigate={vi.fn()}
      />,
    )

    const markReadBtn = screen.getByText("Marcar como lida")
    fireEvent.click(markReadBtn)

    expect(mockTriggerHaptic).toHaveBeenCalledWith("selection")
    expect(onMarkRead).toHaveBeenCalledWith("notif-1")
  })
})
