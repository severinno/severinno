export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { getReferralLeaderboard } from "@/lib/referral"

export const GET = withRoute("api.referral.leaderboard.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)

  const { searchParams } = new URL(request.url)
  const limitParam = searchParams.get("limit")
  const limit = limitParam ? Math.min(50, Math.max(1, parseInt(limitParam, 10) || 10)) : 10

  const leaderboard = await getReferralLeaderboard(limit)

  return NextResponse.json({
    leaderboard,
    count: leaderboard.length,
  })
})
