import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, act } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import { OfflineAmbientBanner } from "../offline-ambient-banner"

let mockIsOnline = true

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => mockIsOnline,
}))

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}))

describe("OfflineAmbientBanner", () => {
  beforeEach(() => {
    mockIsOnline = true
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("não renderiza nada quando o usuário está online inicialmente", () => {
    render(<OfflineAmbientBanner />)
    expect(screen.queryByText(/Modo Offline/i)).toBeNull()
  })

  it("renderiza o pill de aviso quando o usuário fica offline", () => {
    mockIsOnline = false
    render(<OfflineAmbientBanner />)
    expect(screen.getByText(/Modo Offline/i)).toBeDefined()
  })

  it("não possui violações de acessibilidade axe quando exibido", async () => {
    mockIsOnline = false
    const { container } = render(<OfflineAmbientBanner />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
