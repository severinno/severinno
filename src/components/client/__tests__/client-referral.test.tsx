/**
 * Tests for ClientReferral — referral and "Indique e Ganhe" panel for clients.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// ---- Hoisted shared mocks --------------------------------------------------
const { mockNavigate, mockApiGet, mockToastSuccess } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockApiGet: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock("@/store/view", () => ({
  useViewStore: vi.fn(
    (
      selector?: (s: {
        navigate: ReturnType<typeof vi.fn>
        params: Record<string, unknown>
      }) => unknown,
    ) => {
      const state = { navigate: mockNavigate, params: {} }
      return selector ? selector(state) : state
    },
  ),
}))

vi.mock("@/lib/api", () => ({
  apiGet: mockApiGet,
}))

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: vi.fn(),
  },
}))

// ---- Sample data -----------------------------------------------------------

const mockStats = {
  ok: true,
  stats: {
    code: "SEVAA081B",
    inviteLink: "http://localhost:3000/convite/SEVAA081B",
    shareText: "Venha para o Severinno!",
    whatsappShareUrl:
      "https://api.whatsapp.com/send?text=Venha%20para%20o%20Severinno!%20http://localhost:3000/convite/SEVAA081B",
    totalInvites: 8,
    activeFriends: 4,
    pointsEarned: 250,
    tierBonusTitle: "Embaixador Prata",
  },
}

const mockLeaderboard = {
  leaderboard: [
    {
      rank: 1,
      userId: "user-1",
      name: "Ana Clara Souza",
      avatarUrl: "/avatars/ana.jpg",
      convertedCount: 14,
      pointsEarned: 850,
      badge: "Embaixador Diamante",
    },
    {
      rank: 2,
      userId: "user-2",
      name: "Bruno Carvalho",
      avatarUrl: null,
      convertedCount: 8,
      pointsEarned: 450,
      badge: "Embaixador Ouro",
    },
  ],
  count: 2,
}

import { ClientReferral } from "../client-referral"

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

// ---- Test suite ------------------------------------------------------------

describe("ClientReferral", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })

    // Mock window.open
    vi.spyOn(window, "open").mockImplementation(() => null)

    mockApiGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/referral/leaderboard")) {
        return Promise.resolve(mockLeaderboard)
      }
      if (url === "/api/referral") {
        return Promise.resolve(mockStats)
      }
      return Promise.resolve({})
    })
  })

  afterEach(() => {
    cleanup()
  })

  it("renders Hero banner, title, description and quick navigation buttons", async () => {
    renderWithClient(<ClientReferral />)

    expect(screen.getByText("Programa Indique e Ganhe")).toBeInTheDocument()
    expect(screen.getByText("Indique Amigos e Ganhe Recompensas")).toBeInTheDocument()

    const agendamentosBtn = screen.getByRole("button", { name: /Meus agendamentos/i })
    expect(agendamentosBtn).toBeInTheDocument()
    fireEvent.click(agendamentosBtn)
    expect(mockNavigate).toHaveBeenCalledWith("client.bookings")

    const providersBtn = screen.getByRole("button", { name: /Buscar prestadores/i })
    expect(providersBtn).toBeInTheDocument()
    fireEvent.click(providersBtn)
    expect(mockNavigate).toHaveBeenCalledWith("client.providers")
  })

  it("renders impact StatCards with accurate metrics", async () => {
    renderWithClient(<ClientReferral />)

    await waitFor(() => {
      expect(screen.getByText("8")).toBeInTheDocument()
    })

    expect(screen.getByText("Convites Enviados")).toBeInTheDocument()
    expect(screen.getByText("Amigos Ativos")).toBeInTheDocument()
    expect(screen.getByText("4")).toBeInTheDocument()
    expect(screen.getByText("Pontos Conquistados")).toBeInTheDocument()
    expect(screen.getByText("+250")).toBeInTheDocument()
  })

  it("displays exclusive invite link and referral code badge", async () => {
    renderWithClient(<ClientReferral />)

    await waitFor(() => {
      expect(screen.getByText("http://localhost:3000/convite/SEVAA081B")).toBeInTheDocument()
    })

    expect(screen.getByText("SEVAA081B")).toBeInTheDocument()
    expect(screen.getByText("Embaixador Prata")).toBeInTheDocument()
  })

  it("copies invite link to clipboard and gives visual toast confirmation", async () => {
    renderWithClient(<ClientReferral />)

    await waitFor(() => {
      expect(screen.getByText("SEVAA081B")).toBeInTheDocument()
    })

    const copyBtn = screen.getByRole("button", { name: /Copiar link de convite/i })
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "http://localhost:3000/convite/SEVAA081B",
    )
    expect(mockToastSuccess).toHaveBeenCalledWith("Link de indicação copiado! 📋")
    expect(screen.getByText("Copiado!")).toBeInTheDocument()
  })

  it("opens WhatsApp share link when clicking WhatsApp invite button", async () => {
    renderWithClient(<ClientReferral />)

    await waitFor(() => {
      expect(screen.getByText("SEVAA081B")).toBeInTheDocument()
    })

    const whatsappBtn = screen.getByRole("button", {
      name: /Enviar convite pelo WhatsApp para amigos/i,
    })
    fireEvent.click(whatsappBtn)

    expect(window.open).toHaveBeenCalledWith(
      mockStats.stats.whatsappShareUrl,
      "_blank",
      "noopener,noreferrer",
    )
  })

  it("renders Como Funciona 3-step guide", async () => {
    renderWithClient(<ClientReferral />)

    expect(screen.getByText("Como Funciona o Programa")).toBeInTheDocument()
    expect(screen.getByText("Compartilhe o Convite")).toBeInTheDocument()
    expect(screen.getByText("Seu Amigo Contrata")).toBeInTheDocument()
    expect(screen.getByText("Vocês Dois Ganham")).toBeInTheDocument()
  })

  it("renders Reward Tiers section with active level highlight", async () => {
    renderWithClient(<ClientReferral />)

    expect(screen.getByText("Níveis de Recompensa")).toBeInTheDocument()
    expect(screen.getByText("Iniciante")).toBeInTheDocument()
    expect(screen.getByText("Prata")).toBeInTheDocument()
    expect(screen.getByText("Ouro")).toBeInTheDocument()
    expect(screen.getByText("Diamante")).toBeInTheDocument()
  })

  it("renders Community Leaderboard with ambassadors", async () => {
    renderWithClient(<ClientReferral />)

    await waitFor(() => {
      expect(screen.getByText("Ana Clara Souza")).toBeInTheDocument()
    })

    expect(screen.getByText("Ranking de Embaixadores & Indicadores")).toBeInTheDocument()
    expect(screen.getByText("Embaixador Diamante")).toBeInTheDocument()
    expect(screen.getByText("14 amigos")).toBeInTheDocument()
    expect(screen.getByText("+850 pts")).toBeInTheDocument()

    expect(screen.getByText("Bruno Carvalho")).toBeInTheDocument()
    expect(screen.getByText("Embaixador Ouro")).toBeInTheDocument()
    expect(screen.getByText("8 amigos")).toBeInTheDocument()
  })

  it("renders empty state for leaderboard when no ambassadors exist", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.startsWith("/api/referral/leaderboard")) {
        return Promise.resolve({ leaderboard: [], count: 0 })
      }
      return Promise.resolve(mockStats)
    })

    renderWithClient(<ClientReferral />)

    await waitFor(() => {
      expect(screen.getByText("Nenhum embaixador ranqueado ainda")).toBeInTheDocument()
    })

    expect(
      screen.getByText("Compartilhe seu link com amigos para acumular pontos e liderar o ranking!"),
    ).toBeInTheDocument()
  })

  it("passes accessibility checks with 0 axe violations", async () => {
    const { container } = renderWithClient(<ClientReferral />)

    await waitFor(() => {
      expect(screen.getByText("SEVAA081B")).toBeInTheDocument()
    })

    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
