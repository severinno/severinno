/**
 * Tests for OnboardingChecklist — preference toggles (sound & vibration).
 *
 * Verifies that:
 *  - Sound and vibration toggles render on the checklist card
 *  - Preview buttons render
 *  - Toggling a switch calls apiPatch with the correct preference
 *  - Component returns null when profile is complete or loading
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

// ---- Hoisted shared state (avoids vi.mock hoisting TDZ) --------------------
// vi.hoisted runs at the hoisted position and returns values that can be
// captured by vi.mock factory closures.
const { mockState, mockApiPatch, mockNavigate } = vi.hoisted(() => {
  const state: {
    user: { id: string; soundEnabled?: boolean; vibrateEnabled?: boolean } | null
    profile: Record<string, unknown> | null
    isLoading: boolean
  } = {
    user: { id: "user-1" },
    profile: {
      name: "João",
      avatarUrl: null,
      whatsapp: "11988887777",
      cep: null,
      street: null,
      number: null,
    },
    isLoading: false,
  }

  const apiPatch = vi.fn().mockResolvedValue({})
  const navigate = vi.fn()

  return { mockState: state, mockApiPatch: apiPatch, mockNavigate: navigate }
})

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn(
    (
      selector?: (s: {
        user: { id: string; soundEnabled?: boolean; vibrateEnabled?: boolean } | null
      }) => unknown,
    ) => {
      const state = { user: mockState.user }
      return selector ? selector(state) : state
    },
  ),
}))

vi.mock("@/store/view", () => ({
  useViewStore: vi.fn((selector?: (s: { navigate: ReturnType<typeof vi.fn> }) => unknown) => {
    const state = { navigate: mockNavigate }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({
    data: mockState.profile,
    isLoading: mockState.isLoading,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}))

vi.mock("lucide-react", () => ({
  ArrowRight: () => <svg />,
  Camera: () => <svg />,
  CheckCircle2: () => <svg />,
  MapPin: () => <svg />,
  Phone: () => <svg />,
  Play: () => <svg />,
  Smartphone: () => <svg />,
  Sparkles: () => <svg />,
  User: () => <svg />,
  Volume2: () => <svg />,
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue(mockState.profile),
  apiPatch: mockApiPatch,
}))

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children }: any) => <div>{children}</div>,
    span: ({ children }: any) => <span>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/lib/sounds", () => ({
  playCoinSound: vi.fn(),
  tryVibrate: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// ---- SUT import (must be after vi.mock) ------------------------------------
import { OnboardingChecklist } from "../onboarding-checklist"

beforeEach(() => {
  vi.clearAllMocks()
  mockState.user = { id: "user-1" }
  mockState.profile = {
    name: "João",
    avatarUrl: null,
    whatsapp: "11988887777",
    cep: null,
    street: null,
    number: null,
  }
  mockState.isLoading = false
})

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Accessibility (axe-core)
// ---------------------------------------------------------------------------

describe("OnboardingChecklist — accessibility", () => {
  it("has no axe violations when displaying incomplete profile", async () => {
    const { container } = render(<OnboardingChecklist />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Preference toggles
// ---------------------------------------------------------------------------

describe("OnboardingChecklist — preference toggles", () => {
  it("renders sound preference toggle", () => {
    render(<OnboardingChecklist />)
    expect(screen.getByText("Sons do painel")).toBeDefined()
    expect(screen.getByLabelText("Ativar sons do painel")).toBeDefined()
  })

  it("renders vibration preference toggle", () => {
    render(<OnboardingChecklist />)
    expect(screen.getByText("Vibração")).toBeDefined()
    expect(screen.getByLabelText("Ativar vibração")).toBeDefined()
  })

  it("renders preview buttons for sound and vibration", () => {
    render(<OnboardingChecklist />)
    expect(screen.getByTitle("Prévia do som")).toBeDefined()
    expect(screen.getByTitle("Prévia da vibração")).toBeDefined()
  })

  it("renders 'Preferências' section header", () => {
    render(<OnboardingChecklist />)
    expect(screen.getByText("Preferências")).toBeDefined()
  })

  it("calls apiPatch with soundEnabled=false when toggling sound off", () => {
    render(<OnboardingChecklist />)

    const soundSwitch = screen.getByLabelText("Ativar sons do painel")
    fireEvent.click(soundSwitch)

    expect(mockApiPatch).toHaveBeenCalledWith("/api/users/me", {
      soundEnabled: false,
    })
  })

  it("calls apiPatch with vibrateEnabled=false when toggling vibration off", () => {
    render(<OnboardingChecklist />)

    const vibrateSwitch = screen.getByLabelText("Ativar vibração")
    fireEvent.click(vibrateSwitch)

    expect(mockApiPatch).toHaveBeenCalledWith("/api/users/me", {
      vibrateEnabled: false,
    })
  })

  it("returns null when profile is loading", () => {
    mockState.isLoading = true
    const { container } = render(<OnboardingChecklist />)
    expect(container.innerHTML).toBe("")
  })

  it("returns null when profile is complete (all steps done)", () => {
    mockState.profile = {
      name: "João Silva",
      avatarUrl: "https://example.com/avatar.jpg",
      whatsapp: "11988887777",
      cep: "01234-567",
      street: "Rua Exemplo",
      number: "123",
    }
    const { container } = render(<OnboardingChecklist />)
    expect(container.innerHTML).toBe("")
  })

  it("returns null when user is null (not logged in)", () => {
    mockState.user = null
    mockState.profile = null
    const { container } = render(<OnboardingChecklist />)
    expect(container.innerHTML).toBe("")
  })
})

// ---------------------------------------------------------------------------
// Stepper segmentado + resumo com foto (padrão do prestador)
// ---------------------------------------------------------------------------

describe("OnboardingChecklist — stepper segmentado + resumo", () => {
  it("progressbar segmentada reflete as etapas concluídas (2 de 4)", () => {
    render(<OnboardingChecklist />)

    const progress = screen.getByRole("progressbar")
    expect(progress.getAttribute("aria-valuenow")).toBe("2")
    expect(progress.getAttribute("aria-label")).toBe("2 de 4 etapas concluídas")
  })

  it("segmentos concluídos são botões que reabrem o perfil para revisar", () => {
    render(<OnboardingChecklist />)

    // 2 etapas concluídas → 2 botões no stepper (nome + whatsapp)
    const reviewButtons = screen.getAllByRole("button", { name: /Revisar/ })
    expect(reviewButtons.length).toBe(2)
    expect(screen.getByRole("button", { name: "Revisar nome completo no perfil" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Revisar whatsapp no perfil" })).toBeTruthy()

    fireEvent.click(reviewButtons[0]!)
    expect(mockNavigate).toHaveBeenCalledWith("client.profile")
  })

  it("resumo mostra iniciais quando não há foto e foto quando existe", () => {
    const { unmount } = render(<OnboardingChecklist />)
    expect(screen.getByText("João")).toBeDefined()
    expect(screen.getByText("J")).toBeDefined() // iniciais de "João"
    expect(screen.queryByAltText("Sua foto de perfil")).toBeNull()
    unmount()

    mockState.profile = { ...mockState.profile, avatarUrl: "https://example.com/eu.jpg" }
    render(<OnboardingChecklist />)
    expect(screen.getByAltText("Sua foto de perfil")).toBeDefined()
    expect(screen.queryByText("J")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Etapas visitadas mas não concluídas — borda tracejada no stepper
// ---------------------------------------------------------------------------

describe("OnboardingChecklist — etapas visitadas (borda tracejada)", () => {
  const INCOMPLETE_PROFILE = {
    name: "João",
    avatarUrl: null,
    whatsapp: "11988887777",
    cep: null,
    street: null,
    number: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockState.profile = { ...INCOMPLETE_PROFILE }
    mockState.user = { id: "user-1" }
    window.sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it("wizard fresco: nenhum segmento marcado como visitado", () => {
    render(<OnboardingChecklist />)

    expect(document.querySelectorAll("[data-step-key]").length).toBeGreaterThan(0)
    expect(document.querySelectorAll('[data-visited="true"]')).toHaveLength(0)
  })

  it("card clicado e não concluído ganha borda tracejada no stepper", () => {
    render(<OnboardingChecklist />)

    // "Foto de perfil" está incompleta (avatarUrl null) — abre o perfil
    fireEvent.click(screen.getByRole("button", { name: /Foto de perfil/ }))
    expect(mockNavigate).toHaveBeenCalledWith("client.profile")

    const visited = document.querySelectorAll('[data-visited="true"]')
    expect(visited).toHaveLength(1)
    expect(visited[0]!.getAttribute("data-step-key")).toBe("avatarUrl")
    expect(visited[0]!.className).toContain("border-dashed")
  })

  it("a visita persiste entre remounts (sessionStorage) — checklist desmonta ao navegar", () => {
    const { unmount } = render(<OnboardingChecklist />)
    fireEvent.click(screen.getByRole("button", { name: /Foto de perfil/ }))
    unmount()

    render(<OnboardingChecklist />)
    const visited = document.querySelectorAll('[data-visited="true"]')
    expect(visited).toHaveLength(1)
    expect(visited[0]!.getAttribute("data-step-key")).toBe("avatarUrl")
  })

  it("etapa concluída nunca mostra a marcação de visitada (concluída vence)", () => {
    render(<OnboardingChecklist />)

    // clica num card JÁ concluído (nome) — visita registrada, mas o segmento
    // é um botão "Revisar" verde; tracejado é só para não-concluídas
    fireEvent.click(screen.getByRole("button", { name: /Nome completo/ }))
    expect(document.querySelectorAll('[data-visited="true"]')).toHaveLength(0)
  })
})
