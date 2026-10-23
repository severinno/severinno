export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { calculateProviderTier } from "@/lib/gamification"
import { forbidden } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withRoute } from "@/lib/api-route"

/**
 * GET /api/provider/gamification
 * Returns provider tier, XP score, progress to next level, active benefits and unlocked badges.
 */
export const GET = withRoute("api.provider.gamification.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)
  const session = await requireUser()
  if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
    throw forbidden("Acesso restrito a prestadores")
  }

  const provider = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      avgRating: true,
      reviewCount: true,
      verified: true,
      identityStatus: true,
    },
  })

  const completedBookings = await db.booking.count({
    where: {
      providerId: session.userId,
      status: "COMPLETED",
    },
  })

  const profile = calculateProviderTier({
    avgRating: provider?.avgRating ?? 0,
    reviewCount: provider?.reviewCount ?? 0,
    completedBookings,
    verifiedIdentity: provider?.verified || provider?.identityStatus === "approved",
  })

  return NextResponse.json({
    ok: true,
    provider: { id: session.userId, name: provider?.name },
    profile,
  })
})
