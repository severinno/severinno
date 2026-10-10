import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import * as React from "react"
import { PushNotificationCard } from "../push-notification-card"

const mockPushSub = vi.hoisted(() => ({
  isSubscribed: false,
  isSupported: true,
  permission: "default" as NotificationPermission | "unsupported",
  loading: false,
  testing: false,
  subscribe: vi.fn().mockResolvedValue(true),
  unsubscribe: vi.fn().mockResolvedValue(true),
  sendTestNotification: vi.fn().mockResolvedValue({ ok: true, message: "Teste enviado" }),
}))

vi.mock("@/hooks/use-service-worker", () => ({
  usePushSubscription: () => mockPushSub,
}))

vi.mock("lucide-react", () => {
  const Icon = (props: Record<string, unknown>) => <span {...props} />
  return {
    Bell: Icon,
    BellOff: Icon,
    BellRing: Icon,
    CheckCircle2: Icon,
    AlertTriangle: Icon,
    Loader2: Icon,
    Send: Icon,
    Smartphone: Icon,
  }
})

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}))

describe("PushNotificationCard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPushSub.isSubscribed = false
    mockPushSub.isSupported = true
    mockPushSub.permission = "default"
    mockPushSub.loading = false
    mockPushSub.testing = false
  })

  it("exibe aviso quando o navegador não suporta Web Push", () => {
    mockPushSub.isSupported = false
    render(<PushNotificationCard />)

    expect(screen.getByText("Notificações Push")).toBeDefined()
    expect(screen.getByText(/Seu navegador atual não suporta Web Push/)).toBeDefined()
  })

  it("exibe badge de bloqueado quando a permissão foi negada", () => {
    mockPushSub.permission = "denied"
    render(<PushNotificationCard />)

    expect(screen.getByText("Bloqueado")).toBeDefined()
    expect(screen.getByText(/Permissão negada no navegador/)).toBeDefined()
  })

  it("permite ativar notificações push através do switch", async () => {
    render(<PushNotificationCard />)

    const switchBtn = screen.getByRole("switch")
    expect(switchBtn).toBeDefined()
    expect(screen.getByText("Inativo")).toBeDefined()

    fireEvent.click(switchBtn)
    expect(mockPushSub.subscribe).toHaveBeenCalledTimes(1)
  })

  it("exibe badge de Ativo e botão de teste quando subscrito", async () => {
    mockPushSub.isSubscribed = true
    mockPushSub.permission = "granted"
    render(<PushNotificationCard />)

    expect(screen.getByText("Ativo")).toBeDefined()
    const testBtn = screen.getByRole("button", { name: /testar/i })
    expect(testBtn).toBeDefined()

    fireEvent.click(testBtn)
    expect(mockPushSub.sendTestNotification).toHaveBeenCalledTimes(1)
  })
})
