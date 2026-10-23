import * as React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@/__tests__/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { axe } from "vitest-axe"
import { LoyaltyRewardsCenter } from "../loyalty-rewards-center"
import { apiGet } from "@/lib/api"

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))

vi.mock("@/components/ui/tabs", () => {
  const TabsContext = React.createContext<{ value: string; setValue: (v: string) => void }>({
    value: "catalog",
    setValue: () => {},
  })

  return {
    Tabs: ({ defaultValue = "catalog", children, className }: any) => {
      const [val, setVal] = React.useState(defaultValue)
      return (
        <TabsContext.Provider value={{ value: val, setValue: setVal }}>
          <div className={className} data-active-tab={val}>
            {children}
          </div>
        </TabsContext.Provider>
      )
    },
    TabsList: ({ children, className }: any) => (
      <div className={className} role="tablist" aria-label="Abas do Clube de Benefícios">
        {children}
      </div>
    ),
    TabsTrigger: ({ value, children, className }: any) => {
      const ctx = React.useContext(TabsContext)
      return (
        <button
          type="button"
          className={className}
          role="tab"
          data-state={ctx.value === value ? "active" : "inactive"}
          onClick={() => ctx.setValue(value)}
        >
          {children}
        </button>
      )
    },
    TabsContent: ({ value, children, className }: any) => {
      const ctx = React.useContext(TabsContext)
      if (ctx.value !== value) return null
      return (
        <div className={className} role="tabpanel" data-tab-content={value}>
          {children}
        </div>
      )
    },
  }
})

function renderComponent(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn((selector) =>
    selector({
      user: { id: "user-123", name: "Carlos Mestre", role: "PROVIDER" },
    }),
  ),
}))

const mockLoyaltyData = {
  ok: true,
  stats: {
    points: 450,
    tier: "prata",
    tierName: "🥈 Prata",
    badges: [
      {
        id: "prata",
        name: "Prata",
        emoji: "🥈",
        description: "500 pontos",
        earnedAt: "2026-10-15T10:00:00Z",
      },
    ],
    streak: 3,
    totalBookings: 12,
    totalReviews: 8,
    nextTier: { name: "🥇 Ouro", pointsNeeded: 50 },
  },
  catalog: [
    {
      id: "taxa_50_desconto",
      title: "50% de Desconto na Taxa Severinno",
      description: "Abatimento de 50% na taxa de intermediação no seu próximo atendimento.",
      pointsCost: 200,
      category: "taxa",
      icon: "Percent",
      badgeText: "Economia no Bolso",
      expiresInDays: 30,
    },
    {
      id: "voucher_parceiro_material_50",
      title: "Voucher R$ 50 em Materiais & Ferramentas",
      description: "Crédito para compra de materiais elétricos/hidráulicos em parceiros de GV.",
      pointsCost: 500,
      category: "parceiro",
      icon: "Wrench",
      badgeText: "Lojas Credenciadas",
      expiresInDays: 60,
    },
  ],
  transactions: [
    {
      action: "booking_completed",
      label: "Serviço concluído (+10 pts)",
      points: 10,
      at: Date.now() - 3600000,
    },
    {
      action: "referral_provider",
      label: "Indicação de especialista parceiro (+200 pts)",
      points: 200,
      at: Date.now() - 7200000,
    },
  ],
  perks: [
    {
      id: "perk_1",
      rewardId: "taxa_50_desconto",
      title: "50% de Desconto na Taxa Severinno",
      code: "SEV-TAXA-99AA",
      pointsCost: 200,
      category: "taxa",
      redeemedAt: "2026-10-18T10:00:00Z",
      expiresAt: "2026-11-18T10:00:00Z",
      status: "active",
    },
  ],
}

describe("LoyaltyRewardsCenter Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiGet).mockResolvedValue(mockLoyaltyData)
  })

  afterEach(() => {
    cleanup()
  })

  it("renders header banner with anti-cash mandate and live points balance", async () => {
    renderComponent(<LoyaltyRewardsCenter role="provider" />)

    await waitFor(() => {
      expect(screen.getByText("Severinno Clube & Benefícios")).toBeInTheDocument()
    })

    expect(screen.getByText("100% Pontos & Vantagens")).toBeInTheDocument()
    expect(screen.getByText("450")).toBeInTheDocument()
  })

  it("renders Bento HUD cards with tier progression and streaks", async () => {
    renderComponent(<LoyaltyRewardsCenter role="provider" />)

    await waitFor(() => {
      expect(screen.getByText("Categoria prata")).toBeInTheDocument()
    })

    expect(screen.getByText(/3 semanas/)).toBeInTheDocument()
    expect(screen.getByText(/1 cupom/)).toBeInTheDocument()
  })

  it("renders catalog items with affordance differentiation based on points", async () => {
    renderComponent(<LoyaltyRewardsCenter role="provider" />)

    await waitFor(() => {
      expect(screen.getByText("50% de Desconto na Taxa Severinno")).toBeInTheDocument()
    })

    // User has 450 pts: 200 pts item can be redeemed
    expect(screen.getByRole("button", { name: /Resgatar Benefício/ })).toBeEnabled()

    // 500 pts item cannot be redeemed (short 50 pts)
    expect(screen.getByText("Faltam 50 pts")).toBeInTheDocument()
  })

  it("opens confirmation dialog upon clicking Resgatar Benefício", async () => {
    renderComponent(<LoyaltyRewardsCenter role="provider" />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Resgatar Benefício/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: /Resgatar Benefício/ }))

    expect(screen.getByText("Confirmar Resgate de Benefício")).toBeInTheDocument()
    expect(screen.getByText(/Saldo após resgate:/)).toBeInTheDocument()
    expect(screen.getByText("250 pts")).toBeInTheDocument()
  })

  it("shows active perks voucher code and copy button", async () => {
    renderComponent(<LoyaltyRewardsCenter role="provider" />)

    await waitFor(() => {
      expect(screen.getByText(/Meus Benefícios/)).toBeInTheDocument()
    })

    // Click on Meus Benefícios tab
    const tab = screen.getByRole("tab", { name: /Meus Benefícios/ })
    fireEvent.click(tab)

    await waitFor(() => {
      expect(screen.getByText("SEV-TAXA-99AA")).toBeInTheDocument()
    })

    expect(screen.getByText("Pronto para Uso")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Copiar/ })).toBeInTheDocument()
  })

  it("shows points movement history and badges in Extrato tab", async () => {
    renderComponent(<LoyaltyRewardsCenter role="provider" />)

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Extrato & Conquistas/ })).toBeInTheDocument()
    })

    const tab = screen.getByRole("tab", { name: /Extrato & Conquistas/ })
    fireEvent.click(tab)

    await waitFor(() => {
      expect(screen.getByText("Histórico de Movimentação de Pontos")).toBeInTheDocument()
    })

    expect(screen.getByText("Serviço concluído (+10 pts)")).toBeInTheDocument()
    expect(screen.getByText("Indicação de especialista parceiro (+200 pts)")).toBeInTheDocument()
    expect(screen.getByText("+10 pts")).toBeInTheDocument()
    expect(screen.getByText("+200 pts")).toBeInTheDocument()
  })

  it("passes axe accessibility checks with 0 violations", async () => {
    const { container } = renderComponent(<LoyaltyRewardsCenter role="provider" />)

    await waitFor(() => {
      expect(screen.getByText("Severinno Clube & Benefícios")).toBeInTheDocument()
    })

    const results = await axe(container)
    expect(results.violations).toEqual([])
  })
})
