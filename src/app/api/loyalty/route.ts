export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import {
  getLoyaltyStats,
  getLoyaltyTransactions,
  getUserPerks,
  redeemReward,
  LOYALTY_REWARDS_CATALOG,
} from "@/lib/loyalty"
import { badRequest } from "@/lib/api-server"
import { z } from "zod"

const redeemSchema = z.object({
  rewardId: z.string().min(1, "ID da recompensa é obrigatório"),
})

/**
 * GET /api/loyalty
 * Returns user's loyalty score, tier progression, badges, catalog of rewards,
 * points transaction history, and active perks (Anti-Cash: 100% points and benefits).
 */
export const GET = withRoute("api.loyalty.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)
  const session = await requireUser()

  const [stats, transactions, perks] = await Promise.all([
    getLoyaltyStats(session.userId),
    getLoyaltyTransactions(session.userId),
    getUserPerks(session.userId),
  ])

  return NextResponse.json({
    ok: true,
    stats,
    catalog: LOYALTY_REWARDS_CATALOG,
    transactions,
    perks,
  })
})

/**
 * POST /api/loyalty
 * Redeems points for an in-platform benefit or partner discount.
 * 100% anti-cash: strictly vouchers, discounts, and platform visibility boosts.
 */
export const POST = withRoute("api.loyalty.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)
  const session = await requireUser()

  const body = await request.json().catch(() => ({}))
  const { rewardId } = redeemSchema.parse(body)

  const result = await redeemReward(session.userId, rewardId)

  if (!result.success) {
    throw badRequest(result.error ?? "Não foi possível realizar o resgate.")
  }

  return NextResponse.json({
    ok: true,
    message: "Benefício resgatado com sucesso no Severinno Clube!",
    perk: result.perk,
    remainingPoints: result.remainingPoints,
  })
})
