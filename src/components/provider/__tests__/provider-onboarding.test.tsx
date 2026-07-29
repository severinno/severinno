import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@testing-library/react"

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn((selector) => {
    const state = { user: null, setUser: vi.fn() }
    return selector ? selector(state) : state
  }),
}))

const mockMutateAsync = vi.fn().mockResolvedValue({})

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn().mockReturnValue({ data: undefined, isLoading: false }),
  useMutation: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
}))

vi.mock("lucide-react", () => ({
  Check: () => <svg />,
  ChevronLeft: () => <svg />,
  ChevronRight: () => <svg />,
  Play: () => <svg />,
  Smartphone: () => <svg />,
  Volume2: () => <svg />,
}))

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    span: ({ children, ...p }: any) => <span {...p}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/lib/api", () => ({
  apiPatch: vi.fn().mockResolvedValue({}),
  apiPost: vi.fn().mockResolvedValue({}),
  apiGet: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/sounds", () => ({
  playCoinSound: vi.fn(),
  tryVibrate: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

afterEach(cleanup)

describe("ProviderOnboarding", () => {
  const onComplete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders the first step with step indicators", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)
    expect(screen.getByText("Complete seu perfil")).toBeDefined()
    expect(screen.getByText("1")).toBeDefined()
    expect(screen.getByText("2")).toBeDefined()
    expect(screen.getByText("3")).toBeDefined()
    expect(screen.getByText("4")).toBeDefined()
  })

  it("renders profile form fields on step 0", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)
    expect(screen.getByText("Nome")).toBeDefined()
    expect(screen.getByText("Bio")).toBeDefined()
    expect(screen.getByText("WhatsApp")).toBeDefined()
  })

  it("has próximo button and voltar disabled on first step", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)
    expect(screen.getByText("Próximo")).toBeDefined()
    const voltar = screen.getByText("Voltar")
    expect(voltar.closest("button")).toBeDisabled()
  })

  it("renders address step after clicking próximo", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    fireEvent.click(screen.getByText("Próximo"))

    expect(await screen.findByText("Onde você atende?")).toBeDefined()
    expect(screen.getByText("Cidade")).toBeDefined()
    expect(screen.getByText("Estado")).toBeDefined()
  })

  it("allows going back from step 1 to step 0", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    fireEvent.click(screen.getByText("Próximo"))
    expect(await screen.findByText("Onde você atende?")).toBeDefined()

    fireEvent.click(screen.getByText("Voltar"))
    expect(await screen.findByText("Complete seu perfil")).toBeDefined()
  })

  // ── Sound & vibration preference toggles ─────────────────────────────────

  it("renders sound preference toggle on step 0", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    expect(screen.getByText("Sons do painel")).toBeDefined()
    expect(
      screen.getByLabelText("Ativar sons do painel"),
    ).toBeDefined()
  })

  it("renders vibration preference toggle on step 0", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    expect(screen.getByText("Vibração")).toBeDefined()
    expect(screen.getByLabelText("Ativar vibração")).toBeDefined()
  })

  it("renders preview buttons for sound and vibration", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    expect(
      screen.getByTitle("Prévia do som"),
    ).toBeDefined()
    expect(
      screen.getByTitle("Prévia da vibração"),
    ).toBeDefined()
  })

  it("includes soundEnabled and vibrateEnabled when clicking Próximo", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    // Fill required fields
    fireEvent.change(screen.getByPlaceholderText("Conte um pouco sobre você..."), {
      target: { value: "Sou um profissional." },
    })

    fireEvent.click(screen.getByText("Próximo"))

    // Should advance to next step
    expect(await screen.findByText("Onde você atende?")).toBeDefined()

    // mutateAsync should have been called with soundEnabled and vibrateEnabled
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        soundEnabled: true,
        vibrateEnabled: true,
      }),
    )
  })

  it("toggling sound off reflects in mutation call", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    render(<ProviderOnboarding onComplete={onComplete} />)

    // Toggle sound OFF
    const soundSwitch = screen.getByLabelText("Ativar sons do painel")
    fireEvent.click(soundSwitch)

    // Fill required fields
    fireEvent.change(screen.getByPlaceholderText("Conte um pouco sobre você..."), {
      target: { value: "Sou um profissional." },
    })

    fireEvent.click(screen.getByText("Próximo"))

    expect(await screen.findByText("Onde você atende?")).toBeDefined()

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        soundEnabled: false,
        vibrateEnabled: true,
      }),
    )
  })
})
