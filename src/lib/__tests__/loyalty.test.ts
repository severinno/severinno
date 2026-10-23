import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  awardPoints,
  getLoyaltyStats,
  redeemReward,
  getLoyaltyTransactions,
  getUserPerks,
  updateStreak,
  LOYALTY_REWARDS_CATALOG,
} from "@/lib/loyalty"

const mockCache = new Map<string, any>()

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      count: vi.fn().mockResolvedValue(5),
    },
    review: {
      count: vi.fn().mockResolvedValue(3),
    },
  },
}))

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn(async (key: string) => mockCache.get(key) ?? null),
  cacheSet: vi.fn(async (key: string, val: any) => {
    mockCache.set(key, val)
    return true
  }),
}))

describe("Loyalty Engine & Severinno Clube", () => {
  beforeEach(() => {
    mockCache.clear()
    vi.clearAllMocks()
  })

  it("awards points and calculates total points and tier correctly", async () => {
    const res1 = await awardPoints("user-1", "booking_completed")
    expect(res1.points).toBe(10)
    expect(res1.total).toBe(10)

    const res2 = await awardPoints("user-1", "referral_provider")
    expect(res2.points).toBe(200)
    expect(res2.total).toBe(210)

    const stats = await getLoyaltyStats("user-1")
    expect(stats.points).toBe(210)
    expect(stats.tier).toBe("prata")
    expect(stats.tierName).toContain("Prata")
    expect(stats.nextTier?.pointsNeeded).toBe(500 - 210)
  })

  it("tracks streaks and bonuses", async () => {
    await updateStreak("user-streak")
    const streakData = mockCache.get("loyalty:streak:user-streak")
    expect(streakData.count).toBe(1)
  })

  it("rejects redemption if reward does not exist in catalog", async () => {
    const res = await redeemReward("user-1", "non_existent_reward")
    expect(res.success).toBe(false)
    expect(res.error).toContain("não encontrada")
  })

  it("rejects redemption when user has insufficient points", async () => {
    mockCache.set("loyalty:points:user-poor", 50)
    const res = await redeemReward("user-poor", "taxa_50_desconto") // requires 200 pts
    expect(res.success).toBe(false)
    expect(res.error).toContain("Saldo insuficiente")
  })

  it("successfully redeems reward when points are sufficient (Anti-Cash mandate)", async () => {
    mockCache.set("loyalty:points:user-rich", 600)

    const res = await redeemReward("user-rich", "taxa_50_desconto")
    expect(res.success).toBe(true)
    expect(res.remainingPoints).toBe(400)
    expect(res.perk).toBeDefined()
    expect(res.perk?.title).toBe("50% de Desconto na Taxa Severinno")
    expect(res.perk?.code).toMatch(/^SEV-TAXA-[A-Z0-9]+$/)
    expect(res.perk?.status).toBe("active")

    // Points balance in cache must be updated
    const newPoints = mockCache.get("loyalty:points:user-rich")
    expect(newPoints).toBe(400)

    // Perks list must have the active perk
    const perks = await getUserPerks("user-rich")
    expect(perks.length).toBe(1)
    expect(perks[0].id).toBe(res.perk?.id)

    // Transaction history must record the negative points
    const txs = await getLoyaltyTransactions("user-rich")
    expect(txs.length).toBe(1)
    expect(txs[0].points).toBe(-200)
    expect(txs[0].label).toContain("50% de Desconto")
  })

  it("returns user-friendly labels for transaction history", async () => {
    mockCache.set("loyalty:tx:user-tx", [
      { action: "booking_completed", points: 10, at: Date.now() - 2000 },
      { action: "referral_provider", points: 200, at: Date.now() - 1000 },
      { action: "redeem_vitrine_destaque_7d", points: -300, at: Date.now() },
    ])

    const txs = await getLoyaltyTransactions("user-tx")
    expect(txs.length).toBe(3)
    expect(txs[0].label).toContain("Destaque na Vitrine")
    expect(txs[1].label).toContain("Indicação de especialista parceiro")
    expect(txs[2].label).toContain("Serviço concluído")
  })

  it("checks catalog completeness and zero direct cash redemptions", () => {
    expect(LOYALTY_REWARDS_CATALOG.length).toBeGreaterThanOrEqual(4)
    for (const item of LOYALTY_REWARDS_CATALOG) {
      expect(["taxa", "visibilidade", "parceiro", "cupom"]).toContain(item.category)
      expect(item.pointsCost).toBeGreaterThan(0)
      expect(item.expiresInDays).toBeGreaterThan(0)
    }
  })
})
