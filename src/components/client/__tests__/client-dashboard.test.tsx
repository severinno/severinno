/**
 * Tests for ClientDashboard — preference toggles (sound & vibration).
 *
 * Verifies that:
 *  - Sound and vibration toggles render in the preferences card
 *  - Preview buttons render
 *  - Toggling a switch calls apiPatch with the correct preference
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

// ---- Hoisted shared state (avoids vi.mock hoisting TDZ) --------------------
const { mockApiPatch, mockPlayCoinSound, mockTryVibrate } = vi.hoisted(() => {
  const apiPatch = vi.fn().mockResolvedValue({})
  const playCoinSound = vi.fn()
  const tryVibrate = vi.fn()
  return { mockApiPatch: apiPatch, mockPlayCoinSound: playCoinSound, mockTryVibrate: tryVibrate }
})

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn(
    (
      selector?: (s: {
        user: { id: string; name: string; soundEnabled?: boolean; vibrateEnabled?: boolean } | null
      }) => unknown,
    ) => {
      const state = {
        user: { id: "user-1", name: "Maria", soundEnabled: true, vibrateEnabled: true },
      }
      return selector ? selector(state) : state
    },
  ),
}))

vi.mock("@/store/view", () => ({
  useViewStore: vi.fn((selector?: (s: { navigate: ReturnType<typeof vi.fn> }) => unknown) => {
    const state = { navigate: vi.fn() }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@/store/ui", () => ({
  useUIStore: vi.fn((selector?: (s: { openQuote: ReturnType<typeof vi.fn> }) => unknown) => {
    const state = { openQuote: vi.fn() }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn((opts?: { queryKey?: string[] }) => {
    const key = opts?.queryKey?.[0] ?? ""
    // Make OnboardingChecklist see a complete profile so it returns null
    if (key === "onboarding-profile") {
      return {
        data: {
          name: "Maria",
          avatarUrl: "/avatar.jpg",
          whatsapp: "11999999999",
          cep: "01001000",
          street: "Rua A",
          number: "123",
        },
        isLoading: false,
      }
    }
    return {
      data: { items: [], total: 0 },
      isLoading: false,
    }
  }),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
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

vi.mock("lucide-react", () => ({
  CalendarDays: () => <svg />,
  Camera: () => <svg />,
  CheckCircle2: () => <svg />,
  ChevronRight: () => <svg />,
  FileText: () => <svg />,
  Loader2: () => <svg />,
  MapPin: () => <svg />,
  Phone: () => <svg />,
  Play: () => <svg />,
  Plus: () => <svg />,
  Search: () => <svg />,
  Smartphone: () => <svg />,
  TrendingUp: () => <svg />,
  User: () => <svg />,
  Volume2: () => <svg />,
  Wallet: () => <svg />,
}))

// ---- Recharts needs ResizeObserver -----------------------------------------
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
)

// ---- SUT import (must be after vi.mock) ------------------------------------
import { ClientDashboard } from "../client-dashboard"

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Accessibility (axe-core)
// ---------------------------------------------------------------------------

describe("ClientDashboard — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<ClientDashboard />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Preference toggles
// ---------------------------------------------------------------------------

describe("ClientDashboard — preference toggles", () => {
  it("renders sound preference toggle with label", () => {
    render(<ClientDashboard />)
    expect(screen.getByText("Sons do painel")).toBeDefined()
    expect(screen.getByLabelText("Ativar sons do painel")).toBeDefined()
  })

  it("renders vibration preference toggle with label", () => {
    render(<ClientDashboard />)
    expect(screen.getByText("Vibração")).toBeDefined()
    expect(screen.getByLabelText("Ativar vibração")).toBeDefined()
  })

  it("renders preview buttons for sound and vibration", () => {
    render(<ClientDashboard />)
    expect(screen.getByTitle("Prévia do som")).toBeDefined()
    expect(screen.getByTitle("Prévia da vibração")).toBeDefined()
  })

  it("calls playCoinSound when clicking sound preview button", () => {
    render(<ClientDashboard />)
    const previewBtn = screen.getByTitle("Prévia do som")
    fireEvent.click(previewBtn)
    expect(mockPlayCoinSound).toHaveBeenCalledTimes(1)
  })

  it("calls tryVibrate when clicking vibration preview button", () => {
    render(<ClientDashboard />)
    const previewBtn = screen.getByTitle("Prévia da vibração")
    fireEvent.click(previewBtn)
    expect(mockTryVibrate).toHaveBeenCalledTimes(1)
  })

  it("calls apiPatch with soundEnabled=false when toggling sound off", () => {
    render(<ClientDashboard />)

    const soundSwitch = screen.getByLabelText("Ativar sons do painel")
    fireEvent.click(soundSwitch)

    expect(mockApiPatch).toHaveBeenCalledWith("/api/users/me", {
      soundEnabled: false,
    })
  })

  it("calls apiPatch with vibrateEnabled=false when toggling vibration off", () => {
    render(<ClientDashboard />)

    const vibrateSwitch = screen.getByLabelText("Ativar vibração")
    fireEvent.click(vibrateSwitch)

    expect(mockApiPatch).toHaveBeenCalledWith("/api/users/me", {
      vibrateEnabled: false,
    })
  })
})
