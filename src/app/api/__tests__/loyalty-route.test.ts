import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET, POST } from "@/app/api/loyalty/route"
import { requireUser } from "@/lib/auth"
import { getLoyaltyStats, getLoyaltyTransactions, getUserPerks, redeemReward } from "@/lib/loyalty"

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: {} },
}))

vi.mock("@/lib/loyalty", async () => {
  const actual = await vi.importActual<any>("@/lib/loyalty")
  return {
    ...actual,
    getLoyaltyStats: vi.fn(),
    getLoyaltyTransactions: vi.fn(),
    getUserPerks: vi.fn(),
    redeemReward: vi.fn(),
  }
})

describe("API /api/loyalty", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: "u-loyalty-1", role: "PROVIDER" } as never)
  })

  it("GET retorna pontuação, catálogo, extrato e benefícios ativos", async () => {
    vi.mocked(getLoyaltyStats).mockResolvedValue({
      points: 350,
      tier: "prata",
      tierName: "🥈 Prata",
      badges: [],
      streak: 2,
      totalBookings: 8,
      totalReviews: 5,
      nextTier: { name: "🥇 Ouro", pointsNeeded: 150 },
    })

    vi.mocked(getLoyaltyTransactions).mockResolvedValue([
      {
        action: "booking_completed",
        label: "Serviço concluído (+10 pts)",
        points: 10,
        at: Date.now(),
      },
    ])

    vi.mocked(getUserPerks).mockResolvedValue([])

    const req = new Request("http://localhost:3000/api/loyalty")
    const res = await GET(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.stats.points).toBe(350)
    expect(json.catalog).toBeDefined()
    expect(json.catalog.length).toBeGreaterThan(0)
    expect(json.transactions.length).toBe(1)
  })

  it("POST executa resgate de benefício com sucesso (Anti-Cash)", async () => {
    vi.mocked(redeemReward).mockResolvedValue({
      success: true,
      perk: {
        id: "p-1",
        rewardId: "taxa_50_desconto",
        title: "50% de Desconto na Taxa Severinno",
        code: "SEV-TAXA-A1B2",
        pointsCost: 200,
        category: "taxa",
        redeemedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        status: "active",
      },
      remainingPoints: 150,
    })

    const req = new Request("http://localhost:3000/api/loyalty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rewardId: "taxa_50_desconto" }),
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.perk.code).toBe("SEV-TAXA-A1B2")
    expect(json.remainingPoints).toBe(150)
  })

  it("POST rejeita resgate quando serviço retorna erro", async () => {
    vi.mocked(redeemReward).mockResolvedValue({
      success: false,
      error: "Saldo insuficiente.",
    })

    const req = new Request("http://localhost:3000/api/loyalty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rewardId: "taxa_50_desconto" }),
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("Saldo insuficiente")
  })
})
