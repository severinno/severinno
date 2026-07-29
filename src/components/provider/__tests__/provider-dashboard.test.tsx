import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@testing-library/react"
import { axe } from "vitest-axe"

// ---- Hoisted shared state (avoids vi.mock hoisting TDZ) --------------------
const { mockApiPatch, mockPlayCoinSound, mockTryVibrate } = vi.hoisted(() => {
  const apiPatch = vi.fn().mockResolvedValue({})
  const playCoinSound = vi.fn()
  const tryVibrate = vi.fn()
  return {
    mockApiPatch: apiPatch,
    mockPlayCoinSound: playCoinSound,
    mockTryVibrate: tryVibrate,
  }
})

vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
)

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: {
        id: "1",
        name: "João Silva",
        email: "joao@test.com",
        role: "PROVIDER",
        avatarUrl: null,
      },
    }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@/store/view", () => ({
  useViewStore: vi.fn((selector) => {
    const state = { navigate: vi.fn() }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn().mockReturnValue({
    data: {
      items: [],
      total: 0,
      hasAvatar: false,
      hasBio: false,
      hasServices: false,
      hasAvailability: false,
    },
    isLoading: false,
  }),
}))

vi.mock("lucide-react", () => ({
  ArrowRight: () => <svg />,
  Banknote: () => <svg />,
  CalendarCheck: () => <svg />,
  CalendarDays: () => <svg />,
  CheckCircle2: () => <svg />,
  Clock: () => <svg />,
  FileText: () => <svg />,
  Loader2: () => <svg />,
  MapPin: () => <svg />,
  Play: () => <svg />,
  Plus: () => <svg />,
  Send: () => <svg />,
  Smartphone: () => <svg />,
  Star: () => <svg />,
  Volume2: () => <svg />,
  Wallet: () => <svg />,
  XCircle: () => <svg />,
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  apiPatch: mockApiPatch,
}))

vi.mock("@/lib/sounds", () => ({
  playCoinSound: mockPlayCoinSound,
  tryVibrate: mockTryVibrate,
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

import { ProviderDashboard } from "../provider-dashboard"

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Accessibility (axe-core)
// ---------------------------------------------------------------------------

describe("ProviderDashboard — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<ProviderDashboard />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Dashboard main tests
// ---------------------------------------------------------------------------

describe("ProviderDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders greeting with user name", () => {
    render(<ProviderDashboard />)
    expect(screen.getByText(/Olá, João/)).toBeDefined()
  })

  it("shows KPI cards", () => {
    render(<ProviderDashboard />)
    expect(screen.getByText("Agendamentos hoje")).toBeDefined()
    expect(screen.getByText("Avaliação média")).toBeDefined()
    expect(screen.getByText("Receita recebida")).toBeDefined()
  })

  it("shows upcoming bookings section", () => {
    render(<ProviderDashboard />)
    expect(screen.getByText("Próximos agendamentos")).toBeDefined()
  })

  it("shows the action buttons", () => {
    render(<ProviderDashboard />)
    expect(screen.getAllByText("Responder orçamentos")).toBeDefined()
    expect(screen.getByText("Novo serviço")).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Preference toggles (sound & vibration)
// ---------------------------------------------------------------------------

describe("ProviderDashboard — preference toggles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders sound preference toggle with label", () => {
    render(<ProviderDashboard />)
    expect(screen.getByText("Sons do painel")).toBeDefined()
    expect(screen.getByLabelText("Ativar sons do painel")).toBeDefined()
  })

  it("renders vibration preference toggle with label", () => {
    render(<ProviderDashboard />)
    expect(screen.getByText("Vibração")).toBeDefined()
    expect(screen.getByLabelText("Ativar vibração")).toBeDefined()
  })

  it("renders preview buttons for sound and vibration", () => {
    render(<ProviderDashboard />)
    expect(screen.getByTitle("Prévia do som")).toBeDefined()
    expect(screen.getByTitle("Prévia da vibração")).toBeDefined()
  })

  it("calls playCoinSound when clicking sound preview button", () => {
    render(<ProviderDashboard />)
    const btn = screen.getByTitle("Prévia do som")
    fireEvent.click(btn)
    expect(mockPlayCoinSound).toHaveBeenCalledTimes(1)
  })

  it("calls tryVibrate when clicking vibration preview button", () => {
    render(<ProviderDashboard />)
    const btn = screen.getByTitle("Prévia da vibração")
    fireEvent.click(btn)
    expect(mockTryVibrate).toHaveBeenCalledTimes(1)
  })

  it("calls apiPatch with soundEnabled=false when toggling sound off", () => {
    render(<ProviderDashboard />)
    const soundSwitch = screen.getByLabelText("Ativar sons do painel")
    fireEvent.click(soundSwitch)
    expect(mockApiPatch).toHaveBeenCalledWith("/api/users/me", {
      soundEnabled: false,
    })
  })

  it("calls apiPatch with vibrateEnabled=false when toggling vibration off", () => {
    render(<ProviderDashboard />)
    const vibrateSwitch = screen.getByLabelText("Ativar vibração")
    fireEvent.click(vibrateSwitch)
    expect(mockApiPatch).toHaveBeenCalledWith("/api/users/me", {
      vibrateEnabled: false,
    })
  })
})
