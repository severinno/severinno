import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { axe } from "vitest-axe"
import { ProviderReferral } from "../provider-referral"

const mockStats = {
  code: "SEVPRO123",
  inviteLink: "https://severinno.com.br/convite/SEVPRO123",
  shareText: "Texto padrão",
  whatsappShareUrl: "https://api.whatsapp.com/send?text=padrao",
  totalInvites: 5,
  activeFriends: 2,
  pointsEarned: 250,
  tierBonusTitle: "Embaixador Ouro Severinno",
  clientInvitesCount: 3,
  providerInvitesCount: 2,
  clientConversionsCount: 1,
  providerConversionsCount: 1,
  clientPointsEarned: 50,
  providerPointsEarned: 200,
  totalPointsEarned: 250,
  clientInviteLink: "https://severinno.com.br/convite/SEVPRO123?tipo=cliente",
  providerInviteLink: "https://severinno.com.br/convite/SEVPRO123?tipo=prestador",
  clientShareText: "Texto cliente",
  providerShareText: "Texto prestador",
  whatsappShareUrlClient: "https://api.whatsapp.com/send?text=cliente",
  whatsappShareUrlProvider: "https://api.whatsapp.com/send?text=prestador",
}

const mockLeaderboard = [
  {
    rank: 1,
    userId: "ref_1111111111",
    name: "Marcos R.",
    avatarUrl: null,
    convertedCount: 4,
    pointsEarned: 800,
    badge: "Embaixador Ouro" as const,
  },
  {
    rank: 2,
    userId: "ref_2222222222",
    name: "Aline S.",
    avatarUrl: null,
    convertedCount: 2,
    pointsEarned: 250,
    badge: "Embaixador Severinno" as const,
  },
]

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/api/referral") {
        return { ok: true, stats: mockStats }
      }
      if (url.startsWith("/api/referral/leaderboard")) {
        return { leaderboard: mockLeaderboard, count: 2 }
      }
      return {}
    }),
  }
})

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}))

describe("ProviderReferral — Motor Dual de Conversão", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    vi.clearAllMocks()
  })

  function renderComponent() {
    return render(
      <QueryClientProvider client={queryClient}>
        <ProviderReferral />
      </QueryClientProvider>,
    )
  }

  it("renderiza os 4 Bento micro StatCards com métricas segregadas", async () => {
    renderComponent()

    expect(await screen.findByText("Prestadores Ativos")).toBeDefined()
    expect(screen.getByText("Clientes Ativos")).toBeDefined()
    expect(screen.getByText("Pontos no Clube")).toBeDefined()
    expect(await screen.findByText("+250")).toBeDefined()
    expect(await screen.findByText("Embaixador Ouro Severinno")).toBeDefined()
  })

  it("alterna entre as abas de Prestadores (+200 pts) e Clientes (+50 pts) atualizando o link", async () => {
    renderComponent()

    // Aba Prestadores ativa por padrão
    expect(await screen.findByText(/Oportunidade 4x: Prestadores Especialistas/i)).toBeDefined()
    expect(await screen.findByText(/SEVPRO123\?tipo=prestador/i)).toBeDefined()

    // Clica na aba Clientes
    const clientTab = screen.getByRole("tab", { name: /Clientes \(\+50 pts\)/i })
    fireEvent.click(clientTab)

    expect(await screen.findByText(/Indicação de Clientes e Vizinhos/i)).toBeDefined()
    expect(await screen.findByText(/SEVPRO123\?tipo=cliente/i)).toBeDefined()
  })

  it("alterna a visualização do ranking entre Lista e Grade", async () => {
    renderComponent()

    expect(await screen.findByText("Marcos R.")).toBeDefined()

    const gridBtn = screen.getByRole("button", { name: "Visualização em Grade" })
    fireEvent.click(gridBtn)

    expect(gridBtn.getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByText("Marcos R.")).toBeDefined()
  })

  it("filtra embaixadores pelo campo de busca", async () => {
    renderComponent()

    expect(await screen.findByText("Marcos R.")).toBeDefined()
    expect(screen.getByText("Aline S.")).toBeDefined()

    const searchInput = screen.getByPlaceholderText(/Buscar embaixador pelo nome ou nível/i)
    fireEvent.change(searchInput, { target: { value: "Aline" } })

    expect(screen.queryByText("Marcos R.")).toBeNull()
    expect(screen.getByText("Aline S.")).toBeDefined()
  })

  it("está 100% em conformidade com acessibilidade axe-core (0 violações)", async () => {
    const { container } = renderComponent()
    await screen.findByText("Multiplique sua Rede e Ganhe Pontos Exclusivos")
    await screen.findByText("+250")
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
