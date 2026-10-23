import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import * as React from "react"
import { PushPromptBanner } from "../push-prompt-banner"

const mockPushSub = vi.hoisted(() => ({
  isSubscribed: false,
  isSupported: true,
  permission: "default" as NotificationPermission | "unsupported",
  loading: false,
  subscribe: vi.fn().mockResolvedValue(true),
}))

let mockUser: { id: string; name: string } | null = { id: "u-1", name: "Severino" }

vi.mock("@/store/auth", () => ({
  useAuthStore: () => ({ user: mockUser }),
}))

vi.mock("@/hooks/use-service-worker", () => ({
  usePushSubscription: () => mockPushSub,
}))

vi.mock("lucide-react", () => {
  const Icon = (props: Record<string, unknown>) => <span {...props} />
  return {
    Bell: Icon,
    CheckCircle2: Icon,
    X: Icon,
    Zap: Icon,
  }
})

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}))

describe("PushPromptBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockUser = { id: "u-1", name: "Severino" }
    mockPushSub.isSubscribed = false
    mockPushSub.isSupported = true
    mockPushSub.permission = "default"
    mockPushSub.loading = false
  })

  it("não renderiza quando o usuário não está autenticado", () => {
    mockUser = null
    const { container } = render(<PushPromptBanner />)
    expect(container.firstChild).toBeNull()
  })

  it("não renderiza quando push já está ativado", () => {
    mockPushSub.isSubscribed = true
    const { container } = render(<PushPromptBanner />)
    expect(container.firstChild).toBeNull()
  })

  it("renderiza o banner de convite quando o usuário está logado e não inscrito", () => {
    render(<PushPromptBanner />)

    expect(screen.getByText("Ativar Alertas no Celular")).toBeDefined()
    expect(screen.getByRole("button", { name: /ativar notificações/i })).toBeDefined()
    expect(screen.getByRole("button", { name: /mais tarde/i })).toBeDefined()
  })

  it("descarta o banner ao clicar em Mais tarde", () => {
    render(<PushPromptBanner />)

    const laterBtn = screen.getByRole("button", { name: /mais tarde/i })
    fireEvent.click(laterBtn)

    expect(screen.queryByText("Ativar Alertas no Celular")).toBeNull()
    expect(localStorage.getItem("push-prompt-dismissed-at")).toBeDefined()
  })

  it("aciona subscribe ao clicar em Ativar Notificações", async () => {
    render(<PushPromptBanner />)

    const enableBtn = screen.getByRole("button", { name: /ativar notificações/i })
    fireEvent.click(enableBtn)

    expect(mockPushSub.subscribe).toHaveBeenCalledTimes(1)
  })
})
