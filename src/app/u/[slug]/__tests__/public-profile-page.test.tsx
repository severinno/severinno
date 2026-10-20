import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import { PublicProfilePage, type PublicProfileProvider } from "../public-profile-page"
import { triggerHaptic } from "@/lib/haptics"
import { toast } from "sonner"

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockProvider: PublicProfileProvider = {
  id: "prov-valadares-1",
  name: "Marcos Encanador GV",
  bio: "Especialista em detecção de vazamentos e instalações hidráulicas em Governador Valadares.",
  avatarUrl: "https://example.com/avatar.jpg",
  coverUrl: null,
  city: "Governador Valadares",
  state: "MG",
  whatsapp: "33999999999",
  verified: true,
  identityStatus: "approved",
  isAmbassador: true,
  rating: 4.95,
  reviewCount: 42,
  completedBookings: 60,
  services: [
    {
      id: "srv-1",
      title: "Desentupimento e Troca de Sifão",
      basePrice: 120,
      duration: 60,
      description: "Serviço residencial completo com garantia de 90 dias.",
    },
  ],
  reviewsReceived: [
    {
      id: "rev-1",
      rating: 5,
      comment: "Excelente profissional, resolveu o vazamento rápido!",
      photos: ["https://example.com/antes.jpg", "https://example.com/depois.jpg"],
      isVerified: true,
      createdAt: new Date("2026-03-15"),
      client: {
        name: "Ana Pereira",
        avatarUrl: null,
      },
    },
  ],
  availability: [
    { dayOfWeek: 1, startTime: "08:00", endTime: "18:00", active: true },
    { dayOfWeek: 2, startTime: "08:00", endTime: "18:00", active: true },
  ],
}

describe("PublicProfilePage (/u/[slug])", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      share: undefined,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it("não possui violações de acessibilidade (axe clean)", async () => {
    const { container } = render(<PublicProfilePage provider={mockProvider} />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("renderiza dados completos do prestador, selo de verificação e embaixador", () => {
    render(<PublicProfilePage provider={mockProvider} />)

    expect(screen.getByText("Marcos Encanador GV")).toBeInTheDocument()
    expect(screen.getByText("Identidade Verificada")).toBeInTheDocument()
    expect(screen.getByText("Embaixador Severinno")).toBeInTheDocument()
    expect(screen.getAllByText(/Governador Valadares/i).length).toBeGreaterThan(0)
    expect(screen.getByText("60 serviços")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Especialista em detecção de vazamentos e instalações hidráulicas em Governador Valadares.",
      ),
    ).toBeInTheDocument()
  })

  it("renderiza lista de serviços com valor em BRL", () => {
    render(<PublicProfilePage provider={mockProvider} />)

    expect(screen.getByText("Desentupimento e Troca de Sifão")).toBeInTheDocument()
    expect(screen.getByText("R$ 120,00")).toBeInTheDocument()
  })

  it("renderiza avaliações com selo de serviço verificado", () => {
    render(<PublicProfilePage provider={mockProvider} />)

    expect(screen.getByText("Avaliações (42)")).toBeInTheDocument()
    expect(screen.getByText("Ana Pereira")).toBeInTheDocument()
    expect(
      screen.getByText("Excelente profissional, resolveu o vazamento rápido!"),
    ).toBeInTheDocument()
    expect(screen.getByText("Serviço Verificado")).toBeInTheDocument()
    expect(screen.getByText("Antes")).toBeInTheDocument()
    expect(screen.getByText("Depois")).toBeInTheDocument()
  })

  it("copia link para a área de transferência quando navigator.share não está disponível", async () => {
    render(<PublicProfilePage provider={mockProvider} />)

    const shareButton = screen.getByRole("button", { name: /Compartilhar perfil/i })
    fireEvent.click(shareButton)

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("/u/prov-valadares-1"),
      )
      expect(triggerHaptic).toHaveBeenCalledWith("selection")
      expect(toast.success).toHaveBeenCalledWith("Link do perfil copiado!")
    })
  })

  it("invoca navigator.share quando a Web Share API está disponível", async () => {
    const mockShare = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { share: mockShare })

    render(<PublicProfilePage provider={mockProvider} />)

    const shareButton = screen.getByRole("button", { name: /Compartilhar perfil/i })
    fireEvent.click(shareButton)

    await waitFor(() => {
      expect(mockShare).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Marcos Encanador GV - Severinno",
          text: expect.stringContaining("Marcos Encanador GV"),
        }),
      )
      expect(triggerHaptic).toHaveBeenCalledWith("selection")
    })
  })
})
