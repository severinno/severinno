import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import { ProviderSocialReputationCard } from "../provider-social-reputation-card"

vi.mock("@/lib/sounds", () => ({
  playCoinSound: vi.fn(),
}))

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}))

const mockProvider = {
  id: "prov-123",
  name: "Carlos Eletricista GV",
  slug: "carlos-eletricista",
  avatarUrl: "https://example.com/avatar.jpg",
  bio: "Eletricista residencial com 10 anos de experiência em Governador Valadares.",
  rating: 4.9,
  reviewCount: 34,
  completedBookings: 52,
  categoryTitle: "Eletricista Residencial & Predial",
  city: "Governador Valadares, MG",
  verified: true,
}

describe("ProviderSocialReputationCard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it("não possui violações de acessibilidade (axe clean)", async () => {
    const { container } = render(
      <ProviderSocialReputationCard open={true} onOpenChange={vi.fn()} provider={mockProvider} />,
    )
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("renderiza o preview do card com nome, rating, contagens e garantia de custódia", () => {
    render(
      <ProviderSocialReputationCard open={true} onOpenChange={vi.fn()} provider={mockProvider} />,
    )

    expect(screen.getByText("Carlos Eletricista GV")).toBeInTheDocument()
    expect(screen.getByText("Eletricista Residencial & Predial")).toBeInTheDocument()
    expect(screen.getByText("Governador Valadares, MG")).toBeInTheDocument()
    expect(screen.getByText("4.9")).toBeInTheDocument()
    expect(screen.getByText(/34 avaliações 5 estrelas/i)).toBeInTheDocument()
    expect(screen.getByText(/Garantia Severinno/i)).toBeInTheDocument()
  })

  it("copia link do perfil público ao clicar no botão Copiar Link", async () => {
    render(
      <ProviderSocialReputationCard open={true} onOpenChange={vi.fn()} provider={mockProvider} />,
    )

    const copyBtn = screen.getByRole("button", { name: /Copiar Link/i })
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("/u/carlos-eletricista"),
    )
  })

  it("abre o WhatsApp com a mensagem formatada ao clicar em Compartilhar", () => {
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null)

    render(
      <ProviderSocialReputationCard open={true} onOpenChange={vi.fn()} provider={mockProvider} />,
    )

    const shareBtn = screen.getByRole("button", { name: /Compartilhar no WhatsApp/i })
    fireEvent.click(shareBtn)

    expect(windowOpenSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://wa.me/?text="),
      "_blank",
      "noopener,noreferrer",
    )
  })
})
